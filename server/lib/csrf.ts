/**
 * CSRF 保护模块（double-submit cookie 模式）
 *
 * - 登录时设置 csrf_token cookie（HttpOnly=false，JS 可读）
 * - 前端读取 cookie 值并以 X-CSRF-Token header 发送
 * - 服务端比对 header 与 cookie 值，一致才放行
 * - 攻击者无法读取跨域 cookie，因此无法构造有效请求
 */
import { randomBytes } from 'crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'

const CSRF_COOKIE = 'csrf_token'
const CSRF_HEADER = 'x-csrf-token'

/** 免 CSRF 校验的路径前缀 */
const SKIP_PATHS = ['/api/v1/auth/login', '/api/v1/auth/feishu/', '/api/v1/auth/feishu-login', '/api/v1/log/frontend']

/** 生成新的 CSRF token */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex')
}

/** 获取请求中的 CSRF token（从 header） */
function getHeaderToken(req: FastifyRequest): string | null {
  const val = req.headers[CSRF_HEADER]
  if (typeof val === 'string' && val) return val
  if (Array.isArray(val) && val.length > 0) return String(val[0])
  return null
}

/** 获取请求中的 CSRF token（从 cookie） */
function getCookieToken(req: FastifyRequest): string | null {
  const cookieHeader = req.headers.cookie
  if (typeof cookieHeader !== 'string') return null
  const match = cookieHeader.match(new RegExp(`${CSRF_COOKIE}=([^;]+)`))
  return match ? match[1] : null
}

/** 判断路径是否免检 */
function isSkipped(path: string): boolean {
  return SKIP_PATHS.some((p) => path.startsWith(p))
}

/** CSRF 校验中间件 */
export async function csrfMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // GET/HEAD/OPTIONS 不校验
  const method = req.method.toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return

  // 免检路径
  if (isSkipped(req.url)) return

  const headerToken = getHeaderToken(req)
  const cookieToken = getCookieToken(req)

  if (!cookieToken || !headerToken || headerToken !== cookieToken) {
    await reply.status(403).send({ ok: false, error: 'CSRF 校验失败，请刷新页面后重试' })
  }
}

/** 设置 CSRF cookie（登录时调用） */
export function setCsrfCookie(reply: FastifyReply, token: string) {
  // HttpOnly=false —— JS 需要读取此 cookie 来设置请求头
  reply.header('Set-Cookie', `${CSRF_COOKIE}=${token}; Path=/; SameSite=Strict; Max-Age=86400`)
}
