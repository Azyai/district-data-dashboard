export type CockpitLocation = {
  id: string
  name: string
  level: 'district' | 'town' | 'village'
  parentId?: string | null
}

export type CockpitIntent =
  | { kind: 'navigate'; areaId: string }
  | { kind: 'problems'; areaId: string; question: string }
  | { kind: 'ask'; areaId: string; question: string }
  | { kind: 'clarify'; message: string; reason?: 'missing-navigation-target' }

type Mention = {
  start: number
  end: number
  name: string
  official: boolean
  locations: CockpitLocation[]
}

const locationId = /^[a-z][a-z0-9-]{0,63}$/
const polite = /^(?:请问|请你?|麻烦你?|能否|能不能|可以|帮我|给我|我想要|我想|我要|我希望)+/
const opening = /^(?:切换(?:到|至)?|跳转(?:到|至)?|返回(?:到)?|回到|进入|打开|定位(?:到)?|看一下|看一看|查看|看看|查询|查一下|浏览|显示|看)/
const explicitNavigation = /^(?:切换|跳转|返回|回到|进入|打开|定位)/
const navigationNegated = /^(?:先别|别|不要|不用|不必)(?:切换|跳转|返回|回到|进入|打开|定位)/
const questionWords = /多少|什么|哪些|哪个|哪里|为何|为什么|怎么|如何|是否|吗|呢|走势|趋势|变化|同比|环比/
const previousLevel = /^(?:返回(?:到)?|回到?|切换到)?(?:上一级|上一层)(?:区域|区划)?$/
const currentRef = /此处|这里|这儿|本地|这个(?:区域|地方|区|镇|村)|(?:本|当前)(?:区域|区划|辖区|地区)|当前位置/g
const relativeRef = /上一级|上一层|全区|本区|(?:全|本)(?:镇|街道|村)/g
const navigationTail = /^(?:的)?(?:最新|当前|今天)?(?:数据(?:面板)?|驾驶舱|看板|页面|界面|概览|总览|运行情况|情况|信息)?(?:吧)?$/
const problemWord = '(?:问题|预警|告警|风险|异常|待处置事项)'
const problemQuestion = new RegExp('(?:有|存在|出现)(?:哪些|什么)(?:需要关注的)?' + problemWord)
const problemList = new RegExp('^(?:(?:查看|列出|显示|看看|看一下|看)?)?(?:当前|近期|最新|待处理|待处置)?(?:的)?' + problemWord + '(?:列表|清单|明细|详情|情况)?$')
const areaEnd = /(?:街道办事处|街道|社区|乡|镇|村|区|县)$/
const likelyUnknownArea = /[\p{Script=Han}]{1,18}(?:街道|社区|新区|乡|镇|村|区|县)(?=的|里|有|办结率|治理事件|服务办件|预警|数据|$)/u
const nonNames = /^(?:社区|社区治理|乡镇|镇街|村社|农村|城区|城区社区|地区|区域|辖区|片区|市区|街道|统计区|园区|全域)$/
const aliasSuffix = /^(?:的|和|与|及|跟|或|这边|那边|今天|现在|之前|目前|最近|昨天|今年|有哪些|有什么|有多少|还剩|办结|受理量|治理|政务|预警|告警|空气|车流|数据|看板|驾驶舱|情况|趋势|人口|接诉|既诉|即诉|热线|水务|水质|供水|吧)/

