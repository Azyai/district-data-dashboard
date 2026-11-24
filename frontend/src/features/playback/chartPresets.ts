import { GraphChart, PieChart, RadarChart } from 'echarts/charts'
import type { GraphSeriesOption, PieSeriesOption, RadarSeriesOption } from 'echarts/charts'
import { RadarComponent, TitleComponent } from 'echarts/components'
import type { RadarComponentOption, TitleComponentOption, TooltipComponentOption } from 'echarts/components'
import type { ComposeOption } from 'echarts/core'
import type { ChartStyle } from './chartStyles'

export const radialChartModules = [GraphChart, PieChart, RadarChart, RadarComponent, TitleComponent]

export type ChartPoint = { label: string; value: number }
export type RadialOption = ComposeOption<
  GraphSeriesOption | PieSeriesOption | RadarSeriesOption | RadarComponentOption | TitleComponentOption | TooltipComponentOption
>
export type RadialStyle = Extract<ChartStyle, 'radar' | 'network' | 'ring'>

const tones = ['#71e5fc', '#8eaaff', '#bd9aff', '#6cddd5', '#7392ee', '#a5d9ff', '#90bafa', '#c7acec']
const numbers = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 8 })

export function isRadialStyle(style: ChartStyle): style is RadialStyle {
  return style === 'radar' || style === 'network' || style === 'ring'
}

export function formatChartValue(value: number, unit: string) {
  return numbers.format(value) + (unit ? ' ' + unit : '')
}

export function radialFallback(style: ChartStyle, points: ChartPoint[], minimum: number, unit: string): string | null {
  if (!isRadialStyle(style) || !points.length) return null
  if (minimum < 0) return '当前包含负数，改用柱形图。'
  if (style === 'radar' && (points.length < 3 || points.length > 8)) return '雷达图适合 3–8 个维度，当前改用柱形图。'
  if (style === 'network' && points.length > 10) return '观测项超过 10 个，当前改用柱形图。'
  if (style === 'ring') {
    if (points.length > 10 || /[%％]|百分点/.test(unit)) return '环形图展示可汇总的占比，当前改用柱形图。'
    const sum = points.reduce((total, point) => total + point.value, 0)
    if (!Number.isFinite(sum) || sum <= 0) return '环形图合计应大于 0，当前改用柱形图。'
  }
  return null
}

function clipped(text: string, width: number) {
  const characters = Array.from(text)
  const length = width < 320 ? 6 : 11
  return characters.length <= length ? text : characters.slice(0, length - 1).join('') + '…'
}

export function radarCeiling(maximum: number) {
  if (maximum === 0) return 1
  const power = 10 ** Math.floor(Math.log10(maximum))
  const ceiling = Math.ceil(maximum / power) * power
  return Number.isFinite(ceiling) ? Math.max(ceiling, maximum) : maximum
}

function radar(points: ChartPoint[], unit: string, maximum: number, width: number, height: number): RadialOption {
  const ceiling = radarCeiling(maximum)
  return {
    radar: {
      indicator: points.map(point => ({ name: point.label, max: ceiling })),
      center: ['50%', '51%'],
      radius: Math.max(20, Math.min(width * .27, height * .35)),
      axisName: { color: '#b9d0ef', fontSize: width < 320 ? 11 : 13, formatter: name => clipped(name ?? '', width) },
      axisNameGap: width < 320 ? 6 : 10,
      splitNumber: 4,
      splitArea: { areaStyle: { color: ['#14294399', '#0a1a3866'] } },
      splitLine: { lineStyle: { color: '#385779' } },
      axisLine: { lineStyle: { color: '#4b7291' } },
    },
    tooltip: {
      trigger: 'item',
      formatter: () => points.map(point => point.label + '  ' + formatChartValue(point.value, unit)).join('\n'),
    },
    series: {
      type: 'radar',
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { color: '#91ecff', width: 2, shadowBlur: 7, shadowColor: '#59c4ff88' },
      itemStyle: { color: '#bbf7ff', borderWidth: 1, borderColor: '#346aad' },
      areaStyle: { color: '#579ce6', opacity: .32 },
      data: [{ value: points.map(point => point.value) }],
    },
  }
}

