import { apiCodes, type ApiCode } from './generated/codes'
import type { paths } from './generated/openapi'

type Me = paths['/api/v1/me']['get']['responses'][200]['content']['application/json']['data']
type Manifest = paths['/api/v1/playback/{projectId}/manifest']['get']['responses'][200]['content']['application/json']['data']
type ComponentData = paths['/api/v1/playback/{projectId}/component-queries']['post']['responses'][200]['content']['application/json']['data']
type ComponentQuery = paths['/api/v1/playback/{projectId}/component-queries']['post']['requestBody']['content']['application/json']
type Csrf = paths['/api/v1/auth/csrf']['get']['responses'][200]['content']['application/json']['data']
type Login = paths['/api/v1/auth/demo-session']['post']['requestBody']['content']['application/json']
type CockpitArea = paths['/api/v1/cockpit/areas/{areaId}']['get']['responses'][200]['content']['application/json']['data']

type CockpitDirectory = paths['/api/v1/cockpit/locations']['get']['responses'][200]['content']['application/json']['data']

export type { Me, Manifest, ComponentData, CockpitArea, CockpitDirectory }
export type DemoPersona = Login['persona']

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function isEnvelope(value: unknown): value is { code: string; message: string; data?: unknown } {
  return typeof value === 'object' && value !== null &&
    'code' in value && typeof value.code === 'string' &&
    'message' in value && typeof value.message === 'string'
}

function fallbackMessage(status: number) {
  if (status === 401) return '会话已失效，请重新选择演示身份。'
  if (status === 403) return '当前身份没有访问权限。'
  return '服务暂时无法响应，请稍后重试。'
}

export async function request<Data>(path: string, options: RequestInit = {}): Promise<Data> {
  let response: Response
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: new Headers(options.headers),
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务，请检查网络后重试。')
  }
  const requestId = response.headers.get('X-Request-Id')
  const payload: unknown = await response.json().catch(() => null)
  if (options.signal?.aborted) options.signal.throwIfAborted()
  if (response.ok && isEnvelope(payload) && payload.code === '0' && 'data' in payload) return payload.data as Data

  const code = isEnvelope(payload) ? payload.code : 'INVALID_RESPONSE'
  const entry = Object.hasOwn(apiCodes, code) && code !== '0' ? apiCodes[code as ApiCode] : null
  throw new ApiError(response.status, code, entry?.message ?? fallbackMessage(response.status), requestId)
}

type WriteOptions = { body?: unknown; headers?: HeadersInit; signal?: AbortSignal }

export async function writeRequest<Data>(
  path: string,
  method: 'POST' | 'PUT',
  options: WriteOptions = {},
): Promise<Data> {
  const { body, signal } = options
  const csrf = await request<Csrf>('/api/v1/auth/csrf', { signal })
  const headers = new Headers(options.headers)
  headers.set(csrf.headerName, csrf.token)
  const multipart = body instanceof FormData
  if (body !== undefined && !multipart) headers.set('Content-Type', 'application/json')
  return request(path, {
    method,
    signal,
    headers,
    body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
  })
}

function post<Data>(path: string, body?: unknown, signal?: AbortSignal): Promise<Data> {
  return writeRequest(path, 'POST', { body, signal })
}

function playbackPath(projectId: string) {
  return '/api/v1/playback/' + encodeURIComponent(projectId)
}

export const dashboardApi = {
  locations: (signal: AbortSignal) => request<CockpitDirectory>('/api/v1/cockpit/locations', { signal }),
  area: (areaId: string, signal: AbortSignal) => request<CockpitArea>('/api/v1/cockpit/areas/' + encodeURIComponent(areaId), { signal }),
  identity: (signal: AbortSignal) => request<Me>('/api/v1/me', { signal }),
  signIn: (persona: DemoPersona) => post<Me>('/api/v1/auth/demo-session', { persona }),
  signOut: () => post<null>('/api/v1/auth/logout'),
  manifest: (projectId: string, signal: AbortSignal) => request<Manifest>(playbackPath(projectId) + '/manifest', { signal }),
  components: (projectId: string, query: ComponentQuery, signal: AbortSignal) =>
    post<ComponentData>(playbackPath(projectId) + '/component-queries', query, signal),
}
