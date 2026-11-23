import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useMatch, useNavigate } from 'react-router'
import { ApiError, dashboardApi, type CockpitArea, type CockpitDirectory } from '../../api/client'
import { answerFromSnapshot } from '../assistant/answer'
import { interpretCockpitIntent } from '../assistant/intent'
import type { AssistantReply } from '../assistant/VoiceAssistant'
import './cockpit.css'

const AreaIssuesDialog = lazy(() => import('./AreaIssuesDialog'))
const NavigationMap = lazy(() => import('./NavigationMap'))
const TerrainView = lazy(() => import('./TerrainView'))
const DataChart = lazy(() => import('../playback/DataChart'))
const VoiceAssistant = lazy(() => import('../assistant/VoiceAssistant').then(module => ({ default: module.VoiceAssistant })))
const district = 'mentougou'
const areaRefreshMs = 60_000
const legacyDirectoryBatchSize = 4
const values = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const time = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
})
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai' })

function areaPath(areaId: string) {
  return areaId === district ? '/' : '/areas/' + encodeURIComponent(areaId)
}

const areaQuery = (areaId: string) => queryOptions({
  queryKey: ['cockpit-area', areaId],
  queryFn: ({ signal }) => dashboardApi.area(areaId, signal),
  staleTime: areaRefreshMs,
})

async function readLocationDirectory(signal: AbortSignal, rootSnapshot?: CockpitArea): Promise<CockpitDirectory> {
  try {
    return await dashboardApi.locations(signal)
  } catch (error) {
    if (!(error instanceof ApiError) || ![401, 404].includes(error.status)) throw error
    const root = rootSnapshot ?? await dashboardApi.area(district, signal)
    const entry = (area: Pick<CockpitArea, 'id' | 'name' | 'level'>, parentId: string | null) =>
      ({ id: area.id, name: area.name, level: area.level, parentId })
    const locations: CockpitDirectory = [entry(root, null)]
    for (let start = 0; start < root.children.length; start += legacyDirectoryBatchSize) {
      signal.throwIfAborted()
      const children = root.children.slice(start, start + legacyDirectoryBatchSize)
      const branches = await Promise.all(children.map(child => dashboardApi.area(child.id, signal)))
      for (const branch of branches) {
        locations.push(entry(branch, root.id))
        for (const child of branch.children) locations.push(entry(child, branch.id))
      }
    }
    return locations
  }
}

function formatTime(updatedAt: string) {
  const date = new Date(updatedAt)
  return Number.isNaN(date.getTime()) ? '暂未发布' : time.format(date)
}

function SignalTime({ value }: { value: string }) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return <time>{value}</time>
  return <time dateTime={value} title={time.format(date) + ' 北京时间'}>{clock.format(date)}</time>
}


type Metric = CockpitArea['metrics'][number]
const headlineMetrics = ['governance-events', 'service-cases', 'air-quality-rate', 'active-alerts']

const iconPaths = {
  grid: 'M3.5 3.5h6v6h-6zm11 0h6v6h-6zm-11 11h6v6h-6zm11 0h6v6h-6z',
  spark: 'M12 3c0 4.97 4.03 9 9 9-4.97 0-9 4.03-9 9 0-4.97-4.03-9-9-9 4.97 0 9-4.03 9-9z',
  pin: 'M20 10c0 5-8 10-8 10S4 15 4 10a8 8 0 1 1 16 0zM14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  pulse: 'M3 12h4l3-6 4 12 3-6h4',
  trend: 'M4 5v15h16M8 15l4-4 3 2 5-6',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  layers: 'm12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5',
  document: 'M7 3h7l4 4v14H6V3h1zm7 0v5h4M9 12h6m-6 4h6',
  ventilation: 'M3 8h12.5a2.5 2.5 0 1 0-2.5-2.5M3 12h16a2 2 0 1 1-2 2M4 16h7.5A2.5 2.5 0 1 1 9 18.5',
  alert: 'M12 4 3.5 19h17L12 4zm0 6v3m0 3h.01',
} as const

type IconName = keyof typeof iconPaths
const metricIcons: Partial<Record<string, IconName>> = {
  'governance-events': 'pulse',
  'service-cases': 'document',
  'air-quality-rate': 'ventilation',
  'active-alerts': 'alert',
}

function CockpitIcon({ name }: { name: IconName }) {
  return (
    <svg className="cockpit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={iconPaths[name]} />
    </svg>
  )
}

