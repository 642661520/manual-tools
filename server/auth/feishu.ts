// 飞书 OAuth 辅助函数（骨架，待飞书应用审核通过后启用）
// 文档: https://open.feishu.cn/document/common-capabilities/sso/api/obtain-user-identity
import type { FeishuTokenResponse, FeishuUserResponse, FeishuUserInfoResponse } from '../types.js'

interface FeishuUserInfo {
  open_id: string
  name: string
  department_name?: string
  avatar_url?: string
}

export function getFeishuAuthUrl(): string {
  const appId = process.env.FEISHU_APP_ID
  const redirectUri = process.env.FEISHU_REDIRECT_URI
  if (!appId || !redirectUri) {
    throw new Error('飞书 OAuth 未配置')
  }
  const state = Math.random().toString(36).slice(2)
  return `https://open.feishu.cn/open-apis/authen/v1/index?app_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`
}

export async function exchangeCodeForToken(code: string): Promise<FeishuUserInfo> {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET

  // 获取 app_access_token
  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const tokenData = await tokenRes.json() as FeishuTokenResponse
  const appAccessToken = tokenData.app_access_token

  // 换取 user_access_token
  const userRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${appAccessToken}`,
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
  })
  const userData = await userRes.json() as FeishuUserResponse

  // 获取用户信息
  if (userData.data?.access_token) {
    const infoRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      headers: { 'Authorization': `Bearer ${userData.data.access_token}` },
    })
    const infoData = await infoRes.json() as FeishuUserInfoResponse
    return {
      open_id: infoData.data?.open_id || '',
      name: infoData.data?.name || '',
      avatar_url: infoData.data?.avatar_url,
    }
  }

  throw new Error('飞书登录失败')
}

export function determineRole(openId: string): 'pm' | 'guest' {
  // 检查配置名单
  const pmList = (process.env.PM_OPEN_IDS || '').split(',').filter(Boolean)
  if (pmList.includes(openId)) return 'pm'

  // 默认角色：游客（需管理员授权后才能操作）
  return 'guest'
}
