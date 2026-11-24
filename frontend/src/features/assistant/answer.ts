import type { CockpitArea } from '../../api/client'

const metricAliases: Readonly<Record<string, RegExp>> = {
  'governance-events': /治理事件|事件受理|受理量|治理趋势/,
  'completion-rate': /办结率|办结情况|办结比例/,
  'service-cases': /政务服务|服务办件|办件量|办件/,
  'active-alerts': /待处置|预警|告警/,
  'air-quality-rate': /空气|优良占比/,
  'road-traffic': /道路|通行量|车流|交通/,
  'tourism-visits': /文旅|接待|游客/,
  'active-projects': /在建|重点项目/,
}

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const areas = /全区|全镇|全街道|全村/

export type SnapshotAnswer = {
  text: string
  metricId?: string
  evidence: string
}

function formatValue(value: number, unit: string): string {
  return number.format(value) + unit
}

type SnapshotMetric = CockpitArea['metrics'][number]

function describeMetric(metric: SnapshotMetric): string {
  return metric.value == null || metric.status === 'NO_DATA'
    ? metric.label + '暂无数据'
    : metric.label + '为' + formatValue(metric.value, metric.unit)
}

function metricEvidence(metric: SnapshotMetric): string {
  const evidence = metric.evidence
  if (!evidence) return metric.label
  return [
    metric.label,
    evidence.sourceName,
    '口径 v' + evidence.version,
    evidence.observedOn && '观测日 ' + evidence.observedOn,
    '数据批次 ' + evidence.batchId,
  ].filter(Boolean).join(' · ')
}

export function answerFromSnapshot(
  question: string,
  area: CockpitArea,
  previousMetricId?: string,
): SnapshotAnswer {
  const policyNote = '可问本区域的指标值、近期走势或较上一观测日变化。'
  const query = question.normalize('NFKC').replace(/[\s，。？！、]/g, '')
  const namesCurrentArea = query.includes(area.name)
  const otherArea = area.children.find((candidate) => query.includes(candidate.name)) ??
    (!namesCurrentArea
      ? area.breadcrumbs.find((candidate) => candidate.id !== area.id && query.includes(candidate.name))
      : undefined)
  const requestedArea = query.match(areas)?.[0]
  const expectedScope = area.level === 'district'
    ? '全区'
    : area.level === 'village' ? '全村' : area.name.endsWith('街道') ? '全街道' : '全镇'
  const result = (text: string, evidence: string, metricId?: string): SnapshotAnswer => ({
    text,
    evidence,
    metricId,
  })

  if (otherArea || (requestedArea && requestedArea !== expectedScope)) {
    const target = otherArea?.name ?? requestedArea
    return result('当前查看' + area.name + '。请先切换到' + target + '，再查询该范围。', '当前区域')
  }

  if (/去年|上年|上月|上周|今年|同比|环比|平均|累计|合计|总和|跨区域/.test(query)) {
    return result('当前快照支持最新值、近期走势和较上一观测日变化。' + policyNote, '可用口径')
  }

  const matches = area.metrics.filter(
    (metric) => query.includes(metric.label) || metricAliases[metric.id]?.test(query),
  )
  const wantsTrend = /趋势|走势|近七日|近7日|近七天|近7天|(?:最近|过去)(?:7|七)(?:天|日)/.test(query)
  const wantsDelta = /较上[一1]日|比[昨前]天|比上[一1]日|上一日|上[一1个]观测日|变化|增减|涨跌/.test(query)

  if (query.includes('分布')) {
    if (matches.some((metric) => metric.id !== 'governance-events')) {
      return result('当前快照只提供治理事件类型的分布。' + policyNote, '可用口径')
    }
    if (area.distribution.length === 0) {
      return result(area.name + '当前快照暂无治理事件分布记录。', '治理事件类型分布')
    }
    const distribution = [...area.distribution].sort((left, right) => right.value - left.value).slice(0, 3)
    return result(
      area.name + '当前分布图中数值最高的类别为' + distribution.map(
        ({ label, value }) => label + '（' + number.format(value) + '）',
      ).join('、') + '。',
      '治理事件类型分布',
    )
  }

  if (matches.length > 1) {
    if (wantsTrend || wantsDelta) {
      return result('请选择一个指标，例如“' + matches[0].label + (wantsTrend ? '的趋势如何？”' : '较上一日怎么变？”'), '当前区域')
    }

    return result(
      area.name + '当前快照显示，' + matches.map(describeMetric).join('，') + '。',
      matches.map(metricEvidence).join(' / '),
    )
  }

  const metric = matches[0] ??
    (wantsTrend || wantsDelta ? area.metrics.find((item) => item.id === previousMetricId) : undefined)
  if (!metric) {
    if (/总览|概览|总体|当前态势/.test(query)) {
      const leading = area.metrics.slice(0, 4)
      if (leading.length === 0) return result(area.name + '当前快照暂无指标。', '当前区域')
      return result(
        area.name + '当前快照显示，' + leading.map(describeMetric).join('，') + '。',
        leading.map(metricEvidence).join(' / '),
      )
    }

    return result('请选择一个指标。' + policyNote, '当前区域')
  }

  const context = area.name + '当前快照的' + metric.label
  const evidence = metricEvidence(metric)
  if (metric.value == null || metric.status === 'NO_DATA') {
    return result(context + '暂无可用数据。', evidence, metric.id)
  }
  if (wantsTrend) {
    const points = metric.series.slice(-7)
    if (points.length < 2) return result(context + '缺少可比较的趋势记录。', evidence, metric.id)

    const first = points[0]
    const latest = points[points.length - 1]
    const low = Math.min(...points)
    const high = Math.max(...points)
    const unit = metric.unit
    return result(
      area.name + '的' + metric.label + '最近' + points.length + '个观测日由' + formatValue(first, unit)
        + '变为' + formatValue(latest, unit) + '，区间最低' + formatValue(low, unit)
        + '、最高' + formatValue(high, unit) + '。',
      evidence,
      metric.id,
    )
  }

  if (wantsDelta) {
    if (metric.delta == null) return result(context + '缺少上一观测日的可比较数据。', evidence, metric.id)
    const direction = metric.delta > 0 ? '上升' : '下降'
    const deltaUnit = metric.unit === '%' ? '个百分点' : metric.unit
    const comparison = metric.delta === 0
      ? '与上一观测日持平'
      : '较上一观测日' + direction + formatValue(Math.abs(metric.delta), deltaUnit)
    return result(
      context + '为' + formatValue(metric.value, metric.unit) + '，' + comparison + '。',
      evidence,
      metric.id,
    )
  }

  return result(context + '为' + formatValue(metric.value, metric.unit) + '。', evidence, metric.id)
}
