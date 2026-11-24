import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useMatch, useNavigate } from 'react-router'
import { dashboardApi, type CockpitArea } from '../../api/client'
import MetricRails from './MetricRails'
import { twinPath, type TwinId } from './twinSites'
import './cockpit.css'

const TiandituMap = lazy(() => import('./TiandituMap'))
const district = 'mentougou'
const areaRefreshMs = 60_000
const calendar = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai',
})
const clock = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai',
})

function areaPath(areaId: string) {
  return areaId === district ? '/' : '/areas/' + encodeURIComponent(areaId)
}

const areaQuery = (areaId: string) => queryOptions({
  queryKey: ['cockpit-area', areaId],
  queryFn: ({ signal }) => dashboardApi.area(areaId, signal),
  staleTime: areaRefreshMs,
})

function Masthead({ updatedAt }: { updatedAt?: string }) {
  const timestamp = updatedAt ? Date.parse(updatedAt) : NaN
  return (
    <header className="cockpit-masthead">
      <Link to="/" className="cockpit-brand" aria-label="返回门头沟区全域" title="全区总览">
        <svg viewBox="0 0 34 34" fill="none" aria-hidden="true">
          <path d="m3 22 9-15 4 7 3-5 12 17H4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="m9 23 4-7 4 5 3-4 5 7" stroke="currentColor" strokeOpacity=".65" strokeWidth="1.5" />
          <circle cx="25.5" cy="7" r="1.8" fill="currentColor" />
        </svg>
      </Link>
      <h1>门头沟区数字驾驶舱</h1>
      {Number.isFinite(timestamp) && <time className="masthead-time" dateTime={updatedAt} aria-label={'模拟数据更新于北京时间 ' + calendar.format(timestamp) + ' ' + clock.format(timestamp)}>
        <span><small>模拟数据更新</small>{calendar.format(timestamp)}</span><strong>{clock.format(timestamp)}</strong>
      </time>}
    </header>
  )
}

function RegionModel({ area, viewMode, onViewModeChange, onSelectArea, onOpenTwin }: {
  area: CockpitArea
  viewMode: '2d' | '3d'
  onViewModeChange: (mode: '2d' | '3d') => void
  onSelectArea: (areaId: string) => void
  onOpenTwin: (id: TwinId) => void
}) {
  const isDistrict = area.level === 'district'
  const parent = area.breadcrumbs.at(-2)
  return (
    <>
      <section className="map-panel" data-level={area.level} aria-labelledby="area-model">
        <div className="map-toolbar">
          <div className="map-heading">
            {parent && <Link className="map-parent" to={areaPath(parent.id)} aria-label={'返回上一级 ' + parent.name}>‹ {parent.name}</Link>}
            <h2 id="area-model">{area.name}{isDistrict && <span>全域</span>}</h2>
          </div>
          <div className="map-actions">
            {area.children.length > 0 && (
              <details className="region-picker" key={area.id}
                onKeyDown={event => {
                  if (event.key !== 'Escape' || !event.currentTarget.open) return
                  event.currentTarget.open = false
                  event.currentTarget.querySelector('summary')?.focus()
                }}
                onBlur={event => {
                  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
                }}>
                <summary>{isDistrict ? '选择镇街' : '选择村社'}<span>{area.children.length}</span></summary>
                <nav className="map-directory" aria-label="下辖区域">
                  {area.children.map(child => <Link to={areaPath(child.id)} key={child.id}>{child.name}</Link>)}
                </nav>
              </details>
            )}
            {!isDistrict && <a className="level-up" href={'/workbench?area=' + encodeURIComponent(area.id) + '#area-issues'}
              target="_blank" rel="noopener noreferrer">区域数据 <span aria-hidden="true">↗</span></a>}
          </div>
        </div>
        <div className="map-plot">
          <Suspense fallback={<div className="map-wait" role="status">正在打开区域地图</div>}>
            <TiandituMap area={area} viewMode={viewMode} onViewModeChange={onViewModeChange}
              onSelectArea={onSelectArea} onOpenTwin={onOpenTwin} />
          </Suspense>
        </div>
      </section>
      <MetricRails area={area} />
    </>
  )
}

export default function Cockpit() {
  const areaId = useMatch('/areas/:areaId')?.params.areaId ?? district
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d')
  const heading = useRef<HTMLDivElement>(null)
  const lastArea = useRef(areaId)
  const zone = useQuery({ ...areaQuery(areaId), placeholderData: keepPreviousData, refetchInterval: areaRefreshMs })
  const area = zone.data

  useEffect(() => {
    if (area && lastArea.current !== area.id && !zone.isPlaceholderData) {
      lastArea.current = area.id
      heading.current?.focus({ preventScroll: true })
      window.scrollTo(0, 0)
    }
  }, [area, zone.isPlaceholderData])

  return (
    <div className="cockpit">
      <Masthead updatedAt={area?.updatedAt} />
      <main className="cockpit-body" aria-label="区域驾驶舱">
        {area ? (
          <div ref={heading} className="cockpit-main" tabIndex={-1} aria-label={area.name}
            inert={zone.isPlaceholderData} aria-busy={zone.isPlaceholderData}>
            <RegionModel area={area} viewMode={viewMode} onViewModeChange={setViewMode}
              onSelectArea={id => { void navigate(areaPath(id)) }}
              onOpenTwin={id => { void navigate(twinPath(id), { state: { backArea: area.id } }) }} />
          </div>
        ) : (
          <section className="cockpit-state" aria-live="polite" aria-busy={zone.isPending}>
            <h2>{zone.isPending ? '正在加载区域数据' : '区域数据暂不可用'}</h2>
            {zone.isError && <>
              <p>{zone.error.message}</p>
              <button className="level-up" onClick={() => void zone.refetch()}>重试</button>
              {areaId !== district && <Link to="/" className="level-up">返回门头沟区</Link>}
            </>}
          </section>
        )}
      </main>
    </div>
  )
}
