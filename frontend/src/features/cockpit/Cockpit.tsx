import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useMatch, useNavigate } from 'react-router'
import { dashboardApi, type CockpitArea, type CockpitDirectory } from '../../api/client'
import MetricRails from './MetricRails'
import ScreenAgent from '../assistant/ScreenAgent'
import { screenPath, screens } from '../screens/screenCatalog'
import { twinPath, type TwinId } from './twinSites'
import './cockpit.css'

const TiandituMap = lazy(() => import('./TiandituMap'))
const district = 'mentougou'
const areaRefreshMs = 60_000
const calendar = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai',
})
const clock = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai',
})

function areaPath(areaId: string) {
  return screenPath('overview', areaId)
}

const areaQuery = (areaId: string) => queryOptions({
  queryKey: ['cockpit-area', areaId],
  queryFn: ({ signal }) => dashboardApi.area(areaId, signal),
  staleTime: areaRefreshMs,
})

const directoryQuery = queryOptions({
  queryKey: ['cockpit-locations'],
  queryFn: ({ signal }) => dashboardApi.locations(signal),
  staleTime: 300_000,
})

function Masthead() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const date = calendar.format(now)
  const time = clock.format(now)
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
      <time className="masthead-time" dateTime={now.toISOString()} aria-label={'北京时间 ' + date + ' ' + time}>
        <span><small>北京时间</small>{date}</span><strong>{time}</strong>
      </time>
    </header>
  )
}

function RegionPicker({ area, directory, directoryState }: {
  area: CockpitArea
  directory?: CockpitDirectory
  directoryState: 'pending' | 'success' | 'error'
}) {
  const picker = useRef<HTMLDetailsElement>(null)
  const available = directory ?? [
    ...area.breadcrumbs.map((location, index) => ({ ...location, parentId: area.breadcrumbs[index - 1]?.id ?? null })),
    ...area.children.map(location => ({ ...location, parentId: area.id })),
  ]
  const townId = area.breadcrumbs[1]?.id
  const districtEntry = available.find(location => location.level === 'district')
  const towns = available.filter(location => location.level === 'town')
  const orderedTowns = [
    ...towns.filter(town => town.id === townId),
    ...towns.filter(town => town.id !== townId),
  ]
  useEffect(() => {
    const element = picker.current
    if (!element) return
    function dismiss(event: PointerEvent) {
      if (element?.open && event.target instanceof Node && !element.contains(event.target)) element.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])

  const areaLink = (location: CockpitDirectory[number]) => (
    <Link to={areaPath(location.id)} aria-current={location.id === area.id ? 'page' : undefined}
      onClick={event => {
        if (location.id !== area.id || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !picker.current) return
        event.preventDefault()
        picker.current.open = false
        picker.current.querySelector('summary')?.focus()
      }}>
      {location.name}
    </Link>
  )

  return (
    <details className="region-picker" ref={picker}
      onKeyDown={event => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return
        event.preventDefault()
        event.currentTarget.open = false
        event.currentTarget.querySelector('summary')?.focus()
      }}
      onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
      }}>
      <summary>选择区域{area.level === 'district' && <span title="镇街数量">{towns.length}</span>}</summary>
      <nav className="map-directory" aria-label="区域目录">
        {districtEntry && <div className="map-directory-root">{areaLink(districtEntry)}</div>}
        {orderedTowns.map(town => (
          <section className="map-directory-town" key={town.id} aria-label={town.name}>
            {areaLink(town)}
            <ul>
              {available.filter(location => location.parentId === town.id).map(village => (
                <li key={village.id}>{areaLink(village)}</li>
              ))}
            </ul>
          </section>
        ))}
        {directoryState === 'pending' && <p role="status">正在读取区域目录</p>}
        {directoryState === 'error' && <p role="status">完整区域目录暂不可用</p>}
      </nav>
    </details>
  )
}

function RegionDisplay({ area, directory, directoryState, viewMode, onViewModeChange, onSelectArea, onOpenTwin }: {
  area: CockpitArea
  directory?: CockpitDirectory
  directoryState: 'pending' | 'success' | 'error'
  viewMode: '2d' | '3d'
  onViewModeChange: (mode: '2d' | '3d') => void
  onSelectArea: (areaId: string) => void
  onOpenTwin: (id: TwinId) => void
}) {
  const navigate = useNavigate()
  const isDistrict = area.level === 'district'
  const parent = area.breadcrumbs.at(-2)
  return (
    <section className="map-panel" data-level={area.level} aria-labelledby="area-model">
      <div className="map-toolbar">
        <div className="map-heading">
          {parent && <Link className="map-parent" to={areaPath(parent.id)} aria-label={'返回上一级 ' + parent.name}>‹ {parent.name}</Link>}
          <h2 id="area-model">{area.name}{isDistrict && <span>全域</span>}</h2>
        </div>
        <div className="map-actions">
          <RegionPicker key={area.id} area={area} directory={directory} directoryState={directoryState} />
          <select className="screen-picker" aria-label="选择数据展示" value="overview"
            onChange={event => {
              const next = screens.find(item => item.id === event.target.value)
              if (next) void navigate(screenPath(next.id, area.id))
            }}>
            {screens.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          {directory && <ScreenAgent area={area} locations={directory} />}
          {!isDistrict && <a className="level-up" href={'/data/areas/' + encodeURIComponent(area.id) + '#area-issues'}
            target="_blank" rel="noopener noreferrer">区域数据 <span aria-hidden="true">↗</span></a>}
        </div>
      </div>
      <div className="map-plot">
        <Suspense fallback={<div className="map-wait" role="status">正在打开区域地图</div>}>
          <TiandituMap area={area} directory={directory} viewMode={viewMode} onViewModeChange={onViewModeChange}
            onSelectArea={onSelectArea} onOpenTwin={onOpenTwin} />
        </Suspense>
      </div>
      <MetricRails area={area} />
    </section>
  )
}

export default function Cockpit() {
  const areaId = useMatch('/areas/:areaId')?.params.areaId ?? district
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d')
  const heading = useRef<HTMLDivElement>(null)
  const lastArea = useRef(areaId)
  const zone = useQuery({ ...areaQuery(areaId), placeholderData: keepPreviousData, refetchInterval: areaRefreshMs })
  const directory = useQuery(directoryQuery)
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
      <Masthead />
      <main className="cockpit-body" aria-label="区域驾驶舱">
        {area ? (
          <div ref={heading} className="cockpit-main" tabIndex={-1} aria-label={area.name}
            inert={zone.isPlaceholderData} aria-busy={zone.isPlaceholderData}>
            <RegionDisplay area={area} directory={directory.data} directoryState={directory.status}
              viewMode={viewMode} onViewModeChange={setViewMode}
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
