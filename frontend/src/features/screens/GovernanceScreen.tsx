import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { CoreScreenProps } from './CoreScreen'
import { hotlineAnalysis, hotlineOverview, hotlineTicket, hotlineTickets, normalizeHotlineMonth, ticketStatusNames, type HotlineOverview, type HotlineTicket } from './hotlineApi'
import { formatNumber } from './screenData'
import { FlowThreads, TicketFeed } from './GovernanceFlow'
import governanceCss from './governance.css?inline'

const states = { closed: '已办结', open: '正常办理', due: '临期', late: '超时' } as const
type Lane = keyof typeof states
const lanes = Object.keys(states) as Lane[]
const stepStates = { done: '已完成', active: '进行中', pending: '待启动' }
const monthLabel = (date: string) => Number(date.slice(-2)) + '月'

function Count({ value, total }: { value: number; total: number }) {
  return <strong className="hotline-count"><span>{formatNumber(value)}<small> 件</small></span>
    <span className="hotline-percent">{total ? (value * 100 / total).toFixed(1) : '0'}%</span></strong>
}

function Feedback({ error, retry }: { error: Error | null; retry: () => void }) {
  return <p className="reference-feedback" role={error ? 'alert' : 'status'}>
    {error ? <>{error.message} <button onClick={retry}>重试</button></> : '正在读取工单…'}
  </p>
}

function Trend({ data }: { data: HotlineOverview }) {
  const points = data.trend.filter(point => point.month.slice(0, 4) === data.month.slice(0, 4))
  const max = Math.max(1, ...points.map(p => p.received))
  const min = Math.max(0, Math.min(...points.map(p => p.received)) * .92)
  const x = (index: number) => 34 + index * 322 / Math.max(1, points.length - 1)
  const y = (value: number) => 85 - (value - min) / Math.max(1, max - min) * 65
  const coords = points.map((p, i) => x(i) + ',' + y(p.received)).join(' ')
  return <div className="chart chart-annual teal"><svg viewBox="0 0 382 110" role="img" aria-label="月度工单受理趋势">
    <defs><linearGradient id="trend-area" x2="0" y2="1"><stop stopColor="#6ddace" stopOpacity=".35"/><stop offset="1" stopColor="#6ddace" stopOpacity="0"/></linearGradient></defs>
    {[0, 1, 2].map(i => <g key={i}><line className="axis" x1="34" x2="356" y1={20 + i * 32.5} y2={20 + i * 32.5}/><text x="30" y={24 + i * 32.5} textAnchor="end">{Math.round(max - (max - min) * i / 2)}</text></g>)}
    <polygon fill="url(#trend-area)" points={'34,85 ' + coords + ' 356,85'}/><polyline className="series" points={coords}/>
    {points.map((p, i) => <g key={p.month} className={'chart-point' + (p.month === data.month ? ' is-selected' : '')} tabIndex={0}>
      <title>{p.month} · {p.received} 件</title><circle className="chart-dot" cx={x(i)} cy={y(p.received)} r={p.month === data.month ? 4 : 2.5}/>
      <text x={x(i)} y="103" textAnchor="middle">{monthLabel(p.month)}</text></g>)}
  </svg></div>
}

