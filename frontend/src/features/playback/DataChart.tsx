import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import type { ComposeOption } from 'echarts/core'
import { init, use as registerCharts } from 'echarts/core'
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts'
import type { GridComponentOption, TooltipComponentOption } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useMemo, useRef, useState } from 'react'
import { isRadialStyle, radialChartModules, radialFallback, radialPreset, radarCeiling } from './chartPresets'
import type { ChartPoint, RadialOption } from './chartPresets'
import type { ChartStyle } from './chartStyles'
import './data-chart.css'

registerCharts([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer, ...radialChartModules])

export type ChartVariant = ChartStyle

type Point = ChartPoint
type CartesianOption = ComposeOption<GridComponentOption | TooltipComponentOption | BarSeriesOption | LineSeriesOption>
type Options = CartesianOption | RadialOption

type DataChartProps = {
  kind: 'trend' | 'ranking'
  label: string
  points: Point[]
  unit: string
  compact?: boolean
  variant?: ChartVariant
  additive?: boolean
  showData?: boolean
}

const fontFamily = 'system-ui, "Microsoft YaHei", sans-serif'
const axisNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 8 })
const observedNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 16 })
const marker = '#b4f3ff'
const axisInk = '#a4b9d8'
const guide = 'rgba(122, 158, 216, .18)'

const lineGradient = {
  type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
  colorStops: [
    { offset: 0, color: '#698cff' },
    { offset: 1, color: '#78e9ff' },
  ],
} satisfies NonNullable<LineSeriesOption['lineStyle']>['color']

const areaGradient = {
  type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
  colorStops: [
    { offset: 0, color: 'rgba(65, 129, 250, .35)' },
    { offset: .9, color: 'rgba(65, 129, 250, .035)' },
    { offset: 1, color: 'rgba(65, 129, 250, 0)' },
  ],
} satisfies NonNullable<LineSeriesOption['areaStyle']>['color']

function shortDate(value: string): string {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return date ? Number(date[2]) + '/' + Number(date[3]) : value
}

function tooltip(value: unknown, unit: string): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? observedNumber.format(value) + (unit ? ' ' + unit : '')
    : '暂无数据'
}

