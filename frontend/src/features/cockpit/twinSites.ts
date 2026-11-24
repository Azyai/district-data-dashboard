import type { Coordinates } from './mapBoundaries'

export type TwinId = 'tianjie' | 'jingxi'

type TwinSite = {
  name: string
  file: string
  kind: string
  location: string
  source: string
  mapPoint: Coordinates
  modelPoint: readonly [number, number]
}

export const twinSites: Record<TwinId, TwinSite> = {
  tianjie: {
    name: '龙湖北京长安天街',
    file: 'tianjie.glb',
    kind: '商业综合体',
    location: '新城大街与金安路交叉口',
    source: 'https://www.bjmtg.gov.cn/bjmtg/c104900/202507/6feef6ff44a1436881e3ad250448f480.shtml',
    mapPoint: [116.118288, 39.901307],
    modelPoint: [-3621, -1794],
  },
  jingxi: {
    name: '京西智谷',
    file: 'jingxi.glb',
    kind: '人工智能产业园',
    location: '中关村门头沟园 · 长安街西延线',
    source: 'https://www.bjmtg.gov.cn/bjmtg/ysxx/202503/dc1077adac40476cbe288c52b6590c98.shtml',
    mapPoint: [116.123829, 39.891575],
    modelPoint: [-3149, -719],
  },
}

export function isTwinId(id: string | undefined): id is TwinId {
  return id !== undefined && Object.hasOwn(twinSites, id)
}

export function twinPath(id: TwinId) {
  return '/twins/' + id
}
