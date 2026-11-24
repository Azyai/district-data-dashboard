import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from 'antd'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { Link, useLocation, useMatch, useNavigate } from 'react-router'
import { ApiError, dashboardApi, type CockpitArea, type CockpitDirectory } from '../../api/client'
import { answerFromSnapshot } from '../assistant/answer'
import { interpretCockpitIntent } from '../assistant/intent'
import type { AssistantReply } from '../assistant/VoiceAssistant'
import { matchTopics } from '../topics/topicCatalog'
import './workbench.css'

const VoiceAssistant = lazy(() => import('../assistant/VoiceAssistant').then(module => ({ default: module.VoiceAssistant })))
const AreaIssuesDialog = lazy(() => import('../cockpit/AreaIssuesDialog'))
const districtId = 'mentougou'
const areaRefreshMs = 60_000
const legacyDirectoryBatchSize = 4
const dateTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' })
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const changeNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })
const areaLevels = { district: '全区', town: '镇街', village: '村社' } as const

type Overlay = 'assistant' | 'issues'
type Metric = CockpitArea['metrics'][number]
type Props = {
  identityControl: ReactNode
  topicControl: ReactNode
  onTopicQuestion: (question: string, area: CockpitArea, signal: AbortSignal) => Promise<AssistantReply | null | undefined>
}

function areaDataPath(areaId: string) {
  return '/data/areas/' + encodeURIComponent(areaId)
}

function displayPath(areaId: string) {
  return areaId === districtId ? '/' : '/areas/' + encodeURIComponent(areaId)
}

function areaQuery(id: string) {
  return queryOptions({
    queryKey: ['cockpit-area', id],
    queryFn: ({ signal }) => dashboardApi.area(id, signal),
    staleTime: areaRefreshMs,
  })
}

async function readDirectory(signal: AbortSignal, rootSnapshot?: CockpitArea): Promise<CockpitDirectory> {
  try {
    return await dashboardApi.locations(signal)
  } catch (error) {
    if (!(error instanceof ApiError) || ![401, 404].includes(error.status)) throw error
    const root = rootSnapshot ?? await dashboardApi.area(districtId, signal)
    const directory: CockpitDirectory = [{ id: root.id, name: root.name, level: root.level, parentId: null }]
    for (let start = 0; start < root.children.length; start += legacyDirectoryBatchSize) {
      signal.throwIfAborted()
      const children = root.children.slice(start, start + legacyDirectoryBatchSize)
      const branches = await Promise.all(children.map(child => dashboardApi.area(child.id, signal)))
      for (const branch of branches) {
        directory.push({ id: branch.id, name: branch.name, level: branch.level, parentId: root.id })
        for (const child of branch.children) {
          directory.push({ id: child.id, name: child.name, level: child.level, parentId: branch.id })
        }
      }
    }
    return directory
  }
}

function displayTime(value: string) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? dateTime.format(timestamp) : '待更新'
}

function AreaSelector({ area, directory, onChange }: {
  area: CockpitArea
  directory?: CockpitDirectory
  onChange: (areaId: string) => void
}) {
  const available = directory ?? [...area.breadcrumbs, ...area.children]
  const names = new Map(available.map(item => [item.id, item.name]))
  return (
    <label className="workbench-selector">
      <span>选择区域</span>
      <select value={area.id} onChange={event => onChange(event.currentTarget.value)}>
        {(Object.entries(areaLevels) as [keyof typeof areaLevels, string][]).map(([level, label]) => {
          const options = available.filter(item => item.level === level)
          return options.length > 0 && <optgroup key={level} label={label}>
            {options.map(item => {
              const parent = level === 'village' && 'parentId' in item && typeof item.parentId === 'string'
                ? names.get(item.parentId) : undefined
              return <option key={item.id} value={item.id}>{parent ? parent + ' / ' + item.name : item.name}</option>
            })}
          </optgroup>
        })}
      </select>
    </label>
  )
}