function pointRange(points: Point[]) {
  let min = Infinity
  let max = -Infinity
  for (const { value } of points) {
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return { min, max }
}

function chartDescription(label: string, points: Point[], unit: string, range: ReturnType<typeof pointRange>) {
  if (points.length <= 16) {
    return label + '。' + points.map(point => point.label + ' ' + point.value + unit).join('，')
  }
  const first = points[0]
  const last = points[points.length - 1]
  return label + '，共 ' + points.length + ' 项。' + first.label + ' ' + tooltip(first.value, unit) +
    ' 至 ' + last.label + ' ' + tooltip(last.value, unit) + '。取值范围 ' +
    tooltip(range.min, unit) + ' 至 ' + tooltip(range.max, unit) + '。'
}

function compactTrend(points: Point[], width: number, range: ReturnType<typeof pointRange>, bar: boolean): CartesianOption {
  const mobile = width < 480
  const allZero = range.min === 0 && range.max === 0
  const labelWidth = Math.max(axisNumber.format(range.min).length, axisNumber.format(range.max).length)
  const left = Math.min(Math.round(width * .29), Math.max(46, labelWidth * 7 + 18))
  const fontSize = mobile ? 11 : 12
  return {
    grid: { top: 17, right: mobile ? 23 : 30, bottom: 28, left },
    xAxis: {
      type: 'category',
      data: points.map(point => point.label),
      boundaryGap: bar || points.length === 1,
      axisLine: { onZero: false, lineStyle: { color: guide } },
      axisTick: { show: false },
      axisLabel: {
        color: axisInk,
        fontSize,
        hideOverlap: true,
        showMinLabel: true,
        showMaxLabel: true,
        formatter: shortDate,
      },
    },
    yAxis: {
      type: 'value',
      scale: !allZero && !bar,
      splitNumber: allZero ? 1 : 3,
      minInterval: points.every(point => Number.isInteger(point.value)) ? 1 : undefined,
      min: allZero ? 0 : undefined,
      max: allZero ? 1 : undefined,
      axisLabel: { color: axisInk, fontSize, hideOverlap: true, formatter: (value: number) => axisNumber.format(value) },
      splitLine: { lineStyle: { color: guide, type: 'dashed' } },
    },
    tooltip: {
      axisPointer: { type: bar ? 'shadow' : 'line', lineStyle: { color: '#8bcaed', type: 'dashed' } },
    },
    series: bar ? barSeries(points, mobile, false, fontSize) : {
      type: 'line',
      sampling: 'minmax',
      symbol: 'circle',
      symbolSize: mobile ? 5 : 7,
      showSymbol: points.length <= 12,
      lineStyle: { width: mobile ? 2.3 : 2.8, color: lineGradient },
      itemStyle: { color: marker, borderColor: '#165f93', borderWidth: 1.2 },
      areaStyle: { color: areaGradient },
      data: points.map(point => point.value),
    },
  }
}

function barSeries(points: Point[], narrow: boolean, showValues: boolean, labelSize: number): BarSeriesOption {
  return {
    type: 'bar',
    barMaxWidth: narrow ? 14 : 22,
    large: true,
    largeThreshold: 500,
    showBackground: points.length <= 20,
    backgroundStyle: { color: '#1a2d44', borderRadius: 4 },
    itemStyle: { color: lineGradient, borderRadius: 4 },
    label: {
      show: showValues, position: 'right', color: '#cceaf9', fontSize: labelSize,
      formatter: ({ value }) => typeof value === 'number' ? observedNumber.format(value) : '',
    },
    data: points.map(point => point.value),
  }
}

function standardChart(style: ChartVariant, kind: DataChartProps['kind'], points: Point[], width: number): CartesianOption {
  const narrow = width < 480
  const labelSize = narrow ? 12 : Math.min(26, Math.max(18, Math.round(width / 76)))
  const axisLabel = {
    color: axisInk,
    fontSize: labelSize,
    hideOverlap: true,
  }
  const valueAxis = {
    type: 'value' as const,
    splitNumber: narrow || width > 1250 ? 3 : 5,
    axisLabel: { ...axisLabel, formatter: (value: number) => axisNumber.format(value) },
    splitLine: { lineStyle: { color: guide, type: 'dashed' as const } },
  }
  const categoryAxis = {
    type: 'category' as const,
    data: points.map(point => point.label),
    axisLabel: { ...axisLabel, formatter: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5) : value },
    axisLine: { lineStyle: { color: guide } },
    axisTick: { show: false },
  }
  const bar = style === 'bar'
  const ranking = kind === 'ranking' && bar
  const showValues = ranking && points.length <= 8 && points.every(point => observedNumber.format(point.value).length <= 8)
  const labelWidth = ranking ? points.reduce((size, point) => Math.max(size, point.label.length), 0) : 0
  return {
    grid: {
      top: 24,
      right: showValues ? (narrow ? 48 : 72) : (narrow ? 22 : 36),
      bottom: narrow ? 26 : 40,
      left: ranking ? Math.min(Math.round(width * .33), Math.max(68, labelWidth * labelSize + 14)) : (narrow ? 44 : 65),
    },
    xAxis: ranking ? valueAxis : categoryAxis,
    yAxis: ranking ? {
      ...categoryAxis, inverse: true,
      axisLabel: { ...axisLabel, width: Math.round(width * .26), overflow: 'truncate' },
    } : valueAxis,
    tooltip: { axisPointer: { type: bar ? 'shadow' : 'line' } },
    series: bar
      ? barSeries(points, narrow, showValues, labelSize)
      : {
        type: 'line', sampling: 'minmax', showSymbol: points.length <= 48, symbolSize: narrow ? 6 : 8,
        lineStyle: { width: narrow ? 2.5 : 3.5, color: lineGradient },
        itemStyle: { color: marker, borderColor: '#165f93', borderWidth: 1.2 },
        areaStyle: { color: areaGradient },
        data: points.map(point => point.value),
      },
  }
}