function organizeMetrics(metrics: Metric[]) {
  const rank = new Map(headlineMetrics.map((id, index) => [id, index]))
  const ordered = [...metrics].sort((left, right) =>
    (rank.get(left.id) ?? headlineMetrics.length) - (rank.get(right.id) ?? headlineMetrics.length))
  return { headline: ordered.slice(0, 4), supporting: ordered.slice(4) }
}

function Delta({ value, unit }: { value: number; unit: string }) {
  const suffix = unit === '%' || unit === '％' ? ' 个百分点' : unit ? ' ' + unit : ''
  const text = value === 0 ? '持平' : (value > 0 ? '+' : '') + values.format(value) + suffix
  return <dd className="metric-delta" data-flat={value === 0} title={'较上个观测日 ' + text}>{text}</dd>
}

function Masthead({ identityControl, onAsk }: { identityControl: ReactNode; onAsk?: () => void }) {
  return (
    <header className="cockpit-masthead">
      <div className="masthead-name">
        <Link to="/" className="cockpit-brand" aria-label="返回门头沟区全域" title="全区总览">
          <span className="brand-symbol" aria-hidden="true"><i /><i /><i /></span>
        </Link>
        <h1>门头沟区数字驾驶舱</h1>
      </div>
      <nav className="cockpit-actions" aria-label="驾驶舱工具">
        <Link to="/admin" className="cockpit-admin-link"><CockpitIcon name="grid" />数据管理</Link>
        {identityControl}
        {onAsk && <button type="button" className="cockpit-ai-link" aria-haspopup="dialog" onClick={onAsk}>
          <CockpitIcon name="spark" />AI 问数
        </button>}
      </nav>
    </header>
  )
}

function AreaBar({ area }: { area: CockpitArea }) {
  return (
    <div className="area-bar">
      <nav className="breadcrumbs" aria-label="区域层级">
        <ol>
          {area.breadcrumbs.map(crumb => (
            <li key={crumb.id}>
              {crumb.id === area.id ? <span aria-current="page">{crumb.name}</span> : <Link to={areaPath(crumb.id)}>{crumb.name}</Link>}
            </li>
          ))}
        </ol>
      </nav>
      <p className="area-meta"><span className="data-status">模拟数据</span>
        <span><span className="update-label">更新 </span><time dateTime={area.updatedAt}>{formatTime(area.updatedAt)}</time></span>
      </p>
    </div>
  )
}

function MetricPanel({ metrics, headline }: { metrics: Metric[]; headline?: boolean }) {
  if (!headline && metrics.length === 0) return null
  const titleId = headline ? 'area-metrics' : 'area-supporting'
  return (
    <section className={headline ? 'key-metrics' : 'supporting-metrics'} aria-labelledby={titleId}>
      <h2 id={titleId} className={headline ? 'metrics-heading' : 'brief-heading'}>{headline ? '核心指标' : '其他指标'}</h2>
      {metrics.length === 0 ? <p className="cockpit-empty">当前区域暂无指标</p> : (
        <dl className="cockpit-metrics">
          {metrics.map(metric => {
            const reading = metric.status === 'NO_DATA' ? null : metric.value
            return (
              <div key={metric.id} className="cockpit-metric" data-metric={metric.id}>
                <dt title={metric.evidence
                  ? metric.label + ' · ' + metric.evidence.sourceName + ' · v' + metric.evidence.version : metric.label}>
                  {headline && <span className="metric-symbol"><CockpitIcon name={metricIcons[metric.id] ?? 'trend'} /></span>}
                  <span>{metric.label}</span>
                </dt>
                {reading != null ? (
                  <dd className="metric-reading"><strong>{values.format(reading)}</strong><span>{metric.unit}</span></dd>
                ) : <dd className="metric-missing">暂无区域观测</dd>}
                {reading != null && metric.delta != null && <Delta value={metric.delta} unit={metric.unit} />}
              </div>
            )
          })}
        </dl>
      )}
    </section>
  )
}

function SignalPanel({ area, onInspect }: { area: CockpitArea; onInspect: (signalId?: string) => void }) {
  const attention = area.signals.filter(signal => signal.status === 'attention')
  return (
    <section className="signals-panel" aria-labelledby="area-signals">
      <div className="brief-bar">
        <h2 id="area-signals" className="brief-heading"><CockpitIcon name="pulse" />运行态势</h2>
        {attention.length > 0 && <span className="attention-count">{attention.length} 项待关注</span>}
      </div>
      {attention.length > 0 ? (
        <ol className="signals">
          {attention.map(signal => {
            const title = signal.title.replace(/^模拟\s*·\s*/, '')
            return (
              <li key={signal.id}>
                <button type="button" className="signal-title" aria-haspopup="dialog" aria-label={title}
                  onClick={() => onInspect(signal.id)}>
                  <i className="signal-dot" aria-hidden="true" />
                  <span>{title}</span>
                  <SignalTime value={signal.time} />
                </button>
              </li>
            )
          })}
        </ol>
      ) : <p className="signal-empty">暂无待关注事项</p>}
      <button type="button" className="issue-link" aria-haspopup="dialog" onClick={() => onInspect()}>
        查看问题<CockpitIcon name="arrow" />
      </button>
    </section>
  )
}

