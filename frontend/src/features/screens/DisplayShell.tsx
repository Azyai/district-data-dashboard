import { useQuery } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { dashboardApi, type CockpitArea } from '../../api/client'
import CoreScreen, { type CoreScreenProps } from './CoreScreen'
import DiagnosisScreen from './DiagnosisScreen'
import { DisplayHeader } from './DisplayHeader'
import { screenPath, screens } from './screenCatalog'
import './display-shell.css'

type DisplayPage = CoreScreenProps['screen'] | 'diagnosis'

export default function DisplayShell({ screen }: { screen: DisplayPage }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const areaId = params.get('area') || 'mentougou'
  const month = screen === 'governance' ? params.get('month') : null
  const zone = useQuery({
    queryKey: ['cockpit-area', areaId], queryFn: ({ signal }) => dashboardApi.area(areaId, signal), staleTime: 60_000,
  })
  const [lastArea, setLastArea] = useState<CockpitArea>()
  const current = zone.data?.id === areaId ? zone.data : undefined
  useLayoutEffect(() => { if (current) setLastArea(current) }, [current])
  const area = current ?? lastArea
  const setArea = useCallback((id: string) => {
    void navigate(screenPath(screen, id, month))
  }, [month, navigate, screen])

  return <div className="display-shell" data-screen={screen} data-area={areaId}>
    <DisplayHeader areaId={areaId} areaName={current?.name} page={screen} />
    <main className="display-content" aria-label={screens.find(item => item.id === screen)?.title} aria-busy={!current && !zone.isError}>
      {area && <div className="scope-surface" data-visible-area={area.id} inert={!current} aria-hidden={!current || undefined}>
        {screen === 'diagnosis' ? <DiagnosisScreen area={area} />
          : <CoreScreen screen={screen} area={area} onAreaChange={setArea} />}
      </div>}
      {!current && <section className={'scope-feedback' + (area ? ' scope-feedback-pending' : '')}
        role={zone.isError ? 'alert' : 'status'}>
        <p>{zone.isError ? '当前区域数据读取失败' : '正在切换区域…'}
          {area && <small>画面保留在{area.name}</small>}</p>
        {zone.isError && <div><button type="button" onClick={() => void zone.refetch()}>重试</button> <Link to="/">返回全域</Link></div>}
      </section>}
    </main>
  </div>
}
