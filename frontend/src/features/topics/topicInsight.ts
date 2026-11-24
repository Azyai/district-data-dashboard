import type { ComponentData, Manifest } from '../../api/client'

const aliases: Record<string, RegExp> = {
  'resident-total': /常住人口|人口(?:总数|总量|规模|(?:一共|总共)?(?:有|是)?多少)|多少人/,
  'working-age-rate': /劳动年龄|劳动人口/,
  'older-rate': /65\s*岁|老龄|老年人口/,
  'age-structure': /年龄|各年龄段/,
  'population-trend': /(?:常住)?人口(?:总量|规模|总数)?(?:的|有何|有什么)?(?:变化|趋势|走势)/,
  'household-structure': /家庭|家庭户|户规模/,
  'requests-total': /受理(?:总量|总数)|诉求(?:总量|总数|有多少)|多少件/,
  'resolved-rate': /办结率|已办比例/,
  'pending-requests': /待办理|未办结|待办/,
  'requests-by-type': /哪类|高频|分类|类型|最常见/,
  'requests-trend': /受理量|诉求.*(?:变化|趋势|走势)/,
  'requests-status': /办理进度|办理情况|已办结|待分派/,
  'daily-water': /日供水量|供水量|供了多少水/,
  'water-compliance': /出厂水|检测达标率/,
  'active-stations': /在线.*监测站|多少.*监测站/,
  'water-network-quality': /监测点|水质|各站/,
  'water-trend': /供水(?:量)?(?:的|有何|有什么)?(?:变化|趋势|走势)/,
  'water-mix': /用途|用水结构|用水分布|用水量/,
}

const historical = /去年|前年|上年|同比|环比|上月|上季度|历史同期|未来|预测/
const why = /为什么|是什么原因|为何|成因|导致|是不是因为/
const lowest = /最低|最少/
const trend = /变化|趋势|走势|近期|近[七六67]/
const overview = /概况|总结|总体|整体|怎么样|概览|做个分析|解读|主要情况|分析一下/
const concerns = /问题|风险|关注|异常/
const structure = /结构|分布|各(?:类|年龄段)/
const extremes = /最低|最高|最少|最多/
const focusMetrics: Readonly<Record<string, readonly string[]>> = {
  population: ['older-rate', 'age-structure'],
  hotline: ['pending-requests', 'requests-by-type'],
  water: ['water-compliance', 'water-network-quality'],
}
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
type Item = { component: Manifest['components'][number]; row: ComponentData['results'][number] }
export type TopicInsight = { text: string; evidence: string[] }

function valueText(value: number, unit: string) {
  return number.format(value) + (unit === '%' ? unit : ' ' + unit)
}

function evidence(item: Item) {
  return item.component.title
}

function describe(item: Item, question: string): string {
  const { component: { title, type }, row: { value, unit, points } } = item
  if (typeof value === 'number') return title + '为 ' + valueText(value, unit) + '。'
  if (!points?.length) return title + '暂无观测。'
  if (type === 'trend' && points.length > 1) {
    const first = points[0]
    const last = points[points.length - 1]
    const diff = last.value - first.value
    const change = diff === 0 ? '首尾持平' : (diff > 0 ? '增加 ' : '减少 ') + valueText(Math.abs(diff), unit === '%' ? '个百分点' : unit)
    return title + '从 ' + first.label + '的 ' + valueText(first.value, unit) + '到 ' + last.label + '的 ' + valueText(last.value, unit) + '，' + change + '。'
  }
  const named = points.find(point => question.includes(point.label))
  if (named) return named.label + '为 ' + valueText(named.value, unit) + '。'
  if (structure.test(question) && !extremes.test(question) && points.length <= 8) {
    return title + '为' + points.map(point => point.label + ' ' + valueText(point.value, unit)).join('、') + '。'
  }
  const order = lowest.test(question) ? -1 : 1
  const peak = points.reduce((best, point) => order * (point.value - best.value) > 0 ? point : best)
  const tied = points.filter(point => point.value === peak.value).map(point => point.label).join('、')
  return title + '中，' + tied + (order > 0 ? '最高，为 ' : '最低，为 ') + valueText(peak.value, unit) + '。'
}

export function analyzeTopic(question: string, manifest: Manifest, snapshot: ComponentData): TopicInsight {
  const text = question.normalize('NFKC').trim()
  const byId = new Map(snapshot.results.map(result => [result.componentId, result]))
  const items = manifest.components.flatMap(component => {
    const row = byId.get(component.id)
    return row ? [{ component, row }] : []
  })
  const asksTrend = trend.test(text)
  const ranked = items
    .map(item => {
      const exact = text.includes(item.component.title)
      const includesPoint = item.component.type === 'ranking' && item.row.points?.some(point => text.includes(point.label))
      const alias = aliases[item.component.metricId]?.test(text)
      const score = (exact ? 8 : 0) + (includesPoint ? 4 : 0) + (alias ? 2 : 0)
      return { item, score }
    })
    .sort((a, b) => b.score - a.score)
  const matching = ranked.find(candidate => candidate.score > 0)?.item
  const timeSeries = ranked.find(candidate => candidate.item.component.type === 'trend' && (!matching || candidate.score > 0))?.item
  const selected = asksTrend ? timeSeries : matching

  if (historical.test(text)) return {
    text: '当前模板只提供已发布的时段。这个请求需要额外历史数据或预测模型，请查看图表标注的时间范围。',
    evidence: [],
  }
  if (asksTrend && matching && !timeSeries) return {
    text: '当前模板仅提供「' + matching.component.title + '」的当前观测，暂无该指标的时间序列。',
    evidence: [evidence(matching)],
  }
  if (!selected && !overview.test(text) && !why.test(text) && !concerns.test(text)) return {
    text: '请选择图上已有指标，可询问指标值、近期趋势，或哪个类别最高或最低。',
    evidence: [],
  }
  const primary = items.find(item => item.component.type === 'kpi')
  const comparison = items.find(item => item.component.type === 'ranking')
  const relevant = concerns.test(text) ? focusMetrics[manifest.projectId]?.map(metricId =>
    items.find(item => item.component.metricId === metricId)) : undefined
  const used = selected ? [selected] : (relevant ?? [primary, comparison]).filter((item): item is Item => item !== undefined)
  if (!used.length) return { text: '当前已发布模板暂无可分析的指标。', evidence: [] }
  const note = why.test(text) ? '判断原因还需要相关记录或监测信息。'
    : concerns.test(text) ? '以上是当前观测，判定风险需核对业务阈值或现场记录。' : ''
  const comparisonText = !selected && relevant && manifest.projectId === 'water' ? '最低' : text
  return { text: used.map(item => describe(item, comparisonText)).join('') + note, evidence: used.map(evidence) }
}