function TicketDetail({ ticket, scope, month, data, analyze }: { ticket?: HotlineTicket; scope: string; month: string; data: HotlineOverview; analyze: () => void }) {
  const detail = useQuery({ ...hotlineTicket(ticket?.id ?? '', scope, month), enabled: Boolean(ticket) })
  const [index, setIndex] = useState<number | null>(null)
  const steps = detail.data?.steps ?? []
  const active = steps.findIndex(s => s.state === 'active')
  const selected = index ?? (active >= 0 ? active : steps.length - 1)
  return <aside className="governance-detail hotline-detail" aria-label="工单详情">
    <div className="gov-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v5l-4 3h-4M4 11h3v7H4zm13 0h3v7h-3z"/></svg>工单详情{ticket && <small>{ticket.id}</small>}</div>
    <h2 className="hotline-case-title">{ticket?.title ?? '暂无匹配工单'}</h2>
    {ticket && <>
      <div className="gov-status"><span>{ticketStatusNames[ticket.status]}</span><small className="gov-deadline">{ticket.openedOn} 受理</small></div>
      <dl className="hotline-facts"><div><dt>诉求分类</dt><dd>{ticket.category}</dd></div><div><dt>所属区域</dt><dd>{ticket.areaName}</dd></div></dl>
      <section className="hotline-workflow"><h2>办理进展</h2>{detail.data ? <>
        <ol className="hotline-timeline">{steps.map((s, i) => <li key={s.label}><button type="button" className="governance-step"
          data-status={s.state === 'active' ? 'current' : s.state} aria-pressed={selected === i} onClick={() => setIndex(i)}>
          <i/><b>{s.label}</b><span>{stepStates[s.state]}</span><time dateTime={s.on ?? undefined}>{s.on?.slice(5) ?? '—'}</time></button></li>)}</ol>
        {steps[selected] && <div className="gov-progress"><div className="gov-progress-summary"><b>{steps[selected].label}</b><span>{steps[selected].on ?? stepStates[steps[selected].state]}</span></div>
          {selected === (active >= 0 ? active : steps.length - 1) && <p>{detail.data.note}</p>}</div>}
      </> : <Feedback error={detail.error} retry={() => void detail.refetch()}/>}</section></>}
    <section className="hotline-monthly"><div className="hotline-context-head"><h2>{monthLabel(month)}办理概况</h2><button className="hotline-analysis" onClick={analyze}>办理分析 ›</button></div>
      <dl><div><dt>工单办结率</dt><dd>{data.totals.closedRate}%</dd></div><div><dt>已办结</dt><dd>{formatNumber(data.totals.closed)} 件</dd></div>
      <div><dt>待办结</dt><dd>{formatNumber(data.totals.received - data.totals.closed)} 件</dd></div><div><dt>已超时</dt><dd>{formatNumber(data.totals.late)} 件</dd></div></dl></section>
  </aside>
}