function RegionMap({ area, onSelectArea }: { area: CockpitArea; onSelectArea: (areaId: string) => void }) {
  const parent = area.breadcrumbs.at(-2)
  const showsDistrict = area.id === district
  const terrain = <TerrainView areaId={area.id} areaName={area.name} level={area.level}
    areas={area.children} onSelectArea={onSelectArea} />
  return (
    <section className="map-panel" aria-labelledby="area-map" data-district={showsDistrict}>
      <div className="map-toolbar">
        <div className="map-heading">
          <h2 id="area-map"><CockpitIcon name="layers" />空间态势</h2>
          {area.children.length > 0 && <span className="map-count">
            {area.children.length} 个{area.level === 'district' ? '镇街' : '村社'}
          </span>}
        </div>
        <div className="map-actions">
          {parent && <Link className="level-up" to={areaPath(parent.id)} aria-label={'返回上一级 ' + parent.name}>上一级</Link>}
          {area.children.length > 0 && (
            <details className="region-picker" key={area.id}
              onKeyDown={event => {
                if (event.key !== 'Escape' || !event.currentTarget.open) return
                event.currentTarget.open = false
                event.currentTarget.querySelector('summary')?.focus()
              }}>
              <summary><CockpitIcon name="pin" />{area.level === 'district' ? '选择镇街' : '选择村社'}</summary>
              <nav className="map-directory" aria-label="下辖区域">
                {area.children.map(child => <Link to={areaPath(child.id)} key={child.id}>{child.name}</Link>)}
              </nav>
            </details>
          )}
        </div>
      </div>
      <div className="map-plot">
        <div className="district-map-extent">
          <Suspense fallback={<div className="map-wait" role="status">正在加载地图</div>}>
            {showsDistrict ? (
              <NavigationMap areas={area.children} onSelectArea={onSelectArea} fallback={terrain} />
            ) : terrain}
          </Suspense>
        </div>
      </div>
    </section>
  )
}

