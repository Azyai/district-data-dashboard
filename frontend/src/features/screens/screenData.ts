import type { CockpitArea } from '../../api/client'

const digits = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 })
export const formatNumber = (value: number) => digits.format(value)
export const ageNames = ['0–17 岁', '18–59 岁', '60 岁及以上'] as const
export const ageColors = ['#6cdaef', '#677fee', '#b19af9'] as const

type Ages = [number, number, number]
type TownSeed = [id: string, name: string, population: number, age: Ages]

const townSeeds: TownSeed[] = [
  ['yongding', '永定镇', 104600, [16, 66, 18]],
  ['dayu', '大峪街道', 76800, [13, 62, 25]],
  ['longquan', '龙泉镇', 59400, [15, 65, 20]],
  ['chengzi', '城子街道', 43200, [12, 63, 25]],
  ['dongxinfang', '东辛房街道', 27200, [13, 60, 27]],
  ['tanzhesi', '潭柘寺镇', 18600, [14, 64, 22]],
  ['junzhuang', '军庄镇', 12700, [13, 62, 25]],
  ['wangping', '王平镇', 10900, [11, 59, 30]],
  ['zhaitang', '斋堂镇', 10600, [11, 60, 29]],
  ['miaofengshan', '妙峰山镇', 9600, [12, 62, 26]],
  ['qingshui', '清水镇', 9100, [10, 60, 30]],
  ['yanchi', '雁翅镇', 8400, [11, 58, 31]],
  ['datai', '大台街道', 6900, [10, 57, 33]],
]

export const towns = townSeeds.map(([id, name, population, [children, workingAge, older]]) => {
  const teens = workingAge * 3 / 45
  return { id, name, population, age: [Number((children + teens).toFixed(1)), Number((workingAge - teens).toFixed(1)), older] as Ages }
})

export const district = {
  id: 'mentougou', name: '门头沟区',
  population: towns.reduce((sum, town) => sum + town.population, 0),
  age: [0, 0, 0] as Ages,
}
district.age = [0, 1, 2].map(index => towns.reduce((sum, town) => sum + town.population * town.age[index], 0) / district.population) as Ages

export function townIdOf(area: CockpitArea) {
  return area.breadcrumbs.find(parent => parent.level === 'town')?.id ?? (area.level === 'town' ? area.id : null)
}

export function populationFor(area: CockpitArea): typeof district | null {
  if (area.level === 'district') return district
  const town = towns.find(town => town.id === townIdOf(area))
  if (!town || area.level === 'town') return town ?? null
  const seed = [...area.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 128, 0)
  return { id: area.id, name: area.name, population: Math.round(town.population * (.05 + seed / 1600)), age: town.age }
}

const economy = {
  gdp: [131.4, 153.8, 184.9, 211.7, 241.5, 268.5],
  investment: [48.2, 53.6, 59.4, 65.1, 71.8, 78.6],
  sales: [42.8, 52.3, 63.5, 73.6, 85.2, 96.8],
  services: [
    { label: '政策咨询', count: 61, done: 59 },
    { label: '审批协调', count: 50, done: 48 },
    { label: '用工对接', count: 39, done: 38 },
    { label: '融资对接', count: 34, done: 32 },
  ],
  industries: [
    { label: '人工智能', value: 118 }, { label: '超高清视听', value: 82 },
    { label: '心血管医疗器械', value: 64 }, { label: '文旅休闲', value: 62 },
  ],
  projectCount: 42,
  projects: [
    { name: '智算服务平台升级', townId: 'yongding', industry: '人工智能', status: '设备联调', progress: 78, planned: 75, next: '系统联调验收' },
    { name: '数字视听制作中心', townId: 'longquan', industry: '超高清视听', status: '主体施工', progress: 62, planned: 66, next: '主体结构封顶' },
    { name: '生态文旅配套提升', townId: 'zhaitang', industry: '文旅休闲', status: '施工准备', progress: 36, planned: 48, next: '完成施工准备' },
    { name: '医疗器械中试空间', townId: 'dayu', industry: '心血管医疗器械', status: '装修改造', progress: 54, planned: 60, next: '首批设备进场' },
  ],
}

export const projectAttentionGap = 5
export const months = ['5 月', '6 月', '7 月', '8 月', '9 月', '10 月']
export const latestValue = (values: number[]) => values.at(-1) ?? 0

export function economyFor(area: CockpitArea) {
  const scope = populationFor(area)
  const townIndex = towns.findIndex(town => town.id === scope?.id)
  const preceding = townIndex < 0 ? 0 : towns.slice(0, townIndex).reduce((sum, town) => sum + town.population, 0)
  const shareStart = preceding / district.population
  const shareEnd = (preceding + (scope?.population ?? 0)) / district.population
  // Round cumulative boundaries so all 13 town shares sum to the district figure.
  const scaleCount = (total: number) => Math.round(total * shareEnd) - Math.round(total * shareStart)
  const currency = (values: number[]) => values.map(value => scaleCount(Math.round(value * 10)) / 10)
  const industries = economy.industries.map(item => ({ ...item, value: scaleCount(item.value) }))
  const services = economy.services.map(item => {
    const done = scaleCount(item.done)
    return { label: item.label, count: done + scaleCount(item.count - item.done), done }
  })
  const projects = economy.projects.filter(project => area.level === 'district' || (area.level === 'town' && project.townId === area.id))
  return {
    gdp: currency(economy.gdp), investment: currency(economy.investment), sales: currency(economy.sales),
    served: industries.reduce((sum, item) => sum + item.value, 0),
    serviceCount: services.reduce((sum, item) => sum + item.count, 0),
    serviceDone: services.reduce((sum, item) => sum + item.done, 0),
    services, industries, projects,
    projectCount: Math.max(projects.length, scaleCount(economy.projectCount)),
  }
}
