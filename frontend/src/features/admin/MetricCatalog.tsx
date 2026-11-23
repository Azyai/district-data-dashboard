import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Drawer, Input, Modal, Spin } from 'antd'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { adminApi, adminQueryKeys } from './adminApi'
import type { Metric, MetricInput, Source } from './adminApi'
import { AdminError, AdminTablePages, DisplayTime, Field, getAdminTablePage, number } from './AdminParts'

const aggregations = { SUM: '求和', RATE: '比率' } as const

const emptyDraft: MetricInput = {
  id: '', label: '', unit: '', sourceId: '', measure: '', aggregation: 'SUM', description: '',
}

function hasChanges(metric: Metric) {
  const definition = metric.published?.definition
  return !definition || (Object.keys(emptyDraft) as (keyof MetricInput)[]).some(key => definition[key] !== metric.draft[key])
}

function MetricEditor({ metric, sources, onClose, onSaved }: {
  metric?: Metric
  sources: Source[]
  onClose: () => void
  onSaved: (metric: Metric) => void
}) {
  const [draft, setDraft] = useState<MetricInput>(metric?.draft ?? emptyDraft)
  const selected = sources.find(source => source.id === draft.sourceId)
  const dataset = useQuery({
    queryKey: adminQueryKeys.dataset(draft.sourceId, selected?.lastSuccessBatchId ?? null),
    queryFn: ({ signal }) => adminApi.dataset(draft.sourceId, signal),
    enabled: Boolean(selected?.lastSuccessBatchId),
  })
  const save = useMutation({
    mutationFn: (input: MetricInput) => metric ? adminApi.updateMetric(input, metric.revision) : adminApi.createMetric(input),
    onSuccess: onSaved,
  })

  function patch<K extends keyof MetricInput>(key: K, value: MetricInput[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dataset.data?.measures.includes(draft.measure)) return
    save.mutate({
      ...draft,
      id: draft.id.trim(),
      label: draft.label.trim(),
      unit: draft.unit.trim(),
      description: draft.description?.trim() ?? '',
    })
  }

  return (
    <Drawer open title={metric ? '编辑指标口径' : '新增指标'} size="large" rootClassName="admin-drawer"
      keyboard={!save.isPending} mask={{ closable: !save.isPending }} onClose={() => { if (!save.isPending) onClose() }}>
      <form className="admin-form" onSubmit={submit}>
        <fieldset disabled={save.isPending}>
          <legend>指标定义</legend>
          <div className="admin-form-row">
            <Field label="指标名称"><Input value={draft.label} required onChange={event => patch('label', event.target.value)} /></Field>
            <Field label="指标编码"><Input value={draft.id} required readOnly={Boolean(metric)} onChange={event => patch('id', event.target.value)} /></Field>
          </div>
          <Field label="口径说明"><Input.TextArea rows={3} value={draft.description} required onChange={event => patch('description', event.target.value)} /></Field>
        </fieldset>
        <fieldset disabled={save.isPending}>
          <legend>来源与聚合</legend>
          <Field label="绑定来源" help="来源须拥有成功同步批次。">
            <select value={draft.sourceId} required onChange={event => {
              const sourceId = event.target.value
              setDraft(current => ({ ...current, sourceId, measure: '' }))
            }}>
              <option value="">选择来源</option>
              {sources.map(source => <option value={source.id} key={source.id} disabled={!source.lastSuccessBatchId}>
                {source.name}{source.lastSuccessBatchId ? '' : '（暂无成功同步）'}
              </option>)}
            </select>
          </Field>
          {!sources.some(source => source.lastSuccessBatchId) &&
            <p className="admin-secondary">先在「数据来源」完成一次成功同步，度量会出现在这里。</p>}
          <div className="admin-form-row">
            <Field label="度量">
              <select value={draft.measure} disabled={!dataset.data} required onChange={event => patch('measure', event.target.value)}>
                <option value="">选择已同步的度量</option>
                {dataset.data?.measures.map(measure => <option key={measure} value={measure}>{measure}</option>)}
              </select>
            </Field>
            <Field label="聚合方式">
              <select value={draft.aggregation} onChange={event => {
                const aggregation = event.target.value as MetricInput['aggregation']
                setDraft(current => ({
                  ...current,
                  aggregation,
                  unit: aggregation === 'RATE' ? '%' : current.aggregation === 'RATE' ? '' : current.unit,
                }))
              }}>
                <option value="SUM">求和</option>
                <option value="RATE">比率</option>
              </select>
            </Field>
          </div>
          <Field label="单位" help={draft.aggregation === 'RATE' ? '比率按对应行的累计数值除以累计分母计算。' : undefined}>
            <Input value={draft.unit} readOnly={draft.aggregation === 'RATE'} required onChange={event => patch('unit', event.target.value)} />
          </Field>
          {dataset.data && <p className="admin-secondary admin-break">当前批次 {dataset.data.batchId} · {number.format(dataset.data.rowCount)} 行</p>}
          <AdminError error={dataset.error} retry={() => void dataset.refetch()} />
        </fieldset>
        <AdminError error={save.error} />
        <div className="admin-form-actions">
          <Button disabled={save.isPending} onClick={onClose}>取消</Button>
          <Button type="primary" htmlType="submit" loading={save.isPending}
            disabled={!dataset.data?.measures.includes(draft.measure)}>保存草稿</Button>
        </div>
      </form>
    </Drawer>
  )
}

