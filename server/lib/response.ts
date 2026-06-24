// ============================================================
// 统一 API 响应格式
//   成功：{ ok: true, data: T }
//   失败：{ ok: false, error: string }
// ============================================================

import type { FastifyReply } from 'fastify'

/** 通用成功响应 */
export function success<T>(data: T): { ok: true; data: T } {
  return { ok: true, data }
}

/** 创建资源成功响应 */
export function created(id: string): { ok: true; data: { id: string } } {
  return { ok: true, data: { id } }
}

/** 无数据成功响应 */
export function ok(): { ok: true } {
  return { ok: true }
}

/** 错误响应 */
export function fail(reply: FastifyReply, status: number, message: string): FastifyReply {
  return reply.status(status).send({ ok: false, error: message })
}
