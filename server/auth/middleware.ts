import { FastifyRequest, FastifyReply } from 'fastify'
import { verifyToken, JwtPayload } from './jwt.js'
import { extractToken } from './token.js'
import { config } from '../config.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload
  }
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const token = extractToken(req)
  if (!token) {
    return reply.status(401).send({ ok: false, error: '未登录' })
  }

  let payload: JwtPayload
  try {
    payload = verifyToken(token)
  } catch {
    return reply.status(401).send({ ok: false, error: '登录已过期，请重新登录' })
  }

  // 验证 token_version：与数据库比对，不一致则令牌已失效（角色/密码变更后强制下线）
  const { getDb } = await import('../db/index.js')
  const db = getDb()
  const user = db
    .prepare('SELECT role, token_version FROM users WHERE id = ?')
    .get(payload.userId) as { role: string; token_version: number } | undefined

  if (!user) {
    return reply.status(401).send({ ok: false, error: '用户不存在' })
  }
  if (user.token_version !== payload.tokenVersion) {
    return reply.status(401).send({ ok: false, error: '登录已失效，请重新登录' })
  }

  // 刷新角色（以数据库为准）
  req.user = {
    ...payload,
    role: user.role as 'admin' | 'member' | 'guest',
  }
}

export function requireRole(...roles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      return reply.status(401).send({ ok: false, error: '未登录' })
    }
    if (!roles.includes(req.user.role)) {
      return reply.status(403).send({ ok: false, error: '权限不足' })
    }
  }
}

/** 检查项目是否可写：线上模式默认项目只读，仅允许添加成员。返回 false 时已发送错误响应 */
export function ensureProjectWritable(projectId: string, reply: FastifyReply): boolean {
  if (projectId === 'default' && config.defaultProjectReadonly) {
    reply.status(403).send({ ok: false, error: '默认项目已锁定，仅供查阅。如需编写文档请创建新项目' })
    return false
  }
  return true
}