function MetricEvidence({ metric, sources }: { metric: Metric; sources: Source[] }) {
  const published = metric.published
  const definition = published?.definition ?? metric.draft
  const source = sources.find(source => source.id === definition.sourceId)
  const dataset = useQuery({
    queryKey: adminQueryKeys.dataset(definition.sourceId, source?.lastSuccessBatchId ?? null),
    queryFn: ({ signal }) => adminApi.dataset(definition.sourceId, signal),
    enabled: Boolean(source?.lastSuccessBatchId),
  })
  return (
    <section className="admin-detail" aria-labelledby="metric-evidence-title">
      <header className="admin-detail-head">
        <div>
          <h2 id="metric-evidence-title">{definition.label}</h2>
          <p>{published ? '生效口径 · v' + published.version : '草稿口径'}</p>
        </div>
        {published && <Link to="/" className="admin-text-link">到驾驶舱核对</Link>}
      </header>
      <div className="admin-detail-body">
        <dl className="admin-kv">
          <div><dt>来源</dt><dd><Link className="admin-text-link" to={'/admin/sources?source=' + encodeURIComponent(definition.sourceId)}>{source?.name ?? definition.sourceId}</Link></dd></div>
          <div><dt>度量</dt><dd>{definition.measure}</dd></div>
          <div><dt>统计方法</dt><dd>{aggregations[definition.aggregation]} · {definition.unit}</dd></div>
          <div><dt>发布时间</dt><dd><DisplayTime value={published?.publishedAt} /></dd></div>
        </dl>
        <p className="admin-description">{definition.description}</p>
        {dataset.data && (
          <div className="admin-evidence">
            <h3>来源最新成功批次</h3>
            <p className="admin-break">{dataset.data.batchId}</p>
            <p>{number.format(dataset.data.rowCount)} 行 · <DisplayTime value={dataset.data.syncedAt} /></p>
          </div>
        )}
        <AdminError error={dataset.error} retry={() => void dataset.refetch()} />
      </div>
    </section>
  )
}

