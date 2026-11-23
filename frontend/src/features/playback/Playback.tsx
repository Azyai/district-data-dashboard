import { skipToken, useQuery } from '@tanstack/react-query'
import { Spin } from 'antd'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError, dashboardApi } from '../../api/client'
import type { Me } from '../../api/client'
import { Problem } from '../../shared/Problem'
import { ScreenCanvas } from './ScreenCanvas'
import './playback.css'

const displayDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatTimestamp(value: string) {
  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime()) ? '暂不可用' : displayDate.format(timestamp)
}

export default function Playback({ identity, identityControl }: { identity: Me; identityControl: ReactNode }) {
  const { projectId = '' } = useParams()
  const manifestQuery = useQuery({
    queryKey: ['manifest', identity.id, projectId],
    queryFn: ({ signal }) => dashboardApi.manifest(projectId, signal),
  })
  const manifest = manifestQuery.data
  const dataQuery = useQuery({
    queryKey: ['component-data', identity.id, projectId, manifest?.releaseId],
    queryFn: manifest ? ({ signal }) => dashboardApi.components(projectId, {
      releaseId: manifest.releaseId,
      componentIds: manifest.components.map(component => component.id),
    }, signal) : skipToken,
  })

  if (manifestQuery.isError) {
    return <Problem title="无法打开专题" error={manifestQuery.error} returnToCockpit onRetry={() => void manifestQuery.refetch()} />
  }
  if (dataQuery.isError) {
    const retry = dataQuery.error instanceof ApiError && dataQuery.error.code === 'RELEASE_CONFLICT'
      ? manifestQuery.refetch
      : dataQuery.refetch
    return <Problem title="看板数据加载失败" error={dataQuery.error} returnToCockpit onRetry={() => void retry()} />
  }
  if (!manifest || !dataQuery.data) {
    return <main className="center-state" aria-busy="true"><Spin /><span>正在加载专题</span></main>
  }

  const snapshot = dataQuery.data
  return (
    <main className="playback-shell" data-theme={manifest.theme} aria-labelledby="screen-title">
      <header className="playback-bar">
        <Link to="/" className="playback-back"><i aria-hidden="true" />返回驾驶舱</Link>
        {identityControl}
      </header>
      <section className="playback-heading">
        <div>
          <h1 id="screen-title">{manifest.title}</h1>
          <p className="muted">{manifest.description}</p>
        </div>
        <p className="playback-status">
          <span className="status-mark">模拟数据</span>
          <time dateTime={snapshot.updatedAt} aria-label={'数据时间 ' + formatTimestamp(snapshot.updatedAt)}>{formatTimestamp(snapshot.updatedAt)}</time>
        </p>
      </section>
      <ScreenCanvas manifest={manifest} snapshot={snapshot} />
    </main>
  )
}
