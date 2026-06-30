// ============================================================
// 统一 fetch 封装
// - 自动注入 Authorization header
// - 自动设 Content-Type: application/json
// - 统一错误处理（抛 ApiRequestError）
// - 自动解包 { ok: true, data: T } 响应
// ============================================================

import { ApiRequestError } from '@shared/types'
import { toCamelCase } from './transform'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

interface RequestOptions extends Omit<RequestInit, 'method' | 'headers'> {
  headers?: Record<string, string>
  /** 跳过自动 Content-Type 设置（FormData 上传等场景） */
  noContentType?: boolean
}

const BASE = ''

function getToken(): string | null {
  return localStorage.getItem('auth_token')
}

/** 从 cookie 读取 CSRF token */
function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)
  return match ? match[1] : null
}

async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const token = getToken()
  const csrfToken = getCsrfToken()
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...options?.headers,
  }

  // 自动设 Content-Type: application/json（POST/PUT/PATCH，有 body 且未被跳过）
  if (
    !options?.noContentType &&
    method !== 'GET' &&
    method !== 'DELETE' &&
    body !== undefined &&
    !(body instanceof FormData)
  ) {
    headers['Content-Type'] = 'application/json'
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    ...options,
  }

  if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
    fetchOptions.body = body instanceof FormData ? body : JSON.stringify(body)
  }

  // 清理掉我们自己的选项，避免传入 fetch
  delete (fetchOptions as Record<string, unknown>).noContentType

  const res = await fetch(`${BASE}${path}`, fetchOptions)

  const contentType = res.headers.get('content-type') || ''

  // 二进制下载：返回原始 Response 供调用方处理
  if (
    contentType.includes('application/octet-stream') ||
    contentType.includes('application/zip') ||
    contentType.includes('application/pdf')
  ) {
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      throw new ApiRequestError(
        (errBody as Record<string, string>).error || `下载失败 (${res.status})`,
        res.status,
        errBody,
      )
    }
    return res as unknown as T
  }

  const data = toCamelCase<Record<string, unknown>>(
    await res.json().catch(() => ({}) as Record<string, unknown>),
  )

  if (!res.ok) {
    throw new ApiRequestError(
      typeof data?.error === 'string' ? data.error : `请求失败 (${res.status})`,
      res.status,
      data as Record<string, unknown>,
    )
  }

  // 解包标准响应格式：{ ok: true, data: T } → T
  // ok() 返回 { ok: true }（JSON 序列化后无 data 字段），直接返回整个对象
  if (data && typeof data === 'object' && 'ok' in data && data.ok === true && 'data' in data) {
    return data.data as T
  }
  return data as T
}

export const api = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('GET', path, undefined, options)
  },

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('POST', path, body, options)
  },

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('PUT', path, body, options)
  },

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('DELETE', path, undefined, options)
  },

  /** FormData 上传（不设置 Content-Type，由浏览器自动设 boundary） */
  upload<T>(path: string, formData: FormData): Promise<T> {
    return request<T>('POST', path, formData, { noContentType: true })
  },

  /** 下载二进制文件，返回 Blob */
  async download(path: string, filename?: string): Promise<void> {
    const res = await request<Response>('GET', path)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // 优先从响应头提取文件名
    const disposition = res.headers.get('content-disposition')
    if (disposition) {
      // 优先匹配 RFC 5987 格式: filename*=UTF-8''...
      const starMatch = disposition.match(/filename\*=(?:UTF-8''|utf-8'')([^;\n]*)/i)
      if (starMatch) {
        a.download = decodeURIComponent(starMatch[1].trim())
      } else {
        // 回退到普通 filename= 格式
        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (match) {
          let fname = match[1].replace(/['"]/g, '')
          // 如果包含 % 则尝试 URL 解码
          if (fname.includes('%')) {
            try {
              fname = decodeURIComponent(fname)
            } catch {
              /* 解码失败保持原样 */
            }
          }
          a.download = fname
        }
      }
    }
    // 其次使用传入的文件名，最后兜底
    if (!a.download) a.download = filename || 'download'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}
