import { API_BASE, parseOkResponse } from './api'
import { toastError } from './toast'

export interface ApiRequestOptions {
  /** URL query params，自动编码 */
  params?: Record<string, string | number | boolean | undefined | null>
  /** 额外 headers */
  headers?: Record<string, string>
  /** AbortSignal，用于取消 */
  signal?: AbortSignal
  /**
   * 错误时是否自动 toast
   * - true（默认）：弹出 toast.error
   * - false：静默，仅抛错
   * - string：自定义 toast 前缀，如 '提交失败'
   */
  toast?: boolean | string
}

function buildUrl(path: string, params?: ApiRequestOptions['params']): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return API_BASE ? url.toString() : url.pathname + url.search
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: ApiRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers }
  const init: RequestInit = { method, headers, signal: opts.signal }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  const res = await fetch(buildUrl(path, opts.params), init)
  await parseOkResponse(res)

  if (res.status === 204) {
    return undefined as T
  }

  const contentType = res.headers.get('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    return undefined as T
  }

  return res.json() as Promise<T>
}

function handleError(err: unknown, opts: ApiRequestOptions): never {
  if (err instanceof Error && err.name === 'AbortError') {
    throw err
  }

  const message = err instanceof Error ? err.message : String(err)
  if (opts.toast !== false) {
    const prefix = typeof opts.toast === 'string' ? opts.toast : '请求失败'
    toastError(`${prefix}：${message}`)
  }
  throw err
}

export const apiClient = {
  get<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
    return request<T>('GET', path, undefined, opts).catch(err => handleError(err, opts ?? {}))
  },

  post<T>(path: string, body?: unknown, opts?: ApiRequestOptions): Promise<T> {
    return request<T>('POST', path, body, opts).catch(err => handleError(err, opts ?? {}))
  },

  patch<T>(path: string, body?: unknown, opts?: ApiRequestOptions): Promise<T> {
    return request<T>('PATCH', path, body, opts).catch(err => handleError(err, opts ?? {}))
  },

  delete<T = void>(path: string, opts?: ApiRequestOptions): Promise<T> {
    return request<T>('DELETE', path, undefined, opts).catch(err => handleError(err, opts ?? {}))
  },

  /** 需要原始 Response 的特殊场景使用 */
  fetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${API_BASE}${path}`, init)
  },
}
