import * as Y from 'yjs'
import { encoding, decoding } from 'lib0'
import { FastifyInstance } from 'fastify'
import type { WebSocket as WsSocket } from 'ws'
import { Awareness, removeAwarenessStates, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'
import { authMiddleware } from '../auth/middleware.js'
import { verifyToken } from '../auth/jwt.js'
import { isProjectMember } from '../auth/membership.js'
import { getDb } from '../db/index.js'
import { ok, fail } from '../lib/response.js'
import {
  getOrCreateDoc,
  ensureDocument,
  encodeStateAsUpdate,
  applyUpdate,
  scheduleEviction,
  cancelEviction,
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
    const params = req.params as { docId: string }
    const docId = params.docId

    // 首条消息认证：连接建立后客户端必须先发 { type: 'auth', token } JSON 帧
    let authenticated = false

    const state = getOrCreateDoc(docId)
    cancelEviction(docId)
    const awareness = getAwareness(docId)

    state.clients.add(socket)

    const unsub = onDocUpdate(docId, socket)

    socket.on('message', (raw) => {
      const data = raw as Buffer

      // 未认证时，首条消息必须是 JSON 认证帧
      if (!authenticated) {
        try {
          const msg = JSON.parse(data.toString('utf-8'))
          if (msg.type === 'auth' && msg.token) {
            const payload = verifyToken(msg.token)

            // 校验项目成员身份：从 docId 提取 featureId 查询项目归属
            const featureId = docId.includes('/') ? docId.split('/')[0] : docId
            const db = getDb()
            const feature = db.prepare('SELECT project_id FROM features WHERE id = ?').get(featureId) as { project_id: string } | undefined
            if (!feature || !isProjectMember(payload.userId, payload.role, feature.project_id)) {
              socket.close(4003, '无权访问此文档')
              return
            }

            authenticated = true
          } else {
            socket.close(4001, '认证失败')
          }
        } catch {
          socket.close(4001, '认证失败')
        }
        return
      }

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
        app.log.error(`Y.js parse error: ${e}`)
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
      // 无活跃客户端时延迟卸载文档内存
      if (state.clients.size === 0) {
        scheduleEviction(docId)
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
      // 无活跃客户端时延迟卸载文档内存
      if (state.clients.size === 0) {
        scheduleEviction(docId)
      }
    })
  })

  app.post('/api/v1/documents/ensure', { preHandler: [authMiddleware] }, async (req, reply) => {
    const { docId, featureId, sectionKey } = req.body as {
      docId: string
      featureId: string
      sectionKey: string
    }
    // 检查项目成员身份
    const db = getDb()
    const feature = db.prepare('SELECT project_id FROM features WHERE id = ?').get(featureId) as { project_id: string } | undefined
    if (!feature || !isProjectMember(req.user!.userId, req.user!.role, feature.project_id)) {
      return fail(reply, 403, '无权访问此项目')
    }
    ensureDocument(docId, featureId, sectionKey)
    return ok()
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
