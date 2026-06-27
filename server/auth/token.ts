/**
 * Token 工具：统一从请求中提取 Bearer token 或 Cookie token
 * 消除 server/index.ts、server/auth/middleware.ts 中的重复逻辑
 */
import type { FastifyRequest } from 'fastify'

/** 从 Authorization header 或 Cookie 中提取 JWT token */
export function extractToken(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  // 优先 Bearer token
  const auth = req.headers.authorization
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7)
  }

  // 其次 Cookie
  const cookieHeader = req.headers.cookie
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/auth_token=([^;]+)/)
    if (match) return match[1]
  }

  return null
}

/** 为 Fastify 请求提供类型安全的 token 提取 */
export function extractTokenFromFastify(req: FastifyRequest | { headers: Record<string, string | string[] | undefined> }): string | null {
  return extractToken(req)
}
