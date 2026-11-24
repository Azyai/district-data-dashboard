import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { request } from '../../api/client'
import type { components, operations } from '../../api/generated/openapi'

const hotlinePageSize = 10
export const ticketStatusNames = { pending: '待派单', processing: '办理中', closed: '已办结' }

export type HotlineLane = NonNullable<NonNullable<operations['getHotlineTickets']['parameters']['query']>['lane']>
export type HotlineOverview = components['schemas']['HotlineOverview']
export type HotlineTicket = components['schemas']['HotlineTicket']

export function normalizeHotlineMonth(value?: string | null) {
  return value && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) ? value : undefined
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

export function hotlineOverview(areaId: string, month?: string) {
  return hotlineQuery<HotlineOverview>('overview', { areaId, ...(month && { month }) })
}

export function hotlineTickets(areaId: string, month: string, lane: HotlineLane, category: string) {
  const filters = { areaId, month, lane, ...(category && { category }) }
  return infiniteQueryOptions({
    queryKey: ['hotline', 'ticket-feed', filters],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => hotlineRequest<components['schemas']['HotlineTicketPage']>('tickets', {
      ...filters, page: String(pageParam), size: String(hotlinePageSize),
    }, signal),
    getNextPageParam: page => page.items.length && (page.page + 1) * page.size < page.total ? page.page + 1 : undefined,
    staleTime: 60_000,
  })
}

export function hotlineAnalysis(areaId: string, month?: string) {
  return hotlineQuery<components['schemas']['HotlineAnalysis']>('analysis', { areaId, ...(month && { month }) })
}

export function hotlineSemantics() {
  return hotlineQuery<components['schemas']['HotlineSemantics']>('semantics', {}, 5 * 60_000)
}

export function hotlineTicket(id: string, areaId: string, month: string) {
  return hotlineQuery<components['schemas']['HotlineTicketDetail']>('tickets/' + encodeURIComponent(id), { areaId, month })
}
