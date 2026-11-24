import { useSearchParams } from 'react-router'
import type { CockpitArea } from '../../api/client'
import './diagnosis.css'

type Metric = CockpitArea['metrics'][number]
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const signed = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })
const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const axes = [[18, 20], [50, 12], [81, 20], [85, 47], [80, 75], [50, 85], [19, 75], [15, 47]]
const maxNodes = axes.length

function timeLabel(timestamp: string) {
  const value = new Date(timestamp)
  return Number.isFinite(value.getTime()) ? date.format(value) : '暂无时间'
}

function metricValue(metric: Metric) {
  return metric.status !== 'NO_DATA' && typeof metric.value === 'number' && Number.isFinite(metric.value) ? number.format(metric.value) : '—'
}

function MetricGraph({ area, selected, onSelect }: { area: CockpitArea; selected?: Metric; onSelect: (id: string) => void }) {
  const batch = Math.floor(Math.max(0, area.metrics.findIndex(m => m.id === selected?.id)) / maxNodes)
  const nodes = area.metrics.slice(batch * maxNodes, (batch + 1) * maxNodes)
  return <section className="diagnosis-observations" aria-label="区域指标观测">
    <div className="diagnosis-section-head"><h3>指标观测</h3>
      {area.metrics.length > maxNodes ? <div className="diagnosis-pager">
        <button type="button" disabled={!batch} aria-label="上一组指标" onClick={() => onSelect(area.metrics[(batch - 1) * maxNodes].id)}>‹</button>
        <small>{batch + 1} / {Math.ceil(area.metrics.length / maxNodes)}</small>
        <button type="button" disabled={(batch + 1) * maxNodes >= area.metrics.length} aria-label="下一组指标" onClick={() => onSelect(area.metrics[(batch + 1) * maxNodes].id)}>›</button>
      </div> : <small>{area.metrics.length} 项指标</small>}</div>
    <div className="diagnosis-network">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <ellipse cx="50" cy="48" rx="34" ry="34" className="diagnosis-orbit"/>
        {nodes.map((metric, i) => {
          const [x, y] = axes[i]
          return <g key={metric.id} data-current={selected?.id === metric.id}>{[-1.8, 0, 1.8].map((bend) =>
            <path key={bend} d={`M50 48 Q${(x + 50) / 2 + bend} ${(y + 48) / 2 - 4 + bend} ${x} ${y}`} />)}</g>
        })}
      </svg>
      <span className="diagnosis-hub"><strong>{area.name}</strong><small>指标观测</small></span>
      {nodes.map((metric, i) => <button key={metric.id} type="button" className="diagnosis-metric-node"
        style={{ left: axes[i][0] + '%', top: axes[i][1] + '%' }} aria-pressed={metric.id === selected?.id}
        onClick={() => onSelect(metric.id)}><span>{metric.label}</span><strong>{metricValue(metric)} <small>{metric.unit}</small></strong></button>)}
    </div>
  </section>
}

