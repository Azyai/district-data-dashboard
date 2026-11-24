import { modelAreaName } from './mapBoundaries'

export type MonitorPage = 'roads' | 'grid' | 'waters'
export type MonitorArea = { id: string; name: string; level: string; breadcrumbs?: { name: string }[] }
export type Road = {
  name: string; town: string; village?: string | null; klass: string; km: number; congestion: number; speed: number
  flow: number; lanes: number; status: string; point?: [number, number]
}
export type Water = { name: string; town: string; village?: string | null; lon: number; lat: number }
type Grid = { name: string; micro: number; buildings: number }
export type MonitoringCatalog = {
  roads: Road[]; waters: Water[]; corridors: string[]; baseHour: number; hourly: number[]; flow: number[]
  towns: (Grid & { villages: number })[]; villages: (Grid & { town: string; point: [number,number] })[]
  grids: { towns: number; villages: number; micro: number; buildings: number }
}

export async function readMonitoring(signal?: AbortSignal): Promise<MonitoringCatalog> {
  const response = await fetch(import.meta.env.BASE_URL + 'monitoring/catalog.json', { signal })
  if (!response.ok) throw new Error('专题演示资料暂不可用')
  return response.json()
}

export const roadColors: Record<string, string> = { 畅通: '#2ee6a6', 缓行: '#f0c14a', 拥堵: '#ff7a32', 严重拥堵: '#ff3b5c' }
export const number = (value: number, digits = 0) => value.toLocaleString('zh-CN', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
})
export const roadStatus = (index: number) => index < 1.6 ? '畅通' : index < 2.2 ? '缓行' : index < 3.2 ? '拥堵' : '严重拥堵'
export const roadLabel = (road: Road) => road.name.startsWith('未命名_')
  ? road.klass + ' ' + road.name.split('_').at(-1) : road.name
export function profileSeed(text: string) {
  let hash = 2166136261
  for (const char of text) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619)
  return hash >>> 0
}
export const gridScore = (name: string) => 70 + profileSeed(name) % 27
export const waterKind = (name: string) => name.includes('水库') ? '水库' : name.includes('河') ? '河流' : /湖|潭/.test(name) ? '湖泊' : '沟道'
const reservoirRates: Record<string, number> = { 斋堂水库: 86, 落坡岭水库: 72, 珠窝水库: 64, 三家店水库: 91, 苇子水库: 58, 龙口水库: 47 }
export const reservoirRate = (name: string) => reservoirRates[name] ?? 45 + profileSeed(name) % 46

export function beijingHalfHour(timestamp = Date.now()) {
  const minutes = (Math.floor(timestamp / 60_000) + 8 * 60) % 1440
  return Math.floor(minutes / 30) / 2
}

export function slotLabel(hour: number) {
  return String(Math.floor(hour)).padStart(2, '0') + (Number.isInteger(hour) ? ':00' : ':30')
}

export function monitoringSnapshot(catalog: MonitoringCatalog, page: MonitorPage, area: MonitorArea, hour = beijingHalfHour()) {
  const name = modelAreaName(area)
  const scoped = (row: { town: string; village?: string | null }) => area.level === 'district'
    || (area.level === 'town' ? row.town === name : row.village === name && (!area.breadcrumbs?.[1] || row.town === area.breadcrumbs[1].name))
  const start = Math.floor(hour)
  const current = catalog.hourly[start] ?? 1
  const next = catalog.hourly[(start + 1) % 24] ?? current
  const factor = current + (next - current) * (hour - start)
  const roads = page === 'roads' ? catalog.roads.filter(scoped).map(base => {
    const congestion = Math.round(base.congestion * factor * 100) / 100
    return { ...base, congestion, status: roadStatus(congestion), speed: Math.round(Math.min(120, Math.max(8, base.speed / factor ** .55))),
      flow: Math.round(base.flow * (.62 + .38 * factor)) }
  }).sort((a,b) => b.congestion - a.congestion) : []
  const waters = page === 'waters' ? catalog.waters.filter(scoped) : []
  const towns = catalog.towns.filter(row => area.level === 'district' || row.name === (area.breadcrumbs?.[1]?.name ?? area.name))
  const villages = catalog.villages.filter(row => area.level === 'district' || (area.level === 'town' ? row.town === name
    : row.name === name && (!area.breadcrumbs?.[1] || row.town === area.breadcrumbs[1].name)))
  const kpis: {label: string; value: string; unit: string}[] = []
  const stat = (label: string, value: number, unit: string, digits = 0) => kpis.push({ label, value: number(value, digits), unit })
  if (page === 'roads' && roads.length) {
    const km = roads.reduce((sum, row) => sum + row.km, 0)
    stat('拥堵指数', roads.reduce((sum, row) => sum + row.congestion * row.km, 0) / km, '', 2)
    stat('平均车速', roads.reduce((sum, row) => sum + row.speed * row.km, 0) / km, 'km/h')
    stat('监测流量', roads.reduce((sum, row) => sum + row.flow, 0), '辆/时')
    stat('畅通里程', roads.reduce((sum, row) => sum + (row.status === '畅通' ? row.km : 0), 0), 'km')
  } else if (page === 'grid' && villages.length) {
    const scope = area.level === 'district' ? [catalog.grids] : area.level === 'town' ? towns : villages
    stat('村居网格', villages.length, '个')
    stat('微网格', scope.reduce((n, row) => n + row.micro, 0), '个')
    stat('楼栋覆盖', scope.reduce((n, row) => n + row.buildings, 0), '栋')
    stat('运行指数', area.level === 'district' ? towns.reduce((n, row) => n + gridScore(row.name), 0) / towns.length : gridScore(area.name), '分')
  } else if (page === 'waters' && waters.length) {
    const share = waters.length / catalog.waters.length
    stat('监测水域', waters.length, '处')
    stat('监测流量', 186.4 * share, 'm³/s', 1)
    stat('水库蓄水', 1.28 * waters.filter(w => waterKind(w.name) === '水库').length / catalog.waters.filter(w => waterKind(w.name) === '水库').length, '亿m³', 2)
    stat('今日告警', 7 * share, '条')
  }
  return { kpis, roads, waters, towns, villages, factor }
}
export type MonitoringSnapshot = ReturnType<typeof monitoringSnapshot>
