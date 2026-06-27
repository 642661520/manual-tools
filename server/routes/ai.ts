/** AI 辅助写作 API */
import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/middleware.js'
import { aiChat, type AiRequest } from '../services/ai-assistant.js'
import { success, fail } from '../lib/response.js'

export async function aiRoutes(app: FastifyInstance) {
  app.post('/api/v1/ai/chat', { preHandler: authMiddleware }, async (req, reply) => {
    const { action, content, instruction } = req.body as AiRequest
    if (!content?.trim()) return fail(reply, 400, '请输入文本')
    if (!['polish', 'summarize', 'fix', 'expand', 'custom'].includes(action)) {
      return fail(reply, 400, '无效的操作类型')
    }
    try {
      const result = await aiChat({ action, content, instruction })
      return success({ result })
    } catch (e: unknown) {
      return fail(reply, 500, e instanceof Error ? e.message : 'AI 请求失败')
    }
  })
}