function GovernanceMonth({ data, changeMonth, onAreaChange }: { data: HotlineOverview; changeMonth: (month: string) => void; onAreaChange: (id: string) => void }) {
  const [lane, setLane] = useState<Lane>('closed')
  const [branch, setBranch] = useState('')
  const [category, setCategory] = useState('')
  const [record, setRecord] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const { area, month, totals } = data
  const divisions = area.level === 'village' ? [{ ...area, ...totals }] : data.areas
  const rows = [...divisions].sort((a, b) => b[lane] - a[lane] || a.name.localeCompare(b.name, 'zh-CN'))
  const selected = rows.find(row => row.id === branch) ?? rows.find(row => row[lane] > 0) ?? rows[0]
  const scope = selected?.id ?? area.id
  const listKey = [scope, month, lane, category].join('/')
  const list = useInfiniteQuery(hotlineTickets(scope, month, lane, category))
  const items = useMemo(() => list.data?.pages.flatMap(page => page.items) ?? [], [list.data])
  const ticket = items.find(item => item.id === record) ?? items[0]
  const total = list.data?.pages[0].total
  const { fetchNextPage } = list
  const loadMore = useCallback(() => { void fetchNextPage({ cancelRefetch: false }) }, [fetchNextPage])
  const analysis = useQuery({ ...hotlineAnalysis(area.id, month), enabled: analyzing })
  const previous = data.trend.find((v, i) => data.trend[i + 1]?.month === month)?.received
  const hints = { closed: '', open: '', due: data.thresholds.dueDays + '–' + (data.thresholds.lateDays - 1) + ' 天', late: '≥ ' + data.thresholds.lateDays + ' 天' }
  const watch = [...divisions].sort((a,b) => b.late - a.late || b.due - a.due).slice(0, 3)
  function analyze() { setAnalyzing(true); dialog.current?.showModal() }
  function select(nextLane: Lane, id = '') { setLane(nextLane); setBranch(id); setRecord('') }
  const monthChoices = data.trend.map(point => point.month).reverse()
  return <section className="reference ref-governance" aria-label="接诉即办">
    <div className="governance-stage hotline-stage" data-tone={lane}>
      <FlowThreads/>
      <div className="hotline-tree">
        <div className="hotline-root"><span>接诉即办总数</span><div className="hotline-core" id="hotline-root"><i/><strong>{formatNumber(totals.received)}<small>件</small></strong></div>
          <select id="hotline-month" aria-label="受理月份" value={month} onChange={e => changeMonth(e.target.value)}>{monthChoices.map(m => <option key={m} value={m}>{m.replace('-', ' 年 ')} 月</option>)}</select></div>
        <section className="hotline-column hotline-states"><div className="hotline-column-head"><h2>办理状态</h2></div>
          <div className="hotline-nodes">{lanes.map(id => <button key={id} id={'lane-' + id} data-link-from="hotline-root" data-tone={id} className="hotline-node" aria-pressed={lane === id}
            onClick={() => select(id)}><i/><span><b>{states[id]}</b>{hints[id] && <small>{hints[id]}</small>}</span><Count value={totals[id]} total={totals.received}/></button>)}</div></section>
        <section className="hotline-column hotline-towns"><div className="hotline-column-head"><h2>{area.level === 'district' ? '镇街排名' : '区域排名'}</h2></div>
          <div className="hotline-nodes" data-link-clip>{rows.map((row, i) => <button key={row.id} className="hotline-node" id={'branch-' + row.id} data-link-from={'lane-' + lane}
            onClick={() => select(lane, row.id)} aria-pressed={selected?.id === row.id}><span className="hotline-rank" data-rank={i + 1}>{String(i + 1).padStart(2, '0')}</span>
            <span><b title={row.name}>{row.name}</b></span><Count value={row[lane]} total={totals[lane]}/></button>)}{!rows.length && <p>{area.name}</p>}</div></section>
        <section className="hotline-column hotline-cases"><div className="hotline-column-head"><h2>具体工单</h2><small>{total === undefined ? '—' : formatNumber(total)} 件</small></div>
          <select className="hotline-category" aria-label="诉求分类" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">全部分类</option>{data.categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <TicketFeed scopeKey={listKey} linkFrom={selected ? 'branch-' + selected.id : 'lane-' + lane}
            items={items} total={total ?? 0} selected={ticket} choose={setRecord}
            hasMore={list.hasNextPage} pending={list.isFetching} error={list.error} loadMore={loadMore}
            retry={list.isFetchNextPageError ? loadMore : () => void list.refetch()} />
        </section>
      </div>
      <div className="hotline-monitor"><section className="hotline-context hotline-trend"><div><h2>受理趋势</h2><strong>{formatNumber(totals.received)}<small> 件</small></strong>
        <small>{previous !== undefined ? '较上月 ' + (totals.received - previous) + ' 件' : '本年首月'}</small></div><Trend data={data}/></section>
        <section className="hotline-context hotline-watch"><div className="hotline-context-head"><h2>区域督办</h2>{selected && selected.id !== area.id && <button className="hotline-analysis" onClick={() => onAreaChange(selected.id)}>查看{selected.name} ›</button>}</div>
          {watch.map(row => <div className="hotline-watch-row" key={row.id}><span>{row.name}</span>{(['due','late'] as const).map(id => <button key={id} className="hotline-watch-chip"
            data-tone={id} onClick={() => select(id,row.id)}>{states[id]} <b>{row[id]}</b></button>)}</div>)}
        </section></div>
    </div>
    <TicketDetail key={ticket?.id ?? 'empty'} ticket={ticket} scope={scope} month={month} data={data} analyze={analyze}/>
    <dialog ref={dialog} aria-labelledby="hotline-analysis-title" className="insight-dialog" onClose={() => setAnalyzing(false)}>
      <header className="dialog-head"><form method="dialog"><button className="icon-button" aria-label="关闭分析">×</button></form></header>
      <h2 id="hotline-analysis-title">接诉即办分析</h2><p className="detail-sub">{area.name} · {month} · 快照 {data.snapshotOn}</p>
      {analysis.data ? <div className="insight-grid">{analysis.data.findings.map(f => <section key={f.id} className="insight-section"><h3>{f.title}</h3><p>{f.summary}</p></section>)}</div>
        : <Feedback error={analysis.error} retry={() => void analysis.refetch()}/>}
    </dialog>
  </section>
}

export default function GovernanceScreen({ area, onAreaChange }: Pick<CoreScreenProps, 'area' | 'onAreaChange'>) {
  const [params, setParams] = useSearchParams()
  const month = normalizeHotlineMonth(params.get('month'))
  const overview = useQuery(hotlineOverview(area.id, month))
  const [lastSnapshot, setLastSnapshot] = useState<HotlineOverview>()
  const current = overview.data?.area.id === area.id && (!month || overview.data.month === month) ? overview.data : undefined
  useLayoutEffect(() => { if (current) setLastSnapshot(current) }, [current])
  const data = current ?? lastSnapshot
  function changeMonth(value: string) {
    const next = new URLSearchParams(params)
    next.set('month', value)
    setParams(next, { preventScrollReset: true })
  }
  return <div className="hotline-scoped-view">
    <style>{governanceCss}</style>
    {data && <div className="hotline-snapshot" data-visible-area={data.area.id} data-visible-month={data.month} inert={!current} aria-hidden={!current || undefined}>
      <GovernanceMonth data={data} changeMonth={changeMonth} onAreaChange={onAreaChange} />
    </div>}
    {!current && <div className="hotline-loading" aria-live="polite">
      <Feedback error={overview.error} retry={() => void overview.refetch()} />
      {data && <small>当前画面 · {data.area.name} · {data.month}</small>}
    </div>}
  </div>
}