function Evidence({ metric }: { metric: Metric }) {
  const { evidence } = metric
  const values = metric.status === 'NO_DATA' ? [] : metric.series.filter(Number.isFinite).slice(-7)
  const lower = Math.min(...values), upper = Math.max(...values)
  const points = values.map((value, i) => [14 + 252 * i / Math.max(1, values.length - 1),
    values.length === 1 || lower === upper ? 42 : 67 - (value - lower) * 50 / (upper - lower)])
  const line = points.map(p => p.join(',')).join(' ')
  const delta = metric.status !== 'NO_DATA' && metric.value != null ? metric.delta : null
  return <section className="diagnosis-evidence" aria-label="指标证据与口径">
    <div className="diagnosis-reading"><h3>{metric.label}</h3><strong>{metricValue(metric)} <small>{metric.unit}</small></strong>
      <p>{delta == null ? '暂无环比观测' : '较上次观测 ' + (delta === 0 ? '持平' : signed.format(delta) + (metric.unit === '%' ? ' 个百分点' : ' ' + metric.unit))}</p></div>
    <figure className="diagnosis-series"><figcaption>最近 {values.length} 次观测</figcaption>{points.length ? <svg viewBox="0 0 280 85" role="img"
      aria-label={metric.label + '观测序列 ' + values.join('、') + ' ' + metric.unit}><defs><linearGradient id="diagnosis-value-shade" x2="0" y2="1">
        <stop stopColor="#67d9e7" stopOpacity=".26"/><stop offset="1" stopColor="#67d9e7" stopOpacity="0"/></linearGradient></defs>
      <path d="M12 70H267 M12 44H267 M12 18H267" className="diagnosis-guide"/>
      <polygon fill="url(#diagnosis-value-shade)" points={'14,71 ' + line + ' ' + points[points.length - 1][0] + ',71'}/>
      <polyline points={line} stroke="#84dcea" strokeWidth="1.8" fill="none"/>{points.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="2.4" fill="#b6edfb"><title>{number.format(values[i])} {metric.unit}</title></circle>)}
    </svg> : <p>暂无观测序列</p>}</figure>
    <div className="diagnosis-provenance"><h3>数据口径</h3>
      <dl><div><dt>数据来源</dt><dd>{evidence ? evidence.sourceName + ' · v' + evidence.version : '区域模拟快照'}</dd></div>
        {evidence?.observedOn && <div><dt>观测日期</dt><dd>{evidence.observedOn}</dd></div>}
        {evidence?.measure && <div><dt>度量字段</dt><dd>{evidence.measure}</dd></div>}
      </dl><p>{evidence?.description || '当前值与观测序列均取自所选区域的演示数据。'}</p></div>
  </section>
}

export default function DiagnosisScreen({ area }: { area: CockpitArea }) {
  const [params, setParams] = useSearchParams()
  const metricId = params.get('metric')
  const attention = area.signals.filter(s => s.status === 'attention')
  const selectedId = params.get('signal') ?? params.get('signalId')
  const focused = area.signals.find(s => s.id === selectedId) ?? attention[0] ?? area.signals[0]
  const metric = area.metrics.find(m => m.id === metricId) ?? area.metrics.find(m => m.evidence) ?? area.metrics[0]
  function selectMetric(id: string) {
    const next = new URLSearchParams(params)
    next.set('metric', id)
    setParams(next, { replace: true, preventScrollReset: true })
  }
  function selectSignal(id: string) {
    const next = new URLSearchParams(params)
    next.delete('signalId')
    next.set('signal', id)
    setParams(next, { replace: true, preventScrollReset: true })
  }
  return <article className="diagnosis-screen" aria-labelledby="diagnosis-title">
    <header className="diagnosis-title"><div><small>{area.name}</small><h2 id="diagnosis-title">区域问题诊断</h2></div>
      <p>模拟快照 <time dateTime={area.updatedAt}>{timeLabel(area.updatedAt)}</time></p></header>
    <div className="diagnosis-main">
      <MetricGraph area={area} selected={metric} onSelect={selectMetric}/>
      <section className="diagnosis-signals" aria-label="区域运行事项">
        <div className="diagnosis-section-head"><h3>运行事项</h3><small>{attention.length} 项待关注</small></div>
        {focused ? <><div className="diagnosis-signal-body" data-status={focused.status}>
          <span className="diagnosis-signal-state"><i/>{focused.status === 'attention' ? '待关注' : '已记录'}</span>
          <h4>{focused.title.replace(/^模拟\s*·\s*/, '')}</h4><p>{focused.detail}</p><time dateTime={focused.time}>{timeLabel(focused.time)}</time>
        </div>{area.signals.length > 1 && <label className="diagnosis-select-label">查看事项<select value={focused.id} onChange={e => selectSignal(e.target.value)}>
          {area.signals.map(s => <option key={s.id} value={s.id}>{s.title.replace(/^模拟\s*·\s*/, '')}</option>)}</select></label>}</>
          : <p className="diagnosis-empty">当前区域暂无运行事项。</p>}
      </section>
    </div>
    {metric ? <Evidence metric={metric}/> : <p className="diagnosis-empty">当前区域暂无指标。</p>}
  </article>
}
