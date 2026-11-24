import { queryOptions } from '@tanstack/react-query'
import { request } from '../../api/client'
import type { components, operations } from '../../api/generated/openapi'

export const defaultHotlineMonth = '2026-10'
export const hotlinePageSize = 10

export type HotlineLane = NonNullable<NonNullable<operations['getHotlineTickets']['parameters']['query']>['lane']>
export type HotlineOverview = components['schemas']['HotlineOverview']
export type HotlineTicket = components['schemas']['HotlineTicket']

export function normalizeHotlineMonth(value?: string | null) {
  return value && /^2026-(?:0[1-9]|10)$/.test(value) ? value : defaultHotlineMonth
}

function hotlineRequest<Data>(resource: string, params: Record<string, string>, signal: AbortSignal) {
  const query = new URLSearchParams(params).toString()
  return request<Data>('/api/v1/hotline/' + resource + (query ? '?' + query : ''), { signal })
}

function hotlineQuery<Data>(resource: string, params: Record<string, string>, staleTime = 60_000) {
  return queryOptions({
    queryKey: ['hotline', resource, params],
    queryFn: ({ signal }) => hotlineRequest<Data>(resource, params, signal),
    staleTime,
  })
}

export function hotlineOverview(areaId: string, month = defaultHotlineMonth) {
  return hotlineQuery<HotlineOverview>('overview', { areaId, month })
}

export function hotlineTickets(areaId: string, month: string, lane: HotlineLane, category: string, page: number) {
  return hotlineQuery<components['schemas']['HotlineTicketPage']>('tickets', {
    areaId, month, lane, ...(category ? { category } : {}), page: String(page), size: String(hotlinePageSize),
  })
}

export function hotlineAnalysis(areaId: string, month: string) {
  return hotlineQuery<components['schemas']['HotlineAnalysis']>('analysis', { areaId, month })
}

export function hotlineSemantics() {
  return hotlineQuery<components['schemas']['HotlineSemantics']>('semantics', {}, 5 * 60_000)
}

export function hotlineTicket(id: string, areaId: string, month: string) {
  return hotlineQuery<components['schemas']['HotlineTicketDetail']>('tickets/' + encodeURIComponent(id), { areaId, month })
}
