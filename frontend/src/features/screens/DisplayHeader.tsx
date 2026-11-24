import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { dashboardApi } from '../../api/client'
import { businessScreens, displayPath, mapScreens, screenPath, type DisplayPage } from './screenCatalog'
import './display-shell.css'

const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const dayFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})

function BeijingClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <time className="center-clock" dateTime={now.toISOString()} aria-label={'北京时间 ' + dayFormat.format(now) + ' ' + timeFormat.format(now)}>
    <span>{dayFormat.format(now)}</span><strong>{timeFormat.format(now)}</strong>
  </time>
}

export function CenterMasthead({ name, subject, controls, family }: {
  name?: string; subject: string; controls: ReactNode; family?: 'map' | 'business'
}) {
  const title = '门头沟' + (name ?? '') + '全域数字中心'
  useEffect(() => { document.title = title + ' - ' + subject }, [title, subject])
  return <header className="center-masthead" data-family={family}>
    <div className="center-controls">{controls}</div>
    <div className="center-heading">
      <h1>{title}</h1><p>{subject}</p>
    </div>
    <BeijingClock />
  </header>
}

export function DisplayHeader({ areaId, areaName, page }: { areaId: string; areaName?: string; page: DisplayPage }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const directory = useQuery({
    queryKey: ['cockpit-locations'], queryFn: ({ signal }) => dashboardApi.locations(signal), staleTime: 300_000,
  })
  const current = page === 'roads' ? 'overview' : page
  const isMap = mapScreens.some(item => item.id === current)
  const choices = isMap ? mapScreens : businessScreens
  const locations = directory.data ?? []
  const name = areaId === 'mentougou' ? undefined : locations.find(item => item.id === areaId)?.name ?? areaName
  const month = page === 'governance' ? params.get('month') : null
  const subject = choices.find(item => item.id === current)!.title
  return <CenterMasthead name={name} subject={subject} family={isMap ? 'map' : 'business'} controls={<>
    <select className="display-picker" aria-label="选择区域" value={areaId}
      onChange={e => void navigate(displayPath(page, e.target.value, month), { preventScrollReset: true })}>
      <option value="mentougou">门头沟全域</option>
      {!locations.some(item => item.id === areaId) && areaId !== 'mentougou' && <option value={areaId}>{name ?? '当前区域'}</option>}
      {locations.filter(item => item.level === 'town').map(town => <optgroup key={town.id} label={town.name}>
        <option value={town.id}>{town.name}</option>
        {locations.filter(item => item.parentId === town.id).map(village => <option key={village.id} value={village.id}>{village.name}</option>)}
      </optgroup>)}
    </select>
    <select className="display-picker" aria-label="选择数据展示" value={current} onChange={e => {
      const target = choices.find(item => item.id === e.target.value)
      if (target) void navigate(screenPath(target.id, areaId, month), { preventScrollReset: true })
    }}>
      {choices.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
    </select>
    <Link className="display-switch" to={screenPath(isMap ? 'population' : 'overview', areaId)} aria-label={isMap ? '切换到数据专题' : '切换到地图监测'}>
      <span>{isMap ? '数据专题' : '地图监测'}</span><span aria-hidden="true">↗</span>
    </Link>
  </>} />
}
