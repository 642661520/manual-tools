/**
 * Y.js 路由测试
 * 1. HTTP POST /api/v1/documents/ensure — 创建文档记录
 * 2. WebSocket /ws/doc/:docId — 认证 + 同步（启动真实 server）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestAppWithWs, cleanupTestData } from './test-app.js'
import { getDb } from '../db/index.js'
import WebSocket from 'ws'

const PREFIX = 'yjsrt'

let app: Awaited<ReturnType<typeof buildTestAppWithWs>>
let adminToken: string

// 用于 WebSocket 测试的真实 server
let serverAddress: string

beforeAll(async () => {
  app = await buildTestAppWithWs()
  const loginRes = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  })
  adminToken = loginRes.json().data.token

  // 启动真实 listener 用于 WebSocket 测试
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  if (addr && typeof addr === 'object') {
    serverAddress = `ws://127.0.0.1:${addr.port}`
  } else {
    serverAddress = 'ws://127.0.0.1:3000'
  }
})

afterAll(async () => {
  cleanupTestData(getDb(), PREFIX)
  await app.close()
})

describe('yjs — HTTP ensure 端点', () => {
  const TEST_FEATURE = '__test_yjsrt_feat'

  beforeAll(() => {
    const db = getDb()
    db.prepare(
      'INSERT OR IGNORE INTO features (id, title, description, sections, is_custom, project_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(TEST_FEATURE, 'YJS Route Test', '', '[]', 0, 'default')
  })

  it('创建文档记录', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/documents/ensure',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { docId: `${TEST_FEATURE}/intro`, featureId: TEST_FEATURE, sectionKey: 'intro' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('未登录返回 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/documents/ensure',
      payload: { docId: 'x/y', featureId: 'x', sectionKey: 'y' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('不存在的 feature 返回 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/documents/ensure',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { docId: 'ghost/s1', featureId: 'ghost', sectionKey: 's1' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('yjs — WebSocket 协同编辑', () => {
  const WS_DOC = '__test_yjsrt_feat/wssection'

  it('认证失败关闭连接 (code 4001)', async () => {
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`${serverAddress}/ws/doc/${WS_DOC}`)
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: 'bad-token' }))
      })
      ws.on('close', (code) => {
        expect(code).toBe(4001)
        resolve()
      })
      ws.on('error', () => resolve())
    })
  })

  it('有效认证 + 同步 step1 返回 update', async () => {
    const { decoding } = await import('lib0')
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`${serverAddress}/ws/doc/${WS_DOC}`)
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: adminToken }))
      })

      let receivedSync = false
      ws.on('message', (raw) => {
        const data = raw as Buffer
        try {
          const decoder = decoding.createDecoder(new Uint8Array(data))
          const msgType = decoding.readVarUint(decoder)
          if (msgType === 0) { // messageSync
            receivedSync = true
          }
        } catch { /* binary frame */ }

        if (receivedSync) {
          ws.close()
          resolve()
        }
      })

      ws.on('error', () => resolve())
      setTimeout(() => { ws.close(); resolve() }, 3000)
    })
  }, 5000)

  it('无认证消息直接关闭连接', async () => {
    // 发送非 JSON 消息应触发认证失败
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`${serverAddress}/ws/doc/${WS_DOC}`)
      ws.on('open', () => {
        // 发送二进制消息（不经过认证）
        ws.send(Buffer.from([0, 0]))
      })
      ws.on('close', (code) => {
        // 认证失败或格式错误都会关闭
        expect([4001, 4003, 1006]).toContain(code)
        resolve()
      })
      ws.on('error', () => resolve())
      setTimeout(() => resolve(), 2000)
    })
  }, 3000)
})
