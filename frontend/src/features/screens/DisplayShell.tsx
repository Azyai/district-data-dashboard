import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { dashboardApi } from '../../api/client'
import ScreenAgent from '../assistant/ScreenAgent'
import CoreScreen from './CoreScreen'
import { screenPath, screens, type ScreenId } from './screenCatalog'
import './display-shell.css'

const districtId = 'mentougou'
const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', timeStyle: 'medium', hourCycle: 'h23' })
const calendar = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', weekday: 'short' })
const iconPaths = {
  brand: 'M12 2.5 21 7.5v9l-9 5-9-5v-9z M6 15l4-5 3 3.5 2.5-4 2.5 5.5',
  overview: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  population: 'M12 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M3 20v-2a6 6 0 0 1 12 0v2 M16 4a3 3 0 0 1 0 6 M17 14a5 5 0 0 1 4 5v1',
  governance: 'M12 3 4.5 6v5.7c0 4 3.1 7.1 7.5 9.3 4.4-2.2 7.5-5.3 7.5-9.3V6z M8.5 12l2.5 2.5 4.5-5',
  economy: 'M4 20h16 M6 17v-4 M12 17v-6 M18 17V8 M4 10l6-5 4 2 5-4 M15 3h4v4',
  expand: 'M9 4H4v5 M15 4h5v5 M4 15v5h5 M15 20h5v-5',
  contract: 'M4 9h5V4 M20 9h-5V4 M9 20v-5H4 M15 20v-5h5',
}

function Icon({ name }: { name: keyof typeof iconPaths }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[name]} /></svg>
}

function BeijingTime() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <time dateTime={now.toISOString()} title="北京时间" className="display-clock">
    <strong>{clock.format(now)}</strong><small>{calendar.format(now)}</small>
  </time>
}

function FullscreenButton() {
  const [active, setActive] = useState(Boolean(document.fullscreenElement))
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const update = () => { setActive(Boolean(document.fullscreenElement)); setFailed(false) }
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  const label = active ? '退出全屏' : '进入全屏'
  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch { setFailed(true) }
  }
  return <button type="button" className="display-fullscreen" aria-label={label}
    title={failed ? '当前窗口无法切换全屏' : label} onClick={() => void toggle()}><Icon name={active ? 'contract' : 'expand'} /></button>
}

export default function DisplayShell({ screen }: { screen: Exclude<ScreenId, 'overview'> }) {
  const [params] = useSearchParams()
  const { key } = useLocation()
  const navigate = useNavigate()
  const areaId = params.get('area') || districtId
  const month = screen === 'governance' ? params.get('month') : null
  const directory = useQuery({
    queryKey: ['cockpit-locations'], queryFn: ({ signal }) => dashboardApi.locations(signal), staleTime: 300_000,
  })
  const zone = useQuery({
    queryKey: ['cockpit-area', areaId], queryFn: ({ signal }) => dashboardApi.area(areaId, signal), staleTime: 60_000,
  })
  const area = zone.data
  const setArea = useCallback((id: string) => {
    void navigate(screenPath(screen, id, month))
  }, [month, navigate, screen])
  return <div className="display-shell" data-screen={screen} data-area={areaId}>
    <header className="display-head">
      <div className="display-identity">
        <Link to="/" className="display-emblem" aria-label="返回全域总览"><Icon name="brand" /></Link>
        <div className="display-brand">
          <h1>门头沟区治理与发展大屏</h1>
          <div className="display-pickers">
            <select aria-label="选择区域" value={areaId} onChange={event => setArea(event.target.value)}>
              <option value={districtId}>门头沟全域</option>
              {areaId !== districtId && !directory.data?.some(item => item.id === areaId && item.level === 'town') &&
                <option value={areaId}>{area?.name ?? '当前区域'}</option>}
              {directory.data?.filter(item => item.level === 'town').map(town => <option key={town.id} value={town.id}>{town.name}</option>)}
            </select>
            <select aria-label="选择数据展示" value={screen} onChange={event => {
              const item = screens.find(item => item.id === event.target.value)
              if (item) void navigate(screenPath(item.id, areaId, month))
            }}>
              {screens.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </div>
        </div>
      </div>
      <nav className="display-nav" aria-label="大屏页面">{screens.map(item => <Link key={item.id}
        to={screenPath(item.id, areaId, month)} aria-current={item.id === screen ? 'page' : undefined}>
        <Icon name={item.id} />{item.title}</Link>)}</nav>
      <div className="display-tools">
        {area && directory.data && <ScreenAgent key={key} area={area} locations={directory.data} screen={screen} month={month ?? undefined} />}
        <BeijingTime /><FullscreenButton />
      </div>
    </header>
    <main className="display-content" aria-label={screens.find(item => item.id === screen)?.title}>
      {area ? <CoreScreen key={screen + '/' + areaId} screen={screen} area={area} onAreaChange={setArea} />
        : <section className="display-state" role="status">
          <p>{zone.isError ? '无法读取当前区域' : '正在读取区域数据…'}</p>
          {zone.isError && <div><button type="button" onClick={() => void zone.refetch()}>重试</button> <Link to="/">返回全域</Link></div>}
        </section>}
      {directory.isError && <button className="display-retry-directory" onClick={() => void directory.refetch()}>重新加载区域目录</button>}
    </main>
  </div>
}
