import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useMatch, useNavigate, useSearchParams } from 'react-router'
import { dashboardApi } from '../../api/client'
import { DisplayHeader } from '../screens/DisplayHeader'
import { displayPath } from '../screens/screenCatalog'
import MonitoringPanels from './MonitoringPanels'
import { beijingHalfHour, monitoringSnapshot, readMonitoring, type MonitorPage } from './monitoringData'
import './cockpit.css'

const TiandituMap = lazy(() => import('./TiandituMap'))
const district = 'mentougou'

export default function Cockpit({ page = 'roads' }: { page?: MonitorPage }) {
  const pathArea = useMatch('/areas/:areaId')?.params.areaId
  const [params] = useSearchParams()
  const areaId = pathArea ?? (params.get('area') || district)
  const navigate = useNavigate()
  const [view, setView] = useState<'2d'|'3d'>('2d')
  const [liveHour, setLiveHour] = useState(beijingHalfHour)
  const [reviewHour, setReviewHour] = useState<number | null>(null)
  const hour = reviewHour ?? liveHour
  useEffect(() => {
    const slotMs = 30 * 60_000
    let timer: number
    const sync = () => {
      window.clearTimeout(timer)
      setLiveHour(beijingHalfHour())
      timer = window.setTimeout(sync, slotMs - Date.now() % slotMs + 50)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  const [filter, setFilter] = useState('')
  const [focus, setFocus] = useState({ scope: '', name: '' })
  const zone = useQuery({queryKey: ['cockpit-area', areaId], queryFn: ({signal})=>dashboardApi.area(areaId,signal),
    staleTime: 60_000, refetchInterval: 60_000, placeholderData: keepPreviousData})
  const directory = useQuery({queryKey: ['cockpit-locations'], queryFn: ({signal})=>dashboardApi.locations(signal), staleTime:300_000})
  const catalog = useQuery({queryKey: ['monitoring-catalog'], queryFn: ({signal})=>readMonitoring(signal), staleTime:Infinity})
  const area = zone.data
  const data = useMemo(()=>catalog.data && area && monitoringSnapshot(catalog.data,page,area,hour), [catalog.data,page,area,hour])
  const scope = page + '/' + areaId
  const selected = focus.scope === scope ? focus.name : ''
  const select = (name:string) => setFocus({scope,name})
  const go = (id:string)=>{void navigate(displayPath(page,id))}
  return <div className="cockpit monitor-shell">
    <DisplayHeader areaId={areaId} areaName={area?.id===areaId ? area.name : undefined} page={page}/>
    <main className="monitoring-stage" data-page={page} data-hour={hour} aria-label="区域驾驶舱">
      {area && !zone.isError ? <div className="monitor-map-layout" aria-busy={zone.isPlaceholderData} inert={zone.isPlaceholderData}>
        <Suspense fallback={<div className="map-wait" role="status">正在打开区域地图</div>}>
          <TiandituMap area={area} directory={directory.data} viewMode={view} onViewModeChange={setView} onSelectArea={go}
            topic={page} data={data} selected={selected} status={filter} onSelectFeature={select}/>
        </Suspense>
        {data && catalog.data && <MonitoringPanels key={scope} page={page} area={area} directory={directory.data} catalog={catalog.data}
          data={data} selected={selected} hour={hour} status={filter} onSelect={select} onArea={go} onHour={setReviewHour} onLive={() => setReviewHour(null)} onStatus={status=>{
            setFilter(status)
            const road=data.roads.find(item=>item.name===selected)
            if (road && status && road.status!==status) select('')
          }}/>}
        {catalog.isError && <div className="monitor-data-error" role="alert">专题资料暂不可用 <button onClick={()=>void catalog.refetch()}>重试</button></div>}
      </div> : <section className="cockpit-state" role="status"><h2>{zone.isError?'区域数据暂不可用':'正在加载区域数据'}</h2>
        {zone.isError && <><p>{zone.error.message}</p><button onClick={()=>void zone.refetch()}>重试</button><Link to={displayPath(page,district)}>查看全域</Link></>}</section>}
      {zone.isPlaceholderData && area && <p className="monitor-loading-scope" role="status">正在切换区域，当前显示{area.name}</p>}
    </main>
  </div>
}
