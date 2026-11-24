import type { Manifest } from '../../api/client'

type Component = Manifest['components'][number]
export type ChartStyle = NonNullable<Component['chartStyle']>

const labels = {
  line: '折线图',
  bar: '柱状图',
  radar: '星状雷达图',
  network: '分类网络图',
  ring: '环形图',
} satisfies Record<ChartStyle, string>

const styles: Record<Component['type'], readonly ChartStyle[]> = {
  kpi: [],
  trend: ['line', 'bar'],
  ranking: ['bar', 'radar', 'network', 'ring'],
}

export function chartStyleOptions(type: Component['type']) {
  return styles[type].map(value => ({ value, label: labels[value] }))
}

export function chartStyleFor(component: Pick<Component, 'type' | 'chartStyle'>) {
  const available = styles[component.type]
  const current = component.chartStyle
  return current && available.includes(current) ? current : available[0]
}

export function chartStyleLabel(component: Pick<Component, 'type' | 'chartStyle'>) {
  const style = chartStyleFor(component)
  return style ? labels[style] : '指标卡'
}
