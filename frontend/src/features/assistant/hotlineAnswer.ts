import type { QueryClient } from '@tanstack/react-query'
import { hotlineAnalysis, hotlineSemantics, normalizeHotlineMonth } from '../screens/hotlineApi'
import type { AssistantReply } from './VoiceAssistant'

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })

export async function queryHotlineAnswer(
  client: QueryClient,
  question: string,
  areaId: string,
  signal: AbortSignal,
  month?: string,
): Promise<AssistantReply> {
  signal.throwIfAborted()
  const namedMonth = question.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月份?/)
  const selectedMonth = namedMonth
    ? (namedMonth[1] ?? '2026') + '-' + namedMonth[2].padStart(2, '0') : normalizeHotlineMonth(month)
  if (selectedMonth !== normalizeHotlineMonth(selectedMonth)) {
    return { answer: { text: '接诉即办工单覆盖 2026 年 1 至 10 月，请选择这一期间的月份。', evidence: '' } }
  }
  const [data, semantics] = await Promise.all([
    client.fetchQuery(hotlineAnalysis(areaId, selectedMonth)),
    client.fetchQuery(hotlineSemantics()).catch(() => null),
  ])
  signal.throwIfAborted()

  const { totals, findings } = data
  const scope = { ...data.area, updatedAt: data.snapshotOn }
  if (/字段|数据字典|表结构|表之间|关联表/.test(question)) {
    if (!semantics) return { scope, answer: { text: '工单数据字典暂不可用，请重试。', evidence: '接诉即办字段字典' } }
    const table = semantics.fields.find(field => question.includes(field.table))?.table ?? 'hotline_ticket'
    const fields = semantics.fields.filter(field => field.table === table)
    const named = fields.filter(field => question.includes(field.column))
    const references = fields.flatMap(field => field.reference
      ? [field.column + ' 关联 ' + field.reference.table + '.' + field.reference.column] : [])
    let description = fields.map(field => field.column).join('、')
    if (named.length) description = named.map(field => field.column + '（' + field.sqlType + '）' + field.description
      + (field.reference ? '关联 ' + field.reference.table + '.' + field.reference.column + '。' : '')).join(' ')
    else if (/关联|连接|外键/.test(question)) description = references.join('，') || '没有外键字段'
    return { scope, answer: { text: table + ' 表。' + description, evidence: '接诉即办字段字典' } }
  }
  const directReadings = [
    { id: 'closedRate', match: /办结率|办结比例/, label: '办结率', value: totals.closedRate, unit: '%' },
    { id: 'late', match: /逾期|超时/, label: '逾期工单', value: totals.late, unit: '件' },
    { id: 'due', match: /临期/, label: '临期工单', value: totals.due, unit: '件' },
    { id: 'unassigned', match: /待派单|未派单/, label: '待派单工单', value: totals.unassigned, unit: '件' },
    { id: 'assigned', match: /已派单|派单量/, label: '已派单工单', value: totals.assigned, unit: '件' },
    { id: 'open', match: /正常待办/, label: '正常待办工单', value: totals.open, unit: '件' },
    { id: 'openTotal', match: /未办结|未结|(?:待办结|(?<!正常)待办)/, label: '未办结工单', value: totals.received - totals.closed, unit: '件' },
    { id: 'closed', match: /已办结|(?<!未)办结量|(?<!未)办结了?多少/, label: '已办结工单', value: totals.closed, unit: '件' },
    { id: 'processing', match: /办理中/, label: '办理中工单', value: totals.processing, unit: '件' },
    { id: 'received', match: /受理量|受理了?(?:多少|几件)|诉求有多少|工单有多少|工单总量|多少件?(?:诉求|工单)/, label: '受理工单', value: totals.received, unit: '件' },
  ]
  const asksCategory = /哪类|类别|高频|热点|诉求类型|工单类型/.test(question)
  const asksTrend = /趋势|环比|走势|变化/.test(question)
  const readings = directReadings.filter(reading => reading.match.test(question))
  const top = findings.find(finding => finding.id === 'top-category')
  const trend = findings.find(finding => finding.id === 'month-change')
  const descriptors = new Map(semantics?.metrics.map(metric => [metric.id, metric]))
  const describe = (ids: string[]) => [...new Set(ids)].map(id => descriptors.get(id))
    .filter(metric => metric !== undefined).slice(0, 2)
    .map(metric => metric.label + '（' + metric.description.replace(/。$/, '') + '）')

  let summary = findings.map(finding => finding.summary).join(' ')
  let evidence = describe(findings.map(finding => finding.metricId))
  if (/同比|去年|上年/.test(question)) {
    summary = '该月没有去年同期的工单数据，无法计算同比。'
    evidence = describe(['received'])
  } else if (asksCategory) {
    summary = top?.summary ?? '该区域该月暂无工单。'
    evidence = describe(['received'])
  } else if (asksTrend) {
    summary = trend?.summary ?? '该月没有可用于环比的上期工单数据。'
    evidence = describe(['receivedMoM'])
  } else if (readings.length > 0) {
    summary = readings.map(reading => reading.label + '为 ' + number.format(reading.value) + ' ' + reading.unit).join('，') + '。'
    evidence = readings.some(reading => reading.id === 'openTotal')
      ? ['未办结量按受理量减办结量计算', ...describe(readings.filter(reading => reading.id !== 'openTotal').map(reading => reading.id))]
      : describe(readings.map(reading => reading.id))
  }
  return {
    answer: {
      text: data.area.name + ' ' + data.month + ' 接诉即办演示快照。' + (summary || '当前没有符合条件的工单。'),
      evidence: ['接诉即办模拟统计', ...evidence].join(' · '),
    },
    scope,
  }
}
