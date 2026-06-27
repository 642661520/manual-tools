import { ref, onUnmounted } from 'vue'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { encoding, decoding } from 'lib0'
import { getStoredUser } from '@/utils/storage'

const messageSync = 0
const messageAwareness = 1

export function useYjsDoc(docId: string) {
  const ydoc = new Y.Doc()
  const awareness = new Awareness(new Y.Doc())

  // 设置当前用户信息
  try {
    const user = getStoredUser()
    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4']
    awareness.setLocalStateField('user', {
      name: user?.displayName || '未知用户',
      color: colors[Math.floor(Math.random() * colors.length)],
      avatar: user?.avatarUrl || null,
    })
  } catch { /* ignore */ }
  const token = localStorage.getItem('auth_token')
  const wsUrl = `ws://${location.host}/ws/doc/${encodeURIComponent(docId)}`
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  const connected = ref(false)
  const synced = ref(false)
  const pendingQueue: Uint8Array[] = []

  function sendRaw(data: Uint8Array) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data as unknown as ArrayBuffer)
    }
  }

  function flushQueue() {
    while (pendingQueue.length > 0) {
      const update = pendingQueue.shift()!
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      encoding.writeVarUint(encoder, 2) // update
      encoding.writeVarUint8Array(encoder, update)
      sendRaw(encoding.toUint8Array(encoder))
    }
  }

  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return

    ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      connected.value = true
      // 首条消息发送认证帧（替代 URL query 参数传 token）
      if (token) {
        ws!.send(JSON.stringify({ type: 'auth', token }))
      }
      // sync step 1: send local state vector
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      encoding.writeVarUint(encoder, 0) // sync step 1
      encoding.writeVarUint8Array(encoder, Y.encodeStateVector(ydoc))
      sendRaw(encoding.toUint8Array(encoder))
      // flush any queued updates
      flushQueue()
    }

    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data)
      const decoder = decoding.createDecoder(data)
      const messageType = decoding.readVarUint(decoder)

      if (messageType !== messageSync) {
        // awareness message
        if (messageType === messageAwareness) {
          const awarenessUpdate = decoding.readVarUint8Array(decoder)
          applyAwarenessUpdate(awareness, awarenessUpdate, 'remote')
        }
        return
      }

      const syncType = decoding.readVarUint(decoder)
      if (syncType === 1) {
        // sync step 2: server delta（收到即表示同步完成，即使文档为空）
        const update = decoding.readVarUint8Array(decoder)
        Y.applyUpdate(ydoc, update, 'remote')
        synced.value = true
      } else if (syncType === 2) {
        // update from server (broadcast from other clients)
        const update = decoding.readVarUint8Array(decoder)
        Y.applyUpdate(ydoc, update, 'remote')
      }
    }

    ws.onclose = () => {
      connected.value = false
      if (!closed) {
        reconnectTimer = setTimeout(connect, 2000)
      }
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  // 监听本地 Y.Doc 变更 → 发送到服务端
  const updateHandler = (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // WebSocket 未连接，加入待发送队列
      pendingQueue.push(update)
      return
    }
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    encoding.writeVarUint(encoder, 2) // update
    encoding.writeVarUint8Array(encoder, update)
    sendRaw(encoding.toUint8Array(encoder))
  }
  ydoc.on('update', updateHandler)

  // 监听本地 awareness 变更 → 发送到服务端
  // 注意：必须过滤掉 origin === 'remote' 的回声，否则远程状态被发回服务端
  // 会覆盖 clientIdToSocket 映射，导致断线时无法清理残留光标
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === 'remote') return
    const changedClients = added.concat(updated).concat(removed)
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, messageAwareness)
    encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(awareness, changedClients))
    sendRaw(encoding.toUint8Array(enc))
  })

  connect()

  onUnmounted(() => {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    ydoc.off('update', updateHandler)
    ws?.close()
    awareness.destroy()
    ydoc.destroy()
  })

  return { ydoc, connected, synced, awareness }
}