function MetricReading({ metric, showEvidence }: { metric: Metric; showEvidence: boolean }) {
  const { value } = metric
  const hasValue = metric.status !== 'NO_DATA' && typeof value === 'number' && Number.isFinite(value)
  const delta = hasValue ? metric.delta : null
  const evidence = metric.evidence
  return (
    <tr>
      <th scope="row">{metric.label}</th>
      <td className="workbench-value">{hasValue ? <>
        <strong>{number.format(value)}</strong><span>{metric.unit}</span>
      </> : <span>暂无数据</span>}</td>
      <td className="workbench-comparison" data-direction={delta ? (delta > 0 ? 'up' : 'down') : undefined}>
        {delta == null ? '暂无比较' : <>
          <span className="workbench-comparison-prefix" aria-hidden="true">较上一观测日 </span>
          {delta === 0 ? '持平' : changeNumber.format(delta) + (metric.unit === '%' ? ' 个百分点' : ' ' + metric.unit)}
        </>}
      </td>
      {showEvidence && <td className="workbench-evidence">{evidence ? <>
        <span>{evidence.sourceName} · v{evidence.version}</span>
        {evidence.observedOn && <time dateTime={evidence.observedOn}>{evidence.observedOn}</time>}
      </> : '—'}</td>}
    </tr>
  )
}