function Distribution({ area }: { area: CockpitArea }) {
  const maximum = Math.max(1, ...area.distribution.map(item => item.value))
  return (
    <section className="distribution-panel" aria-labelledby="area-distribution">
      <h2 id="area-distribution" className="brief-heading">治理分布</h2>
      <ul className="distribution-list">
        {area.distribution.map(item => (
          <li key={item.label}>
            <span>{item.label}</span>
            <span className="distribution-track" aria-hidden="true">
              <i style={{ width: Math.max(0, item.value / maximum * 100) + '%' }} />
            </span>
            <strong>{values.format(item.value)}</strong>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TrendPanel({ area }: { area: CockpitArea }) {
  const first = area.trend.at(0)?.label
  const last = area.trend.at(-1)?.label
  const shortDate = (label: string) => /^\d{4}-\d{2}-\d{2}$/.test(label) ? label.slice(5) : label
  return (
    <section className="cockpit-trend" data-empty={area.trend.length === 0} aria-labelledby="area-trend">
      <div className="trend-heading">
        <h2 id="area-trend"><CockpitIcon name="trend" />治理事件趋势</h2>
        {first && last && <span>{first === last ? shortDate(first) : shortDate(first) + ' 至 ' + shortDate(last)}</span>}
      </div>
      {area.trend.length > 0 ? (
        <Suspense fallback={<p className="cockpit-empty" role="status">正在加载趋势</p>}>
          <DataChart kind="trend" label="治理事件趋势" points={area.trend} unit="件" compact />
        </Suspense>
      ) : <p className="trend-empty">当前区域暂无治理事件观测</p>}
    </section>
  )
}

export default function Cockpit({ identityControl }: { identityControl: ReactNode }) {
  const areaId = useMatch('/areas/:areaId')?.params.areaId ?? district
  const location = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [overlay, setOverlay] = useState<'assistant' | 'issues' | null>(
    () => location.hash === '#voice-assistant' ? 'assistant' : null,
  )
  const [assistantOpened, setAssistantOpened] = useState(() => location.hash === '#voice-assistant')
  const [issuesOpened, setIssuesOpened] = useState(false)
  const [highlightedSignal, setHighlightedSignal] = useState<string>()
  const heading = useRef<HTMLDivElement>(null)
  const lastArea = useRef(areaId)
  const zone = useQuery({ ...areaQuery(areaId), refetchInterval: areaRefreshMs })
  const area = zone.data
  const metricGroups = organizeMetrics(area?.metrics ?? [])

  useEffect(() => {
    if (location.hash === '#voice-assistant') {
      void navigate({ pathname: location.pathname, search: location.search }, { replace: true })
    }
  }, [location.hash, location.pathname, location.search, navigate])

  useEffect(() => {
    if (area && lastArea.current !== area.id) {
      lastArea.current = area.id
      heading.current?.focus({ preventScroll: true })
      window.scrollTo(0, 0)
    }
  }, [area])

  function openAssistant() {
    setAssistantOpened(true)
    setOverlay('assistant')
  }

  function openIssues(signalId?: string) {
    setHighlightedSignal(signalId)
    setIssuesOpened(true)
    setOverlay('issues')
  }

  async function handleQuestion(question: string, previousMetricId: string | undefined, signal: AbortSignal): Promise<AssistantReply | null> {
    if (!area) return null
    const origin = location.pathname
    const ensureCurrentView = () => {
      signal.throwIfAborted()
      if (window.location.pathname !== origin) throw new DOMException('已切换区域', 'AbortError')
    }
    const locations = await client.fetchQuery({
      queryKey: ['cockpit-locations'],
      queryFn: ({ signal: directorySignal }) =>
        readLocationDirectory(directorySignal, client.getQueryData(areaQuery(district).queryKey)),
      staleTime: 300_000,
    })
    ensureCurrentView()
    const intent = interpretCockpitIntent(question, area.id, locations)
    if (intent.kind === 'clarify') return { answer: { text: intent.message, evidence: '' } }

    const destination = intent.areaId === area.id ? area : await client.fetchQuery(areaQuery(intent.areaId))
    ensureCurrentView()
    if (destination.id !== area.id) void navigate(areaPath(destination.id))
    if (intent.kind === 'navigate') {
      setOverlay(null)
      return null
    }
    if (intent.kind === 'problems') {
      openIssues()
      return null
    }

    const isSameArea = destination.id === area.id
    return {
      answer: answerFromSnapshot(intent.question, destination, isSameArea ? previousMetricId : undefined),
      scope: destination,
      returnTo: isSameArea ? undefined : { name: area.name, path: areaPath(area.id) },
    }
  }

  return (
    <div className="cockpit">
      <Masthead identityControl={identityControl} onAsk={area ? openAssistant : undefined} />
      <main className="cockpit-body" aria-label="区域驾驶舱">
        {area ? (
          <>
            <div ref={heading} className="area-focus" tabIndex={-1} aria-label={area.name}><AreaBar area={area} /></div>

            <div className="cockpit-main">
              <RegionMap area={area} onSelectArea={areaId => navigate(areaPath(areaId))} />
              <aside className="cockpit-rail cockpit-primary" aria-label="区域指标与分布">
                <MetricPanel metrics={metricGroups.headline} headline />
                {area.distribution.length > 0 && <Distribution area={area} />}
              </aside>
              <aside className="cockpit-rail cockpit-brief" aria-label="区域运行信息">
                <SignalPanel area={area} onInspect={openIssues} />
                <MetricPanel metrics={metricGroups.supporting} />
                <TrendPanel area={area} />
              </aside>
            </div>
          </>
        ) : (
          <section className="cockpit-panel cockpit-state" aria-live="polite" aria-busy={zone.isPending}>
            <h2>{zone.isPending ? '正在加载区域数据' : '区域数据暂不可用'}</h2>
            {zone.isError && (
              <>
                <p>{zone.error.message}</p>
                <button className="level-up" onClick={() => void zone.refetch()}>重试</button>
                {areaId !== district && <Link to="/" className="level-up">返回门头沟区</Link>}
              </>
            )}
          </section>
        )}
      </main>
      {area && (assistantOpened || issuesOpened) && (
        <Suspense fallback={null}>
          {assistantOpened && (
            <VoiceAssistant area={area} open={overlay === 'assistant'}
              onClose={() => setOverlay(null)} onQuestion={handleQuestion} />
          )}
          {issuesOpened && (
            <AreaIssuesDialog area={area} open={overlay === 'issues'} signalId={highlightedSignal}
              onClose={() => setOverlay(null)} />
          )}
        </Suspense>
      )}
    </div>
  )
}