function normalize(text: string): string {
  return text.normalize('NFKC').replace(/[\s，。？！、,.!?；;：:“”"「」]/g, '')
}

function pathOf(
  location: CockpitLocation,
  byId: ReadonlyMap<string, CockpitLocation>,
): CockpitLocation[] {
  const path: CockpitLocation[] = []
  const visited = new Set<string>()
  let item: CockpitLocation | undefined = location
  while (item && !visited.has(item.id)) {
    visited.add(item.id)
    path.unshift(item)
    item = item.parentId ? byId.get(item.parentId) : undefined
  }
  return path
}

function mentionsOf(text: string, locations: readonly CockpitLocation[]): Mention[] {
  const all: Mention[] = []
  for (const location of locations) {
    const officialName = normalize(location.name)
    const shortName = officialName.replace(areaEnd, '')
    for (const [name, official] of [[officialName, true], [shortName, false]] as const) {
      if (!name || (!official && (name.length < 2 || name === officialName))) continue
      const start = text.indexOf(name)
      if (start < 0) continue
      const end = start + name.length
      if (!official && end !== text.length && !aliasSuffix.test(text.slice(end))) continue
      const existing = all.find((item) => item.start === start && item.end === end && item.official === official)
      if (existing) existing.locations.push(location)
      else all.push({ start, end, name, official, locations: [location] })
    }
  }

  const matches: Mention[] = []
  all.sort((a, b) => Number(b.official) - Number(a.official) || b.name.length - a.name.length || a.start - b.start)
  for (const candidate of all) {
    if (!matches.some((item) => item.start < candidate.end && candidate.start < item.end)) {
      matches.push(candidate)
    }
  }
  return matches.sort((a, b) => a.start - b.start)
}

function removeMentions(text: string, matches: readonly Mention[]): string {
  let remaining = text
  for (const mention of [...matches].reverse()) {
    remaining = remaining.slice(0, mention.start) + remaining.slice(mention.end)
  }
  return remaining
}

function branchDepth(path: readonly string[], current: readonly string[]): number {
  const mismatch = path.findIndex((id, index) => id !== current[index])
  return mismatch < 0 ? path.length : mismatch
}

function candidatesFor(
  mention: Mention,
  matches: readonly Mention[],
  paths: ReadonlyMap<string, readonly string[]>,
  currentPath: readonly string[],
): CockpitLocation[] {
  if (mention.locations.length === 1) return mention.locations

  const known = matches.flatMap((item) => item.locations.length === 1 ? [item.locations[0].id] : [])
  const entries = mention.locations.map((location) => {
    const path = paths.get(location.id) ?? []
    return {
      location,
      qualifiers: known.filter((id) => path.includes(id)).length,
      depth: branchDepth(path, currentPath),
      exact: Number(location.id === currentPath.at(-1)),
    }
  }).sort((a, b) => b.qualifiers - a.qualifiers || b.exact - a.exact || b.depth - a.depth)
  const winner = entries[0]
  return entries.filter((item) => item.qualifiers === winner.qualifiers && item.exact === winner.exact
    && item.depth === winner.depth).map((item) => item.location)
}

function clarifyAreas(locations: readonly CockpitLocation[], byId: ReadonlyMap<string, CockpitLocation>): CockpitIntent {
  const options = [...new Map(locations.map((item) => [item.id, item])).values()]
    .slice(0, 4)
    .map((item) => {
      const parent = item.parentId ? byId.get(item.parentId) : undefined
      return parent ? item.name + '（' + parent.name + '）' : item.name
    })
  return { kind: 'clarify', message: '请指定一个区域。找到' + options.join('、') + '。' }
}

function relativeLocation(match: string, path: readonly CockpitLocation[]): CockpitLocation | undefined {
  if (match === '上一级' || match === '上一层') return path.at(-2)
  if (match === '全区' || match === '本区') return path.find((item) => item.level === 'district')
  if (match.endsWith('村')) return path.find((item) => item.level === 'village')
  return path.find((item) => item.level === 'town'
    && (match.endsWith('街道') ? item.name.endsWith('街道') : !item.name.endsWith('街道')))
}

export function interpretCockpitIntent(
  question: string,
  currentAreaId: string,
  locations: readonly CockpitLocation[],
  isTopicQuestion?: (question: string) => boolean,
): CockpitIntent {
  const text = normalize(question).replace(polite, '')
  const byId = new Map(locations.filter((item) => locationId.test(item.id)).map((item) => [item.id, item]))
  const current = byId.get(currentAreaId)
  if (!text) return { kind: 'clarify', message: '请输入想查看的区域或问题。' }
  if (!current) return { kind: 'clarify', message: '当前区域不可用，请先从区域目录选择。' }
  if (navigationNegated.test(text)) return { kind: 'clarify', message: '已保留当前区域。可继续查询本区域指标。' }

  const currentPath = pathOf(current, byId)
  if (previousLevel.test(text)) {
    const parent = currentPath.at(-2)
    return parent
      ? { kind: 'navigate', areaId: parent.id }
      : { kind: 'clarify', message: '当前已在最上一级区域。' }
  }

  const paths = new Map([...byId.values()].map((item) => [item.id, pathOf(item, byId).map(({ id }) => id)]))
  const matches = mentionsOf(text, [...byId.values()])
  const withoutNames = removeMentions(text, matches)
  const remaining = withoutNames.replace(currentRef, '')
  const currentIds = currentPath.map(({ id }) => id)
  const named: CockpitLocation[] = []
  for (const match of matches) {
    const candidates = candidatesFor(match, matches, paths, currentIds)
    if (candidates.length !== 1) return clarifyAreas(candidates, byId)
    named.push(candidates[0])
  }

  for (const [match] of remaining.matchAll(relativeRef)) {
    const location = relativeLocation(match, currentPath)
    if (!location) return { kind: 'clarify', message: '当前路径没有可用的' + match + '。请指定区域名称。' }
    named.push(location)
  }

  const selected = named.find((item) => named.every((candidate) => paths.get(item.id)?.includes(candidate.id)))
  if (named.length > 0 && !selected) return clarifyAreas(named, byId)
  const areaId = selected?.id ?? current.id
  const residual = remaining.replace(relativeRef, '').replace(/的的/g, '的')
  const unknownName = residual.replace(opening, '').replace(/^(?:我在|在|当前|本地)/, '').match(likelyUnknownArea)?.[0]
  if (unknownName && !nonNames.test(unknownName)) {
    return { kind: 'clarify', message: '没有找到该区域。请使用区、镇街或村社的名称。' }
  }

  if (!isTopicQuestion?.(residual) && (problemQuestion.test(residual) || problemList.test(residual))) {
    return { kind: 'problems', areaId, question }
  }
  const requestedRegion = Boolean(selected) || remaining !== withoutNames
  if (requestedRegion && (residual === '' || (opening.test(residual)
    && navigationTail.test(residual.replace(opening, ''))))) {
    return { kind: 'navigate', areaId }
  }
  if (!requestedRegion && explicitNavigation.test(residual) && !questionWords.test(residual.replace(opening, ''))) {
    return { kind: 'clarify', reason: 'missing-navigation-target', message: '没有找到要打开的区域。请指定区、镇街或村社。' }
  }
  return { kind: 'ask', areaId, question }
}
