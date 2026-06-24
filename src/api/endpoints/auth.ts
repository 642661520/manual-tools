import { api } from '../client'
import type {
  LoginResponse,
  MeResponse,
  ProfileUpdateResponse,
  PasswordChangeResponse,
  FeishuBindingResponse,
  FeishuBindingStatus,
  OAuthUrlResponse,
  UserDetail,
  OkResponse,
  CreateResponse,
} from '@shared/types'
import type {
  NotifyPrefsBody,
  CreateUserBody,
  ChangePasswordBody,
} from '@shared/types'

// ---- 认证 ----

export function login(username: string, password: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/api/auth/login', { username, password })
}

export function feishuLogin(code: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/api/auth/feishu/login', { code })
}

export function getFeishuLoginUrl(): Promise<OAuthUrlResponse> {
  return api.get<OAuthUrlResponse>('/api/auth/feishu/login-url')
}

// ---- 当前用户 ----

export function getCurrentUser(): Promise<MeResponse> {
  return api.get<MeResponse>('/api/auth/me')
}

export function updateProfile(displayName: string): Promise<ProfileUpdateResponse> {
  return api.put<ProfileUpdateResponse>('/api/auth/me', { displayName })
}

export function updateNotifyPrefs(data: NotifyPrefsBody): Promise<OkResponse> {
  return api.put<OkResponse>('/api/auth/me/notify', data)
}

export function changePassword(data: ChangePasswordBody): Promise<PasswordChangeResponse> {
  return api.put<PasswordChangeResponse>('/api/auth/me/password', data)
}

// ---- 用户管理 ----

export function getUsers(): Promise<UserDetail[]> {
  return api.get<UserDetail[]>('/api/auth/users')
}

export function createUser(data: CreateUserBody): Promise<CreateResponse> {
  return api.post<CreateResponse>('/api/auth/users', data)
}

export function deleteUser(id: string): Promise<OkResponse> {
  return api.delete<OkResponse>(`/api/auth/users/${id}`)
}

export function changeUserRole(id: string, role: string): Promise<OkResponse> {
  return api.put<OkResponse>(`/api/auth/users/${id}/role`, { role })
}

// ---- 飞书绑定 ----

export function getFeishuBindUrl(): Promise<OAuthUrlResponse> {
  return api.get<OAuthUrlResponse>('/api/auth/feishu/bind-url')
}

export function bindFeishu(code: string): Promise<FeishuBindingResponse> {
  return api.put<FeishuBindingResponse>('/api/auth/me/feishu-binding', { code })
}

export function getFeishuBindingStatus(): Promise<FeishuBindingStatus> {
  return api.get<FeishuBindingStatus>('/api/auth/me/feishu-binding')
}

export function unbindFeishu(): Promise<OkResponse> {
  return api.delete<OkResponse>('/api/auth/me/feishu-binding')
}
