/** Upload 集成测试：图片/视频上传 + magic bytes 校验 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { buildTestApp } from './test-app.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMP_DIR = join(__dirname, '../..', 'data', 'uploads')

let app: Awaited<ReturnType<typeof buildTestApp>>
let adminToken: string

beforeAll(async () => {
  app = await buildTestApp()
  // 确保上传目录存在
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true })

  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'Admin@123' },
  })
  adminToken = loginRes.json().data.token
})

afterAll(async () => {
  await app.close()
})

/** 创建最小 1x1 PNG */
function createTestPng(): Buffer {
  // 1x1 红色 PNG (67 bytes) — 真实的 PNG magic bytes
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x02,
    0x00, 0x00, 0x00, 0x80, 0x16, 0xe3, 0x60, 0xee, 0x3a, 0xf5, 0xc9, 0x22, 0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
  return png
}

/** 创建假 "PNG" 文件（实际是文本） */
function createFakePng(): Buffer {
  return Buffer.from('This is not a PNG file')
}

describe('Upload', () => {
  it('可上传真实 PNG 图片', async () => {
    const png = createTestPng()
    const boundary = '----TestBoundary'
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="file"; filename="test.png"\r\n'),
      Buffer.from('Content-Type: image/png\r\n\r\n'),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/upload/image',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.data.url).toMatch(/\/uploads\/images\/[a-f0-9]{2}\/[a-f0-9]{64}\.png/)
  })

  it('伪装文件被 magic bytes 校验拒绝', async () => {
    const fake = createFakePng()
    const boundary = '----TestBoundary2'
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="file"; filename="fake.png"\r\n'),
      Buffer.from('Content-Type: image/png\r\n\r\n'),
      fake,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/upload/image',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    })
    expect(res.statusCode).toBe(400)
  })

  it('未登录无法上传', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/upload/image',
      headers: { 'content-type': 'multipart/form-data; boundary=--x' },
      payload: Buffer.from('--x\r\n\r\n\r\n--x--\r\n'),
    })
    expect(res.statusCode).toBe(401)
  })
})
