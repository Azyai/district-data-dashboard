export const screens = [
  { id: 'overview', title: '路网监测' },
  { id: 'grid', title: '网格治理' },
  { id: 'waters', title: '水域态势' },
  { id: 'population', title: '城镇人口' },
  { id: 'governance', title: '基层治理' },
  { id: 'economy', title: '经济发展' },
  { id: 'diagnosis', title: '区域诊断' },
] as const

export type ScreenId = (typeof screens)[number]['id']
export type DisplayPage = Exclude<ScreenId, 'overview'> | 'roads'

export function displayPath(page: DisplayPage, areaId: string, month?: string | null) {
  return screenPath(page === 'roads' ? 'overview' : page, areaId, month)
}

export function screenPath(screen: ScreenId, areaId = 'mentougou', month?: string | null) {
  if (screen === 'overview') return areaId === 'mentougou' ? '/' : '/areas/' + encodeURIComponent(areaId)
  const params = new URLSearchParams()
  if (areaId !== 'mentougou') params.set('area', areaId)
  if (screen === 'governance' && month) params.set('month', month)
  const query = params.toString()
  return '/screens/' + screen + (query ? '?' + query : '')
}
