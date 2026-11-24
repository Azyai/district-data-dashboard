import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Modal } from 'antd'
import { useState } from 'react'
import { ApiError, dashboardApi, type CockpitArea } from '../../api/client'
import { defaultSideMetrics, saveSideMetrics, sideMetricsKey, useSideMetrics, type SideMetrics, type SideSelection } from '../cockpit/sideMetrics'
import { AdminError, AdminIcon, number } from './AdminParts'
import './cockpit-settings.css'

const sides = ['left', 'right'] as const
const title = { left: '左侧指标', right: '右侧指标' }
const district = 'mentougou'

function useArea(id: string) {
  return useQuery({
    queryKey: ['cockpit-area', id],
    queryFn: ({ signal }) => dashboardApi.area(id, signal),
    staleTime: 0,
  })
}

function Preview({ selection, root, close }: { selection: SideSelection; root: CockpitArea; close: () => void }) {
  const [areaId, setAreaId] = useState(district)
  const directory = useQuery({ queryKey: ['cockpit-directory'], queryFn: ({ signal }) => dashboardApi.locations(signal), staleTime: 300_000 })
  const snapshot = useArea(areaId)
  const area = snapshot.data
  return (
    <Modal title="侧栏数据测试" open centered width="min(40rem, calc(100vw - 1.5rem))" onCancel={close}
      footer={<Button onClick={close}>完成测试</Button>}>
      <div className="side-preview">
        <label>测试区域
          <select value={areaId} onChange={event => setAreaId(event.target.value)}>
            {(directory.data ?? [root, ...root.children]).map(item =>
              <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {snapshot.isError ? <AdminError error={snapshot.error} retry={() => void snapshot.refetch()} />
          : !area ? <p role="status">正在读取区域快照</p> : <>
            <p className="side-preview-caption">{area.name} · 模拟数据</p>
            <div className="side-preview-grid">
              {sides.map(side => <section key={side} aria-label={'测试' + title[side]}>
                <h3>{title[side]}</h3>
                <dl>{selection[side].map(id => {
                  const metric = area.metrics.find(item => item.id === id)
                  return <div key={id}>
                    <dt>{metric?.label ?? id}</dt>
                    <dd>{metric?.status !== 'NO_DATA' && metric?.value != null && Number.isFinite(metric.value)
                      ? <><strong>{number.format(metric.value)}</strong> {metric.unit}</> : '暂无数据'}</dd>
                  </div>
                })}</dl>
              </section>)}
            </div>
          </>}
      </div>
    </Modal>
  )
}

export default function CockpitSettings() {
  const cache = useQueryClient()
  const saved = useSideMetrics()
  const area = useArea(district)
  const [draft, setDraft] = useState<SideMetrics | null>(null)
  const [preview, setPreview] = useState(false)
  const [notice, setNotice] = useState('')
  const save = useMutation({
    mutationFn: saveSideMetrics,
    onSuccess: record => {
      cache.setQueryData(sideMetricsKey, record)
      setDraft(null)
      setNotice('已应用至驾驶舱')
    },
  })
  const current = draft ?? saved.data
  const root = area.data
  const isConflict = save.error instanceof ApiError && save.error.status === 409

  function update(next: SideMetrics) {
    setNotice('')
    save.reset()
    setDraft(next)
  }

  return (
    <section className="side-settings admin-page">
      <header className="admin-page-heading">
        <div><h1>驾驶舱侧栏</h1><p>选择地图两侧的公开指标，按列表顺序展示。切换镇街时同步读取该区域的观测值。</p></div>
      </header>
      {(!saved.data || !root) && <AdminError error={saved.error ?? area.error} retry={() => { void saved.refetch(); void area.refetch() }} />}
      {!current || !root ? (saved.isPending || area.isPending) && <p role="status">正在读取当前配置</p> : <>
        <div className="side-settings-grid">
          {sides.map(side => {
            const ids = current[side]
            const all = new Set([...current.left, ...current.right])
            const available = root.metrics.filter(metric => !all.has(metric.id))
            const replace = (next: string[]) => update({ ...current, [side]: next })
            return <section className="side-setting" key={side} aria-label={title[side]}>
              <header>
                <span className={'side-position ' + side} aria-hidden="true"><i /><i /></span>
                <h2>{title[side]}</h2><span className="side-count">{ids.length} / 3</span>
              </header>
              <ol>{ids.map((id, index) => <li key={index}>
                <label>
                  <span className="side-ordinal" aria-hidden="true">{index + 1}</span>
                  <select aria-label={title[side] + '第' + (index + 1) + '项'} value={id} disabled={save.isPending}
                    onChange={event => {
                      const next = event.target.value
                      replace(ids.map((metricId, position) => position === index ? next : metricId === next ? id : metricId))
                    }}>
                    {root.metrics.filter(metric => ids.includes(metric.id) || !all.has(metric.id)).map(metric =>
                      <option key={metric.id} value={metric.id}>{metric.label}</option>)}
                  </select>
                </label>
                <button type="button" className="side-remove" aria-label={'移除' + title[side] + '第' + (index + 1) + '项'}
                  disabled={ids.length === 1 || save.isPending}
                  onClick={() => replace(ids.filter((_, position) => position !== index))}>×</button>
              </li>)}</ol>
              <Button block icon={<AdminIcon name="add" />} disabled={!available.length || ids.length >= 3 || save.isPending}
                onClick={() => replace([...ids, available[0].id])}>添加{title[side]}</Button>
            </section>
          })}
        </div>
        <div className="side-settings-actions">
          <Button disabled={save.isPending} onClick={() => update({ ...defaultSideMetrics, revision: current.revision })}>恢复默认选择</Button>
          <div className="admin-actions">
            <Button icon={<AdminIcon name="chart" />} onClick={() => setPreview(true)}>测试预览</Button>
            <Button type="primary" loading={save.isPending} disabled={!draft || isConflict}
              onClick={() => save.mutate(current)}>应用至驾驶舱</Button>
          </div>
        </div>
        {notice && <p className="side-notice" role="status">{notice}</p>}
        {save.error && <AdminError error={save.error} />}
        {isConflict && <Button onClick={async () => {
          const refreshed = await saved.refetch()
          if (refreshed.isSuccess) { setDraft(null); save.reset(); setNotice('已载入最新配置') }
        }}>载入最新配置</Button>}
        {preview && <Preview selection={current} root={root} close={() => setPreview(false)} />}
      </>}
    </section>
  )
}
