import { useId } from 'react'
import type { CockpitArea } from '../../api/client'
import './metric-rails.css'

type Metric = CockpitArea['metrics'][number]

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 2 })
const signed = new Intl.NumberFormat('zh-CN', { signDisplay: 'exceptZero', maximumFractionDigits: 2 })
const layout = {
  left: ['governance-events', 'service-cases', 'completion-rate'],
  right: ['air-quality-rate', 'road-traffic'],
} as const

type ChartKind = '环形图' | '柱状图' | '折线图'

function MetricChart({ metric, kind }: { metric: Metric; kind: ChartKind }) {
  const fill = useId()
  if (kind === '环形图' && metric.value != null) {
    return <svg className="rail-gauge" viewBox="0 0 48 48" role="img" aria-label={`占比环形图，${number.format(metric.value)}%`}>
      <circle cx="24" cy="24" r="19" className="gauge-track" />
      <circle cx="24" cy="24" r="19" className="gauge-value" pathLength="100"
        strokeDasharray={`${metric.value} 100`} transform="rotate(-90 24 24)" />
    </svg>
  }
  const samples = metric.series.filter(Number.isFinite).slice(-14)
  if (samples.length < 2) return null
  const bars = kind === '柱状图'
  const min = bars ? Math.min(0, ...samples) : Math.min(...samples)
  const max = Math.max(...samples, ...(bars ? [0] : []))
  const y = (value: number) => max === min ? 19 : 33 - (value - min) / (max - min) * 26
  const x = (i: number) => 3 + i * 152 / (samples.length - 1)
  const line = samples.map((value, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(value)}`).join(' ')
  const title = `近 ${samples.length} 次观测 · ${bars ? '柱状图' : '折线图'}`
  return <svg className="rail-history" viewBox="0 0 160 37" preserveAspectRatio="none" role="img" aria-label={title}>
    <title>{title}</title>
    <defs><linearGradient id={fill} x2="0%" y2="100%">
      <stop stopColor="currentColor" stopOpacity={bars ? '.95' : '.25'} />
      <stop offset="1" stopColor="currentColor" stopOpacity={bars ? '.25' : '.01'} />
    </linearGradient></defs>
    <path d="M0 34H160 M0 17H160" fill="none" stroke="currentColor" strokeOpacity=".15" strokeDasharray="2 4" />
    {bars ? samples.map((value, i) => {
      const step = 160 / samples.length
      return <rect key={i} x={(i + .17) * step} width={step * .65}
        y={Math.min(y(0), y(value))} height={Math.max(1, Math.abs(y(0) - y(value)))} rx="1" fill={`url(#${fill})`} />
    }) : <>
      <path d={line + ' L 155 36 L 3 36 Z'} fill={`url(#${fill})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={x(samples.length - 1)} cy={y(samples[samples.length - 1])} r="2.25" fill="currentColor" />
    </>}
  </svg>
}

function MetricReading({ metric }: { metric: Metric }) {
  const value = metric.value
  const available = metric.status !== 'NO_DATA' && value != null && Number.isFinite(value)
  const delta = available ? metric.delta : null
  const gauge = metric.unit === '%' && available && value >= 0 && value <= 100
  const kind: ChartKind = gauge ? '环形图' : ['service-cases', 'active-projects'].includes(metric.id) ? '柱状图' : '折线图'
  const hasChart = available && (gauge || metric.series.filter(Number.isFinite).length >= 2)
  const display = value != null && Math.abs(value) >= 1_000_000 ? compact : number
  return <li className="rail-reading" data-metric={metric.id} data-gauge={gauge}>
    <div className="rail-label"><h3>{metric.label}</h3>{hasChart && <span className="rail-chart-kind">{kind}</span>}</div>
    <div className={gauge ? 'rail-visual rail-visual-gauge' : 'rail-visual'}>
      <div className="rail-value">
        {available && value != null ? <><strong title={number.format(value)}>{display.format(value)}</strong><span>{metric.unit}</span></>
          : <span className="rail-missing">暂无数据</span>}
      </div>
      {hasChart && <MetricChart metric={metric} kind={kind} />}
    </div>
    <p className="rail-delta" title="与上一观测日比较">
      {delta == null ? '暂无可比观测' : <><span>较上次观测</span><b>{delta === 0 ? '持平'
        : signed.format(delta) + (metric.unit === '%' ? ' 个百分点' : ' ' + metric.unit)}</b></>}
    </p>
  </li>
}

export default function MetricRails({ area }: { area: CockpitArea }) {
  const metrics = new Map(area.metrics.map(metric => [metric.id, metric]))
  return <div className="metric-rails">
    {(['left', 'right'] as const).map(side => <aside key={side} className={'metric-rail rail-' + side}
      aria-label={side === 'left' ? '左侧指标' : '右侧指标'}>
      <header><span className="rail-index" aria-hidden="true" />
        <h2>{side === 'left' ? '区域概况' : '运行监测'}</h2><span className="rail-rule" aria-hidden="true" />
      </header>
      <ul>{layout[side].map(id => {
        const metric = metrics.get(id)
        return metric ? <MetricReading key={id} metric={metric} />
          : <li key={id} className="rail-unavailable">本区域暂无该指标</li>
      })}</ul>
    </aside>)}
  </div>
}