export function MetricCatalog() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [editor, setEditor] = useState<Metric | 'new' | null>(null)
  const [selectId, setSelectId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Metric | null>(null)
  const [notice, setNotice] = useState('')
  const sources = useQuery({ queryKey: adminQueryKeys.sources, queryFn: ({ signal }) => adminApi.sources(signal) })
  const metrics = useQuery({ queryKey: adminQueryKeys.metrics, queryFn: ({ signal }) => adminApi.metrics(signal) })

  const keyword = filter.trim().toLowerCase()
  const visible = (metrics.data ?? []).filter(metric =>
    (!status || (status === 'published' ? Boolean(metric.published) : hasChanges(metric))) &&
    (!keyword || (metric.id + ' ' + metric.draft.label).toLowerCase().includes(keyword)),
  )
  const { currentPage, pageCount, rows } = getAdminTablePage(visible, page)
  const selected = metrics.data?.find(metric => metric.id === selectId)
  const bySource = new Map(sources.data?.map(source => [source.id, source.name]))

  function updateCache(metric: Metric) {
    queryClient.setQueryData<Metric[]>(adminQueryKeys.metrics, previous => {
      const current = previous ?? []
      return current.some(item => item.id === metric.id)
        ? current.map(item => item.id === metric.id ? metric : item)
        : [...current, metric]
    })
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.metrics })
    setSelectId(metric.id)
  }

  const publish = useMutation({
    mutationFn: (metric: Metric) => adminApi.publishMetric(metric.id, metric.revision),
    onSuccess: async metric => {
      updateCache(metric)
      setConfirmation(null)
      setNotice(metric.draft.label + ' 已发布' + (metric.published ? ' v' + metric.published.version : ''))
      await queryClient.invalidateQueries({ queryKey: ['cockpit-area'] })
    },
  })

  function saved(metric: Metric) {
    setEditor(null)
    setNotice(metric.draft.label + ' 草稿已保存')
    updateCache(metric)
  }

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div><h1>指标目录</h1><p>管理统计口径和版本。发布后的版本供驾驶舱使用。</p></div>
        <Button type="primary" onClick={() => setEditor('new')} disabled={!sources.data}>新增指标</Button>
      </header>
      {notice && <p className="admin-success" role="status">{notice}</p>}
      <AdminError error={sources.error} retry={() => void sources.refetch()} />
      <section className="admin-list" aria-label="指标目录">
        <div className="admin-list-tools">
          <Input allowClear value={filter} onChange={event => {
            setFilter(event.target.value)
            setPage(1)
          }}
            placeholder="搜索指标名称或编码" aria-label="搜索指标名称或编码" />
          <select aria-label="筛选指标状态" value={status} onChange={event => {
            setStatus(event.target.value)
            setPage(1)
          }}>
            <option value="">全部状态</option><option value="draft">待发布</option><option value="published">已发布</option>
          </select>
          {metrics.data && <span className="admin-secondary" role="status">匹配 {visible.length} 个，共 {metrics.data.length} 个</span>}
        </div>
        {metrics.isPending && <p className="admin-list-message" aria-busy="true"><Spin size="small" /> 正在查询指标</p>}
        <AdminError error={metrics.error} retry={() => void metrics.refetch()} />
        {!metrics.isPending && !metrics.isError && visible.length === 0 && <p className="admin-list-message">
          {metrics.data?.length ? '没有符合筛选条件的指标。' : '还没有配置指标。选择「新增指标」建立第一个口径。'}
        </p>}
        {visible.length > 0 && (
          <div className="admin-table-scroll" role="region" aria-label="指标目录列表" tabIndex={0}>
            <table className="admin-table admin-metric-table">
              <thead><tr><th scope="col">指标</th><th scope="col">绑定来源</th><th scope="col">聚合方式</th><th scope="col">生效版本</th><th scope="col">操作</th></tr></thead>
              <tbody>{rows.map(metric => (
                <tr key={metric.id} data-active={selectId === metric.id}>
                  <th scope="row"><strong>{metric.draft.label}</strong><small>{metric.id}</small></th>
                  <td>{bySource.get(metric.draft.sourceId) ?? metric.draft.sourceId}</td>
                  <td>{aggregations[metric.draft.aggregation]}<small>{metric.draft.measure} · {metric.draft.unit}</small></td>
                  <td>{metric.published ? <span className="admin-status" data-state="SUCCEEDED">v{metric.published.version}</span> : '未发布'}
                    {hasChanges(metric) && <small>编辑版本 {metric.revision} · 待发布</small>}</td>
                  <td>
                    <div className="admin-inline">
                      <Button size="small" onClick={() => setSelectId(metric.id)} aria-label={'查看口径 ' + metric.draft.label}>查看口径</Button>
                      <Button size="small" disabled={!sources.data} onClick={() => setEditor(metric)} aria-label={'编辑指标 ' + metric.draft.label}>编辑</Button>
                      <Button size="small" type="primary" disabled={!hasChanges(metric)} onClick={() => {
                        publish.reset()
                        setConfirmation(metric)
                      }} aria-label={'发布指标 ' + metric.draft.label}>发布</Button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <AdminTablePages pageCount={pageCount} current={currentPage} onChange={setPage} label="指标目录分页" />
      </section>
      {selected && <MetricEvidence metric={selected} sources={sources.data ?? []} />}
      {editor && sources.data && <MetricEditor metric={editor === 'new' ? undefined : editor}
        sources={sources.data} onClose={() => setEditor(null)} onSaved={saved} />}
      {confirmation && (
        <Modal open title="发布指标" okText="确认发布" cancelText="取消" rootClassName="admin-drawer"
          onOk={() => publish.mutate(confirmation)} confirmLoading={publish.isPending}
          keyboard={!publish.isPending} mask={{ closable: !publish.isPending }}
          onCancel={() => { if (!publish.isPending) setConfirmation(null) }}>
          <p>发布「{confirmation.draft.label}」，驾驶舱将使用该统计口径。</p>
          <AdminError error={publish.error} />
        </Modal>
      )}
    </div>
  )
}
