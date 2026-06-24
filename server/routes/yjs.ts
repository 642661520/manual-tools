import * as Y from 'yjs'
import { encoding, decoding } from 'lib0'
import { FastifyInstance } from 'fastify'
import type { WebSocket as WsSocket } from 'ws'
import { Awareness, removeAwarenessStates, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'
import { authMiddleware } from '../auth/middleware.js'
import { verifyToken } from '../auth/jwt.js'
import type { FastifyRequest } from 'fastify'
import {
  getOrCreateDoc,
  ensureDocument,
  encodeStateAsUpdate,
  applyUpdate,
} from '../services/yjs-doc.js'

const messageSync = 0
const messageAwareness = 1

export async function yjsRoutes(app: FastifyInstance) {
  // 每个 docId 一个 server-side Awareness 实例，准确追踪客户端状态
  const awarenesses = new Map<string, Awareness>()
  // 追踪 awareness clientID → WsSocket 的映射，用于断开时精确清理
  const clientIdToSocket = new Map<number, WsSocket>()

  function getAwareness(docId: string): Awareness {
    if (!awarenesses.has(docId)) {
      // 关键：用独立的 Y.Doc，不能绑定到文档 Y.Doc
      // 否则 awareness 状态会持久化到数据库，重载时污染文档内容
      awarenesses.set(docId, new Awareness(new Y.Doc()))
    }
    return awarenesses.get(docId)!
  }

  function broadcastAwareness(awareness: Awareness, clients: Set<WsSocket>, clientIds: number[], exclude?: WsSocket) {
    const update = encodeAwarenessUpdate(awareness, clientIds)
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, messageAwareness)
    encoding.writeVarUint8Array(enc, update)
    const msg = Buffer.from(encoding.toUint8Array(enc))
    for (const c of clients) {
      if (c !== exclude && c.readyState === 1) {
        c.send(msg)
      }
    }
  }

  // 从 awareness update 中解码出 clientID
  function decodeClientIdsFromAwarenessUpdate(update: Uint8Array): number[] {
    const ids: number[] = []
    try {
      const dec = decoding.createDecoder(update)
      const count = decoding.readVarUint(dec)
      for (let i = 0; i < count; i++) {
        ids.push(decoding.readVarUint(dec))   // clientId
        decoding.readVarUint(dec)             // clock
        decoding.readVarString(dec)           // state JSON
      }
    } catch { /* malformed update */ }
    return ids
  }

  app.get('/ws/doc/:docId', { websocket: true }, (socket, req) => {
    // WebSocket 认证：从 query 参数中读取 token
    const query = (req as FastifyRequest).query as { token?: string }
    try {
      if (!query.token) throw new Error('missing token')
      verifyToken(query.token)
    } catch {
      socket.close(4001, '未登录或登录已过期')
      return
    }

    const params = req.params as { docId: string }
    const docId = params.docId

    const state = getOrCreateDoc(docId)
    const awareness = getAwareness(docId)

    state.clients.add(socket)

    const unsub = onDocUpdate(docId, socket)

    socket.on('message', (raw) => {
      const data = raw as Buffer
      const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

      try {
        const decoder = decoding.createDecoder(uint8)
        const messageType = decoding.readVarUint(decoder)

        // awareness message
        if (messageType === messageAwareness) {
          const awarenessUpdate = decoding.readVarUint8Array(decoder)
          // 解码 awareness update 获取真实的 clientID（不是 state.clients.size）
          // 只在首次出现时建立映射，防止其他客户端回声覆盖
          const ids = decodeClientIdsFromAwarenessUpdate(awarenessUpdate)
          for (const cid of ids) {
            if (!clientIdToSocket.has(cid)) {
              clientIdToSocket.set(cid, socket)
            }
          }
          applyAwarenessUpdate(awareness, awarenessUpdate, 'remote')
          // 广播时包含所有已知的 awareness clientID（含刚加入的）
          broadcastAwareness(awareness, state.clients, Array.from(awareness.getStates().keys()), socket)
          return
        }

        if (messageType !== messageSync) return

        const syncType = decoding.readVarUint(decoder)

        // sync step 1: client sends its state vector → server responds with missing updates
        if (syncType === 0) {
          const sv = decoding.readVarUint8Array(decoder)
          const update = encodeStateAsUpdate(docId, sv)
          const enc = encoding.createEncoder()
          encoding.writeVarUint(enc, messageSync)
          encoding.writeVarUint(enc, 1) // sync step 2
          encoding.writeVarUint8Array(enc, update)
          socket.send(Buffer.from(encoding.toUint8Array(enc)))
        }

        // update: client sends content changes
        if (syncType === 2) {
          const update = decoding.readVarUint8Array(decoder)
          applyUpdate(docId, update)
        }
      } catch (e) {
        console.error('Y.js parse error:', e)
      }
    })

    socket.on('close', () => {
      unsub()
      state.clients.delete(socket)
      // 找出该 socket 对应的真实 awareness clientID 并精确移除
      const idsToRemove: number[] = []
      for (const [cid, s] of clientIdToSocket) {
        if (s === socket) idsToRemove.push(cid)
      }
      if (idsToRemove.length > 0) {
        removeAwarenessStates(awareness, idsToRemove, 'disconnect')
        for (const cid of idsToRemove) {
          clientIdToSocket.delete(cid)
        }
      }
      // 广播移除通知（用被移除的 clientID 列表以包含 null 状态）
      if (idsToRemove.length > 0) {
        broadcastAwareness(awareness, state.clients, idsToRemove)
      }
    })

    socket.on('error', () => {
      unsub()
      state.clients.delete(socket)
      const idsToRemove: number[] = []
      for (const [cid, s] of clientIdToSocket) {
        if (s === socket) idsToRemove.push(cid)
      }
      if (idsToRemove.length > 0) {
        removeAwarenessStates(awareness, idsToRemove, 'disconnect')
        for (const cid of idsToRemove) {
          clientIdToSocket.delete(cid)
        }
      }
      if (idsToRemove.length > 0) {
        broadcastAwareness(awareness, state.clients, idsToRemove)
      }
    })
  })

  app.post('/api/documents/ensure', { preHandler: [authMiddleware] }, async (req) => {
    const { docId, featureId, sectionKey } = req.body as {
      docId: string
      featureId: string
      sectionKey: string
    }
    ensureDocument(docId, featureId, sectionKey)
    return { ok: true }
  })
}

function onDocUpdate(docId: string, sender: WsSocket) {
  const state = getOrCreateDoc(docId)
  const handler = (update: Uint8Array) => {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, messageSync)
    encoding.writeVarUint(enc, 2) // update
    encoding.writeVarUint8Array(enc, update)
    const msg = Buffer.from(encoding.toUint8Array(enc))

    for (const client of state.clients) {
      if (client !== sender && client.readyState === 1) {
        client.send(msg)
      }
    }
  }
  state.doc.on('update', handler)
  return () => state.doc.off('update', handler)
}