export default function AreaWorkbench({ identityControl, topicControl, onTopicQuestion }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const routeAreaId = useMatch('/data/areas/:areaId')?.params.areaId
  const areaId = routeAreaId ?? districtId
  const snapshot = useQuery({ ...areaQuery(areaId), refetchInterval: areaRefreshMs })
  const area = snapshot.data
  const directoryQuery = queryOptions({
    queryKey: ['cockpit-locations'],
    queryFn: ({ signal }) => readDirectory(signal, client.getQueryData(areaQuery(districtId).queryKey)),
    staleTime: 300_000,
  })
  const directory = useQuery(directoryQuery)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const routeOverlay: Overlay | null = location.hash === '#area-issues' ? 'issues' : location.hash === '#voice-assistant' ? 'assistant' : null
  const openOverlay = routeOverlay ?? overlay
  const alerts = area?.signals.filter(signal => signal.status === 'attention').length ?? 0
  const hasEvidence = area?.metrics.some(metric => metric.evidence != null) ?? false

  function closeOverlay() {
    setOverlay(null)
    if (routeOverlay) void navigate({ pathname: location.pathname, search: location.search }, { replace: true })
  }

  function showOverlay(next: Overlay) {
    setOverlay(next)
    if (routeOverlay) void navigate({ pathname: location.pathname, search: location.search }, { replace: true })
  }

  function changeArea(id: string) {
    setOverlay(null)
    void navigate(areaDataPath(id))
  }

  async function handleQuestion(question: string, previousMetricId: string | undefined, signal: AbortSignal): Promise<AssistantReply | null> {
    if (!area) return null
    const origin = location.pathname + location.search + location.hash
    const ensureCurrentView = () => {
      signal.throwIfAborted()
      const { pathname, search, hash } = window.location
      if (origin !== pathname + search + hash) throw new DOMException('已切换区域', 'AbortError')
    }

    const locations = await client.fetchQuery(directoryQuery)
    ensureCurrentView()
    const intent = interpretCockpitIntent(question, area.id, locations, text => matchTopics(text).length > 0)
    if (intent.kind === 'clarify') {
      if (intent.reason === 'missing-navigation-target') {
        const reply = await onTopicQuestion(question, area, signal)
        signal.throwIfAborted()
        if (reply !== undefined) {
          if (reply === null) setOverlay(null)
          return reply
        }
      }
      return { answer: { text: intent.message, evidence: '' } }
    }

    const sameArea = intent.areaId === area.id
    const destination = sameArea ? area : await client.fetchQuery(areaQuery(intent.areaId))
    ensureCurrentView()
    if (intent.kind === 'ask') {
      const reply = await onTopicQuestion(intent.question, destination, signal)
      signal.throwIfAborted()
      if (reply !== undefined) {
        if (reply === null) setOverlay(null)
        return reply
      }
    }
    if (intent.kind === 'navigate') {
      changeArea(destination.id)
      return null
    }
    if (intent.kind === 'problems') {
      setOverlay(null)
      void navigate(areaDataPath(destination.id) + '#area-issues')
      return null
    }
    ensureCurrentView()
    if (!sameArea) {
      setOverlay('assistant')
      void navigate(areaDataPath(destination.id))
    }
    return {
      answer: answerFromSnapshot(intent.question, destination, sameArea ? previousMetricId : undefined),
      scope: destination,
      returnTo: sameArea ? undefined : { name: area.name, path: location.pathname },
    }
  }

  return (
    <div className="area-workbench">
      <header className="workbench-header">
        <Link to="/workbench" className="workbench-brand">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 6h18v12H3zM7 10h5M7 14h9M15 9l2 2-2 2" />
          </svg>
          <span>门头沟区数据工作台</span>
        </Link>
        <nav aria-label="工作台工具" className="workbench-header-actions">
          <a className="workbench-action" href={displayPath(areaId)} target="_blank" rel="noopener noreferrer"
            title="在新标签页打开区域展示">打开区域展示 <span aria-hidden="true">↗</span></a>
          <a className="workbench-action" href="/admin" target="_blank" rel="noopener noreferrer"
            title="在新标签页打开数据管理">数据管理 <span aria-hidden="true">↗</span></a>
          {identityControl}
        </nav>
      </header>

      <main className="workbench-main" aria-label={routeAreaId ? '区域数据' : '区域数据工作台'}>
        {area ? (
          <>
            <section className="workbench-scope" aria-labelledby="workbench-area">
              <div>
                {area.breadcrumbs.length > 1 && <nav aria-label="区域层级" className="workbench-breadcrumbs">
                  <ol>{area.breadcrumbs.map(crumb => <li key={crumb.id}>
                    {crumb.id === area.id ? <span aria-current="page">{crumb.name}</span>
                      : <Link to={areaDataPath(crumb.id)} onClick={closeOverlay}>{crumb.name}</Link>}
                  </li>)}</ol>
                </nav>}
                <h1 id="workbench-area">{area.name}</h1>
                <p className="workbench-time"><span className="status-mark">模拟数据</span>
                  <span>快照更新 <time dateTime={area.updatedAt}>{displayTime(area.updatedAt)}</time></span></p>
              </div>
              <AreaSelector area={area} directory={directory.data} onChange={changeArea} />
            </section>

            <section className="workbench-roster" aria-labelledby="workbench-metrics">
              <header className="workbench-roster-header">
                <div>
                  <h2 id="workbench-metrics">区域指标</h2>
                  {alerts > 0 && <p className="workbench-alert">有 {alerts} 项运行事项待关注</p>}
                </div>
                <div className="workbench-roster-actions">
                  <button className="workbench-action" type="button" aria-haspopup="dialog" onClick={() => showOverlay('issues')}>查看问题</button>
                  {topicControl}
                  <button className="workbench-action workbench-ask" type="button" aria-haspopup="dialog"
                    onClick={() => showOverlay('assistant')}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 3a9 9 0 0 0 9 9 9 9 0 0 0-9 9 9 9 0 0 0-9-9 9 9 0 0 0 9-9Z" />
                    </svg>
                    AI 问数
                  </button>
                </div>
              </header>
              {area.metrics.length > 0 ? (
                <div className="workbench-table-scroll" role="region" aria-label="当前区域指标" tabIndex={0}>
                  <table>
                    <thead><tr>
                      <th scope="col">指标</th><th scope="col">当前观测</th><th scope="col">较上一观测日</th>
                      {hasEvidence && <th scope="col">数据依据</th>}
                    </tr></thead>
                    <tbody>{area.metrics.map(metric => <MetricReading metric={metric} showEvidence={hasEvidence} key={metric.id} />)}</tbody>
                  </table>
                </div>
              ) : <p className="workbench-empty">当前区域暂无已发布指标。</p>}
            </section>
          </>
        ) : (
          <section className="workbench-state" aria-live="polite" aria-busy={snapshot.isPending}>
            <h1>{snapshot.isPending ? '正在读取区域快照' : '区域数据暂不可用'}</h1>
            {snapshot.isError && <>
              <p>{snapshot.error.message}</p>
              <Button onClick={() => void snapshot.refetch()}>重试</Button>
              {areaId !== districtId && <Link to="/workbench">查看全区数据</Link>}
            </>}
          </section>
        )}
      </main>

      {area && openOverlay && (
        <Suspense fallback={null}>
          {openOverlay === 'assistant' && <VoiceAssistant area={area} open onQuestion={handleQuestion} onClose={closeOverlay} />}
          {openOverlay === 'issues' && <AreaIssuesDialog area={area} open onClose={closeOverlay} />}
        </Suspense>
      )}
    </div>
  )
}
