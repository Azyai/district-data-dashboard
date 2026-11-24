import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useMatch, useNavigate } from 'react-router'
import { dashboardApi, type CockpitArea } from '../../api/client'
import { twinPath, type TwinId } from './twinSites'
import './cockpit.css'

const LocalDistrictModel = lazy(() => import('./LocalDistrictModel'))
const district = 'mentougou'
const areaRefreshMs = 60_000
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

function formatTime(updatedAt: string) {
  const date = new Date(updatedAt)
  return Number.isNaN(date.getTime()) ? '暂未发布' : time.format(date)
}

const iconPaths = {
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

function Masthead() {
  return (
    <header className="cockpit-masthead">
      <div className="masthead-name">
        <Link to="/" className="cockpit-brand" aria-label="返回门头沟区全域" title="全区总览">
          <span className="brand-symbol" aria-hidden="true"><i /><i /><i /></span>
        </Link>
        <h1>门头沟区数字驾驶舱</h1>
      </div>
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

function RegionModel({ area, viewMode, onViewModeChange, onSelectArea, onOpenTwin }: {
  area: CockpitArea
  viewMode: '2d' | '3d'
  onViewModeChange: (mode: '2d' | '3d') => void
  onSelectArea: (areaId: string) => void
  onOpenTwin: (id: TwinId) => void
}) {
  const isDistrict = area.level === 'district'
  return (
    <section className="map-panel" data-level={area.level} aria-labelledby="area-model">
      <div className="map-toolbar">
        <div className="map-heading">
          <h2 id="area-model"><CockpitIcon name="layers" />{area.name}模型</h2>
          {area.children.length > 0 && <span className="map-count">
            {area.children.length} 个{isDistrict ? '镇街' : '村社'}
          </span>}
        </div>
        <div className="map-actions">
          {!isDistrict && <a className="level-up" href={'/workbench?area=' + encodeURIComponent(area.id) + '#area-issues'}
            target="_blank" rel="noopener noreferrer"><CockpitIcon name="pulse" />区域数据</a>}
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
        </div>
      </div>
      <div className="map-plot">
        <div className="district-map-extent">
          <Suspense fallback={<div className="map-wait" role="status">正在加载本地模型</div>}>
            <LocalDistrictModel area={area} viewMode={viewMode} onViewModeChange={onViewModeChange}
              onSelectArea={onSelectArea} onOpenTwin={onOpenTwin} />
          </Suspense>
        </div>
      </div>
    </section>
  )
}

export default function Cockpit() {
  const areaId = useMatch('/areas/:areaId')?.params.areaId ?? district
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('3d')
  const heading = useRef<HTMLDivElement>(null)
  const lastArea = useRef(areaId)
  const zone = useQuery({ ...areaQuery(areaId), placeholderData: keepPreviousData, refetchInterval: areaRefreshMs })
  const area = zone.isPlaceholderData ? undefined : zone.data
  const displayedArea = zone.data

  useEffect(() => {
    if (area && lastArea.current !== area.id) {
      lastArea.current = area.id
      heading.current?.focus({ preventScroll: true })
      window.scrollTo(0, 0)
    }
  }, [area])

  return (
    <div className="cockpit">
      <Masthead />
      <main className="cockpit-body" aria-label="区域驾驶舱">
        {displayedArea ? (
          <div className="cockpit-area" inert={zone.isPlaceholderData} aria-busy={zone.isPlaceholderData}>
            <div ref={heading} className="area-focus" tabIndex={-1} aria-label={displayedArea.name}><AreaBar area={displayedArea} /></div>

            <div className="cockpit-main">
              <RegionModel area={displayedArea} viewMode={viewMode} onViewModeChange={setViewMode}
                onSelectArea={id => { void navigate(areaPath(id)) }}
                onOpenTwin={id => { void navigate(twinPath(id), { state: { backArea: displayedArea.id } }) }} />
            </div>
          </div>
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
    </div>
  )
}
