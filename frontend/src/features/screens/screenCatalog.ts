export const screens = [
  { id: 'overview', title: '全区总览' },
  { id: 'population', title: '镇街人口' },
  { id: 'governance', title: '基层治理' },
  { id: 'economy', title: '经济发展' },
] as const

export type ScreenId = (typeof screens)[number]['id']

export function screenPath(screen: ScreenId, areaId = 'mentougou', month?: string | null) {
  if (screen === 'overview') return areaId === 'mentougou' ? '/' : '/areas/' + encodeURIComponent(areaId)
  const params = new URLSearchParams()
  if (areaId !== 'mentougou') params.set('area', areaId)
  if (screen === 'governance' && month) params.set('month', month)
  const query = params.toString()
  return '/screens/' + screen + (query ? '?' + query : '')
}
