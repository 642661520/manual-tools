/**
 * AI 辅助写作服务 — OpenAI 兼容接口
 * 支持 OpenAI / DeepSeek / Ollama 等所有兼容提供商
 */
import OpenAI from 'openai'
import MarkdownIt from 'markdown-it'
import { config } from '../config.js'

const md = new MarkdownIt({ html: false, linkify: true })

function getClient(): OpenAI | null {
  if (!config.aiBaseUrl && !config.aiApiKey) return null
  return new OpenAI({
    baseURL: config.aiBaseUrl || undefined,
    apiKey: config.aiApiKey || 'sk-placeholder',
  })
}

const SYSTEM_PROMPT = `你是一个技术文档助手，帮助优化操作手册内容。
默认用中文回复。当用户要求翻译或其他语言时，严格按照用户指令执行。
使用 Markdown 格式输出（标题用 ###、列表用 -、代码用反引号等）。`

export interface AiRequest {
  action: 'polish' | 'summarize' | 'fix' | 'expand' | 'custom'
  content: string
  instruction?: string
}

export async function aiChat(req: AiRequest): Promise<string> {
  const client = getClient()
  if (!client) throw new Error('AI 服务未配置，请设置 AI_BASE_URL 和 AI_API_KEY 环境变量')

  const prompts: Record<string, string> = {
    polish: `请润色以下中文操作手册文本，使其更清晰、专业、易读。保持原意和技术术语不变。直接输出润色后的中文文本：\n\n${req.content}`,
    summarize: `请用 2-3 句中文总结以下操作手册内容，提取核心要点：\n\n${req.content}`,
    fix: `请修正以下中文文本中的语法错误、错别字和表达不清的地方，保持原意不变。直接输出修正后的中文文本：\n\n${req.content}`,
    expand: `请将以下简要说明扩展为详细的中文操作步骤，包含必要的背景说明和注意事项：\n\n${req.content}`,
  }

  const prompt =
    req.action === 'custom'
      ? `${req.instruction}\n\n原文：\n${req.content}`
      : prompts[req.action] || prompts.polish

  const resp = await client.chat.completions.create({
    model: config.aiModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  })

  const raw = resp.choices[0]?.message?.content || '(AI 未返回内容)'
  // AI 返回 Markdown，转为 HTML（TipTap 需要 HTML）
  return md.render(raw)
}
