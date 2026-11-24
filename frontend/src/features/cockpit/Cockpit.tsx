import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useMatch, useNavigate } from 'react-router'
import { ApiError, dashboardApi, type CockpitArea, type CockpitDirectory } from '../../api/client'
import { answerFromSnapshot } from '../assistant/answer'
import { interpretCockpitIntent } from '../assistant/intent'
import type { AssistantReply } from '../assistant/VoiceAssistant'
import { matchTopics } from '../topics/topicCatalog'
import { twinPath, type TwinId } from './twinSites'
import './cockpit.css'

const AreaIssuesDialog = lazy(() => import('./AreaIssuesDialog'))
const LocalDistrictModel = lazy(() => import('./LocalDistrictModel'))
const NavigationMap = lazy(() => import('./NavigationMap'))
const TerrainView = lazy(() => import('./TerrainView'))
const VoiceAssistant = lazy(() => import('../assistant/VoiceAssistant').then(module => ({ default: module.VoiceAssistant })))
const district = 'mentougou'
const areaRefreshMs = 60_000
const legacyDirectoryBatchSize = 4
const time = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
})

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

const iconPaths = {
  grid: 'M3.5 3.5h6v6h-6zm11 0h6v6h-6zm-11 11h6v6h-6zm11 0h6v6h-6z',
  spark: 'M12 3c0 4.97 4.03 9 9 9-4.97 0-9 4.03-9 9 0-4.97-4.03-9-9-9 4.97 0 9-4.03 9-9z',
  pin: 'M20 10c0 5-8 10-8 10S4 15 4 10a8 8 0 1 1 16 0zM14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  pulse: 'M3 12h4l3-6 4 12 3-6h4',
  layers: 'm12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5',
} as const

type IconName = keyof typeof iconPaths

function CockpitIcon({ name }: { name: IconName }) {
  return (
    <svg className="cockpit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={iconPaths[name]} />
    </svg>
  )
}

function Masthead({ identityControl, topicControl, onAsk }: {
  identityControl: ReactNode; topicControl?: ReactNode; onAsk?: () => void
}) {
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
        {topicControl}
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
              {crumb.id === area.id ? <span aria-current="page">{crumb.name}</span> : (
                <Link to={areaPath(crumb.id)} aria-label={crumb.id === area.breadcrumbs.at(-2)?.id ? '返回上一级 ' + crumb.name : undefined}>
                  {crumb.name}
                </Link>
              )}
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

function RegionModel({ area, onSelectArea, onOpenTwin, onInspect }: {
  area: CockpitArea
  onSelectArea: (areaId: string) => void
  onOpenTwin: (id: TwinId) => void
  onInspect: () => void
}) {
  const [showMap, setShowMap] = useState(false)
  const parent = area.breadcrumbs.at(-2)
  const isDistrict = area.level === 'district'
  return (
    <section className="map-panel" aria-labelledby="area-model" data-map={showMap}>
      <div className="map-toolbar">
        <div className="map-heading">
          <h2 id="area-model"><CockpitIcon name="layers" />{area.name}{showMap ? '地图' : '模型'}</h2>
          {area.children.length > 0 && <span className="map-count">
            {area.children.length} 个{isDistrict ? '镇街' : '村社'}
          </span>}
        </div>
        <div className="map-actions">
          {parent && <button type="button" className="level-up" aria-haspopup="dialog" onClick={onInspect}>
            <CockpitIcon name="pulse" />查看问题
          </button>}
          {area.children.length > 0 && (
            <details className="region-picker" key={area.id}
              onKeyDown={event => {
                if (event.key !== 'Escape' || !event.currentTarget.open) return
                event.currentTarget.open = false
                event.currentTarget.querySelector('summary')?.focus()
              }}>
              <summary><CockpitIcon name="pin" />{isDistrict ? '选择镇街' : '选择村社'}</summary>
              <nav className="map-directory" aria-label="下辖区域">
                {area.children.map(child => <Link to={areaPath(child.id)} key={child.id}>{child.name}</Link>)}
              </nav>
            </details>
          )}
          <button type="button" className="level-up" aria-pressed={showMap} onClick={() => setShowMap(current => !current)}>
            {showMap ? '返回模型' : isDistrict ? '行政地图' : '区域地图'}
          </button>
        </div>
      </div>
      <div className="map-plot">
        <div className="district-map-extent">
          <Suspense fallback={<div className="map-wait" role="status">正在加载本地模型</div>}>
            {showMap ? isDistrict ? <NavigationMap areas={area.children} onSelectArea={onSelectArea} /> : (
              <TerrainView key={area.id} areaId={area.id} areaName={area.name} level={area.level} areas={area.children}
                onSelectArea={onSelectArea} />
            ) : <LocalDistrictModel area={area} onSelectArea={onSelectArea} onOpenTwin={onOpenTwin} />}
          </Suspense>
        </div>
      </div>
    </section>
  )
}

type CockpitProps = {
  identityControl: ReactNode
  topicControl?: ReactNode
  onTopicQuestion?: (question: string, area: CockpitArea, signal: AbortSignal) => Promise<AssistantReply | null | undefined>
}

export default function Cockpit({ identityControl, topicControl, onTopicQuestion }: CockpitProps) {
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
    const intent = interpretCockpitIntent(question, area.id, locations, text => matchTopics(text).length > 0)
    if (intent.kind === 'clarify') {
      if (intent.reason === 'missing-navigation-target' && onTopicQuestion) {
        const reply = await onTopicQuestion(question, area, signal)
        if (reply !== undefined) {
          signal.throwIfAborted()
          if (reply === null) setOverlay(null)
          return reply
        }
      }
      return { answer: { text: intent.message, evidence: '' } }
    }

    const destination = intent.areaId === area.id ? area : await client.fetchQuery(areaQuery(intent.areaId))
    ensureCurrentView()
    if (intent.kind === 'ask' && onTopicQuestion) {
      const reply = await onTopicQuestion(intent.question, destination, signal)
      signal.throwIfAborted()
      if (reply !== undefined) {
        if (reply === null) setOverlay(null)
        return reply
      }
      ensureCurrentView()
    }
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
      <Masthead identityControl={identityControl} topicControl={topicControl} onAsk={area ? openAssistant : undefined} />
      <main className="cockpit-body" aria-label="区域驾驶舱">
        {area ? (
          <>
            <div ref={heading} className="area-focus" tabIndex={-1} aria-label={area.name}><AreaBar area={area} /></div>

            <div className="cockpit-main">
              <RegionModel area={area} onInspect={openIssues} onSelectArea={id => { void navigate(areaPath(id)) }}
                onOpenTwin={id => { void navigate(twinPath(id), { state: { backArea: area.id } }) }} />
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