function DatasetDetails({ points, label, unit }: { points: Point[]; label: string; unit: string }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const pageSize = 40
  const lastPage = Math.max(0, Math.ceil(points.length / pageSize) - 1)
  const current = Math.min(page, lastPage)
  const offset = current * pageSize
  return (
    <details className="data-chart-dataset" onToggle={event => setOpen(event.currentTarget.open)}
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        event.currentTarget.open = false
        event.currentTarget.querySelector('summary')?.focus()
      }}>
      <summary aria-label={'查看' + label + '明细'}>数据</summary>
      {open && (
        <div className="data-chart-dataset-panel">
          <table>
            <caption>{label}明细</caption>
            <thead><tr><th scope="col">观测项</th><th scope="col">{unit ? '数值（' + unit + '）' : '数值'}</th></tr></thead>
            <tbody>{points.slice(offset, offset + pageSize).map((point, index) => (
              <tr key={offset + index}><th scope="row">{point.label}</th><td>{observedNumber.format(point.value)}</td></tr>
            ))}</tbody>
          </table>
          {lastPage > 0 && <nav className="data-chart-dataset-pages" aria-label="数据明细分页">
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button>
            <span aria-live="polite">{current + 1} / {lastPage + 1}</span>
            <button type="button" disabled={current === lastPage} onClick={() => setPage(current + 1)}>下一页</button>
          </nav>}
        </div>
      )}
    </details>
  )
}

export default function DataChart({ kind, label, points, unit, compact = false, variant, additive = false, showData = false }: DataChartProps) {
  const host = useRef<HTMLDivElement>(null)
  const observed = useMemo(() => points.filter(point => Number.isFinite(point.value)), [points])
  const range = useMemo(() => pointRange(observed), [observed])
  const requested = variant ?? (kind === 'trend' ? 'line' : 'bar')
  const fallback = radialFallback(requested, observed, range.min, unit)
  const style = fallback ? 'bar' : requested
  const radial = isRadialStyle(style)
  const note = fallback ?? (style === 'radar' ? '统一刻度 0–' + tooltip(radarCeiling(range.max), unit) : null)

  useEffect(() => {
    const element = host.current
    if (!element || observed.length === 0) return

    let chart: ReturnType<typeof init> | undefined
    let width = 0
    let height = 0
    function setSize() {
      if (!element || element.clientWidth === 0 || element.clientHeight === 0) return
      const widthChanged = width !== element.clientWidth
      if (!widthChanged && height === element.clientHeight) return

      width = element.clientWidth
      height = element.clientHeight
      chart ??= init(element, undefined, { devicePixelRatio: Math.min(window.devicePixelRatio, 2) })
      chart.resize({ width, height })
      if (widthChanged || radial) {
        const options: Options = isRadialStyle(style)
          ? radialPreset(style, observed, unit, range.max, width, height, additive)
          : compact && kind === 'trend' ? compactTrend(observed, width, range, style === 'bar')
            : standardChart(style, kind, observed, width)
        chart.setOption({
          ...options,
          animation: false,
          textStyle: { color: axisInk, fontFamily },
          color: [marker],
          tooltip: {
            trigger: radial ? 'item' : 'axis',
            triggerOn: 'mousemove|click',
            renderMode: 'richText',
            confine: true,
            backgroundColor: '#101e33',
            borderColor: '#41648d',
            padding: [9, 13],
            textStyle: { color: '#edf7fd' },
            valueFormatter: (value: unknown) => tooltip(value, unit),
            ...options.tooltip,
          },
        })
      }
    }
    setSize()
    const observer = new ResizeObserver(setSize)
    observer.observe(element)
    return () => {
      observer.disconnect()
      chart?.dispose()
    }
  }, [kind, observed, unit, compact, range, style, radial, additive])

  if (observed.length === 0) {
    return <p className="chart-fallback" role="status">{label}暂无数据</p>
  }

  const dataPlot = (
    <div
      ref={host}
      className={compact ? 'data-chart data-chart-compact' : 'data-chart'}
      data-chart-variant={style}
      role="img"
      aria-label={chartDescription(label, observed, unit, range)}
    />
  )
  return (
    <div className="data-chart-frame">
      {dataPlot}
      {(note || showData) && <div className="data-chart-info">
        {note && <p>{note}</p>}
        {showData && <DatasetDetails label={label} points={observed} unit={unit} />}
      </div>}
    </div>
  )
}
