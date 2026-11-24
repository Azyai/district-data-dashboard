import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { request, writeRequest } from '../../api/client'
import type { components } from '../../api/generated/openapi'

export type SideMetrics = components['schemas']['CockpitSideMetrics']
export type SideSelection = components['schemas']['CockpitSideSelection']
export const sideMetricsKey = ['cockpit-side-metrics'] as const
const channelName = 'district-side-metrics-updated'

export const defaultSideMetrics: SideMetrics = {
  revision: 1,
  left: ['governance-events', 'service-cases'],
  right: ['air-quality-rate', 'road-traffic'],
}

export function useSideMetrics() {
  const cache = useQueryClient()
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(channelName)
    channel.onmessage = () => {
      void cache.invalidateQueries({ queryKey: sideMetricsKey })
      void cache.invalidateQueries({ queryKey: ['cockpit-area'] })
    }
    return () => channel.close()
  }, [cache])
  return useQuery({
    queryKey: sideMetricsKey,
    queryFn: ({ signal }) => request<SideMetrics>('/api/v1/cockpit/side-metrics', { signal }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export async function saveSideMetrics(input: SideMetrics) {
  const saved = await writeRequest<SideMetrics>('/api/v1/admin/cockpit/side-metrics', 'PUT', {
    headers: { 'If-Match': '"' + input.revision + '"' },
    body: { left: input.left, right: input.right },
  })
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(channelName)
    channel.postMessage(saved.revision)
    channel.close()
  }
  return saved
}
