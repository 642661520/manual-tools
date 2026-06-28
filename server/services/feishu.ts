// 飞书服务：token 管理、消息发送、OAuth
import { config } from '../config.js'
import type { FeishuTokenResponse, FeishuUserResponse, FeishuUserInfoResponse } from '../types.js'

const FEISHU_HOST = config.feishuHost

// ---- Token 缓存 ----

interface TokenCache {
  token: string
  expiresAt: number // epoch ms
}

let tenantTokenCache: TokenCache | null = null

function getAppCredentials(): { appId: string; appSecret: string } {
  const appId = config.feishuAppId
  const appSecret = config.feishuAppSecret
  if (!appId || !appSecret) {
    throw new Error('飞书未配置：缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET')
  }
  return { appId, appSecret }
}

// ---- Tenant Access Token（Bot API 调用） ----

export async function getTenantAccessToken(): Promise<string> {
  if (tenantTokenCache && Date.now() < tenantTokenCache.expiresAt) {
    return tenantTokenCache.token
  }

  const { appId, appSecret } = getAppCredentials()

  const res = await fetch(`${FEISHU_HOST}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      `获取 tenant_access_token 失败: ${(body as Record<string, unknown>).code || res.status}`,
    )
  }

  const data = (await res.json()) as { code: number; tenant_access_token: string; expire: number }
  if (data.code !== 0) {
    throw new Error(`飞书 API 错误: ${data.code}`)
  }

  // 提前 120s 过期，留缓冲
  tenantTokenCache = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire - 120) * 1000,
  }

  return tenantTokenCache.token
}

function clearTenantTokenCache(): void {
  tenantTokenCache = null
}

// ---- App Access Token（OAuth 流程用） ----

export async function getAppAccessToken(): Promise<string> {
  const { appId, appSecret } = getAppCredentials()

  const res = await fetch(`${FEISHU_HOST}/open-apis/auth/v3/app_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })

  if (!res.ok) {
    throw new Error(`获取 app_access_token 失败: ${res.status}`)
  }

  const data = (await res.json()) as FeishuTokenResponse
  return data.app_access_token
}

// ---- 消息发送 ----

export interface FeishuCardContent {
  header: { title: { content: string; tag: string }; template?: string }
  elements?: Array<Record<string, unknown>>
}

export function buildCardMessage(
  title: string,
  body: string,
  options?: {
    color?: 'blue' | 'green' | 'orange' | 'red'
    link?: { url: string; title: string }
  },
): FeishuCardContent {
  const titleColor = options?.color || 'blue'
  const elements: Array<Record<string, unknown>> = [
    {
      tag: 'markdown',
      content: body,
    },
  ]

  if (options?.link) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: options.link.title },
          type: 'primary',
          url: options.link.url,
        },
      ],
    })
  }

  return {
    header: {
      title: { content: title, tag: 'plain_text' },
      template: titleColor,
    },
    elements,
  }
}

export async function sendFeishuMessage(openId: string, content: FeishuCardContent): Promise<void> {
  const token = await getTenantAccessToken()

  const res = await fetch(`${FEISHU_HOST}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: 'interactive',
      content: JSON.stringify(content),
    }),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: number; msg?: string }
    // Token 过期，清除缓存重试一次
    if (body.code === 99991663) {
      clearTenantTokenCache()
      const newToken = await getTenantAccessToken()
      const retryRes = await fetch(
        `${FEISHU_HOST}/open-apis/im/v1/messages?receive_id_type=open_id`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newToken}`,
          },
          body: JSON.stringify({
            receive_id: openId,
            msg_type: 'interactive',
            content: JSON.stringify(content),
          }),
        },
      )
      if (!retryRes.ok) {
        const retryBody = (await retryRes.json().catch(() => ({}))) as {
          code?: number
          msg?: string
        }
        throw new Error(`飞书消息发送失败: ${retryBody.code} ${retryBody.msg || ''}`)
      }
      return
    }
    throw new Error(`飞书消息发送失败: ${body.code} ${body.msg || ''}`)
  }
}

// ---- OAuth ----

export interface FeishuUserInfo {
  open_id: string
  name: string
  avatar_url?: string
}

export function getFeishuAuthUrl(state: string, redirectUri: string): string {
  const { appId } = getAppCredentials()
  if (!redirectUri) {
    throw new Error('飞书 OAuth 未配置：无法确定回调地址')
  }
  return `${FEISHU_HOST}/open-apis/authen/v1/authorize?app_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
}

/** 从请求头推导前端域名（Origin → Referer → Host → 环境变量后备） */
export function getRedirectOrigin(req: {
  headers: Record<string, string | string[] | undefined>
  protocol: string
}): string {
  // 1. Origin header（跨域请求时浏览器自动发送，最可靠）
  const origin = req.headers.origin
  if (origin && typeof origin === 'string') {
    return origin
  }

  // 2. Referer header（同源 GET 请求时浏览器发送）
  const referer = req.headers.referer
  if (referer && typeof referer === 'string') {
    try {
      return new URL(referer).origin
    } catch {
      // Referer 解析失败，继续降级
    }
  }

  // 3. X-Forwarded-Host（反向代理场景）
  const fwdHost = req.headers['x-forwarded-host']
  const fwdProto = req.headers['x-forwarded-proto']
  if (fwdHost && typeof fwdHost === 'string') {
    const proto = (typeof fwdProto === 'string' ? fwdProto : 'http') as string
    return `${proto}://${fwdHost}`
  }

  // 4. Host header（同源请求兜底）
  const host = req.headers.host
  if (host && typeof host === 'string') {
    const proto = req.protocol || 'http'
    return `${proto}://${host}`
  }

  // 无法推导，返回空字符串（调用方 getFeishuAuthUrl 会抛出明确错误）
  return ''
}

export async function exchangeCodeForToken(code: string): Promise<FeishuUserInfo> {
  // 获取 app_access_token
  const appAccessToken = await getAppAccessToken()

  // 换取 user_access_token
  const userRes = await fetch(`${FEISHU_HOST}/open-apis/authen/v1/oidc/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${appAccessToken}`,
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
  })
  const userData = (await userRes.json()) as FeishuUserResponse

  // 获取用户信息
  if (userData.data?.access_token) {
    const infoRes = await fetch(`${FEISHU_HOST}/open-apis/authen/v1/user_info`, {
      headers: { Authorization: `Bearer ${userData.data.access_token}` },
    })
    const infoData = (await infoRes.json()) as FeishuUserInfoResponse
    return {
      open_id: infoData.data?.open_id || '',
      name: infoData.data?.name || '',
      avatar_url: infoData.data?.avatar_url,
    }
  }

  throw new Error('飞书授权失败')
}