function network(points: ChartPoint[], unit: string, maximum: number, width: number, height: number, additive: boolean): RadialOption {
  const sum = additive ? points.reduce((total, point) => total + point.value, 0) : NaN
  const aggregated = Number.isFinite(sum)
  const centerValue = aggregated ? sum : points.length
  const caption = aggregated ? '总计' : '观测'
  const centerUnit = aggregated ? unit : '项'
  const narrow = width < 325
  const count = points.length
  const centerSize = Math.max(39, Math.min(60, width * .2))
  const rx = width * .35
  const ry = height * .34

  return {
    tooltip: {
      trigger: 'item',
      formatter: params => {
        const item = Array.isArray(params) ? params[0] : params
        if (typeof item?.value !== 'number') return ''
        const displayUnit = item.dataIndex === 0 ? centerUnit : unit
        return item.name + '  ' + formatChartValue(item.value, displayUnit)
      },
    },
    series: {
      type: 'graph',
      layout: 'none',
      left: Math.max(narrow ? 50 : 58, width * .15),
      right: Math.max(narrow ? 50 : 58, width * .15),
      top: Math.max(24, height * .17),
      bottom: Math.max(24, height * .17),
      roam: false,
      cursor: 'default',
      symbol: 'circle',
      label: { color: '#cadaf1', fontSize: narrow ? 10 : 13, fontWeight: 540 },
      emphasis: { focus: 'adjacency', scale: 1.08 },
      data: [
        {
          id: 'chart-hub', name: caption, value: centerValue, x: 0, y: 0, symbolSize: centerSize,
          itemStyle: {
            color: '#1b396d', borderWidth: 1.65, borderColor: '#a0eaff', shadowColor: '#489bffbd', shadowBlur: 19,
          },
          label: {
            show: true, position: 'inside', color: '#e7faff', lineHeight: narrow ? 13 : 15,
            fontWeight: 700, formatter: () => numbers.format(centerValue) + '\n' + caption,
          },
        },
        ...points.map((point, index) => {
          const angle = Math.PI * 2 * index / count - Math.PI / 2
          const tone = tones[index % tones.length]
          const ratio = maximum > 0 ? Math.sqrt(point.value / maximum) : 0
          const position: 'top' | 'bottom' | 'left' | 'right' =
            Math.sin(angle) < -.42 ? 'top' : Math.sin(angle) > .58 ? 'bottom' : Math.cos(angle) < 0 ? 'left' : 'right'
          return {
            id: 'chart-node-' + index,
            name: point.label,
            value: point.value,
            x: Math.cos(angle) * rx,
            y: Math.sin(angle) * ry,
            symbolSize: (narrow ? 6 : 8) + ratio * (narrow ? 9 : 12),
            itemStyle: { color: tone, shadowColor: tone, shadowBlur: 8, borderColor: '#d6f2ff', borderWidth: 1 },
            label: { show: true, position, distance: 4, formatter: () => clipped(point.label, width) },
          }
        }),
      ],
      links: points.map((point, index) => ({
        source: 'chart-hub',
        target: 'chart-node-' + index,
        lineStyle: {
          color: tones[index % tones.length], opacity: .7,
          width: maximum > 0 ? .8 + Math.sqrt(point.value / maximum) * 1.7 : .8,
          curveness: (index % 2 ? -.16 : .16),
        },
      })),
    },
  }
}

function ring(points: ChartPoint[], unit: string, width: number, height: number): RadialOption {
  const total = points.reduce((total, point) => total + point.value, 0)
  const narrow = width < 325
  const centerNumber = Math.min(narrow ? 18 : 24, Math.max(12, width * .15 / numbers.format(total).length + 11))
  const outerRadius = Math.min(width * (narrow ? .24 : .28), height * .4)
  return {
    title: {
      text: numbers.format(total), subtext: unit ? '合计 · ' + unit : '合计', left: 'center', top: 'center', padding: 0, itemGap: 4,
      textStyle: { color: '#e1f7ff', fontSize: centerNumber, fontWeight: 730 },
      subtextStyle: { color: '#9ebce5', fontSize: 11 },
    },
    tooltip: {
      trigger: 'item',
      formatter: params => {
        const item = Array.isArray(params) ? params[0] : params
        const value = item?.value
        if (typeof value !== 'number') return '暂无数据'
        const percent = numbers.format(Math.round(value / total * 1000) / 10)
        return item.name + '  ' + formatChartValue(value, unit) + '（' + percent + '%）'
      },
    },
    series: {
      type: 'pie',
      center: ['50%', '50%'],
      radius: [outerRadius * .76, outerRadius],
      padAngle: 4,
      minShowLabelAngle: 10,
      avoidLabelOverlap: true,
      label: {
        color: '#bad1ee', fontSize: narrow ? 10 : 13,
        formatter: ({ name }) => clipped(name, width),
      },
      labelLine: { length: 7, length2: 4, lineStyle: { color: '#709dc5' } },
      itemStyle: { borderRadius: 5 },
      emphasis: { scaleSize: 3 },
      data: points.map((point, index) => ({
        value: point.value, name: point.label, itemStyle: { color: tones[index % tones.length] },
      })),
    },
  }
}

export function radialPreset(
  style: RadialStyle, points: ChartPoint[], unit: string, maximum: number, width: number, height: number, additive: boolean,
) {
  switch (style) {
    case 'radar': return radar(points, unit, maximum, width, height)
    case 'network': return network(points, unit, maximum, width, height, additive)
    case 'ring': return ring(points, unit, width, height)
  }
}
