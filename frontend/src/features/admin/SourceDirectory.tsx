import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Spin } from 'antd'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { adminApi, adminQueryKeys } from './adminApi'
import type { ConnectionTest, Source, SyncRun } from './adminApi'
import { AdminError, AdminIcon, AdminTablePages, DisplayTime, getAdminTablePage, number } from './AdminParts'
import { SourceEditor, sourceTypes } from './SourceEditor'

const statuses = {
  RUNNING: '同步中',
  SUCCEEDED: '成功',
  FAILED: '失败',
  REJECTED: '质量拒绝',
} as const

const triggers = { MANUAL: '手动', SCHEDULED: '定时', RETRY: '重试' } as const
const sourceIcons = { HTTPS_JSON: 'link', MYSQL_VIEW: 'source', CSV: 'file' } as const

function SyncStatus({ status }: { status?: SyncRun['status'] | null }) {
  return <span className="admin-status" data-state={status ?? 'idle'}>{status ? statuses[status] : '尚未同步'}</span>
}

function Preview({ result }: { result: ConnectionTest }) {
  return (
    <section className="admin-evidence" aria-label="连接测试结果">
      <div className="admin-inline">
        <strong className={result.status === 'PASSED' ? 'admin-success' : 'admin-danger'} role="status">
          {result.status === 'PASSED' ? '连接通过' : '连接失败'}
        </strong>
        <span>{result.message}</span>
      </div>
      {result.fields.length > 0 && <p className="admin-secondary">原始字段 {result.fields.join('、')}</p>}
      <p className="admin-secondary">读取 {number.format(result.totalRows)} 行 · 拒绝 {number.format(result.rejectedRows)} 行</p>
      {result.preview.length > 0 && (
        <div className="admin-table-scroll" role="region" aria-label="标准化样本预览" tabIndex={0}>
          <table className="admin-table admin-compact">
            <thead><tr><th scope="col">区域</th><th scope="col">观测日期</th><th scope="col">度量</th><th scope="col">数值</th><th scope="col">分母</th></tr></thead>
            <tbody>
              {result.preview.map((row, index) => (
                <tr key={index}>
                  <td>{row.regionId}</td><td>{row.observedOn}</td><td>{row.measure}</td>
                  <td className="admin-number">{number.format(row.value)}</td>
                  <td className="admin-number">{row.denominator == null ? '—' : number.format(row.denominator)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function SourceDetail({ source, onEdit }: { source: Source; onEdit: () => void }) {
  const queryClient = useQueryClient()
  const runs = useQuery({
    queryKey: adminQueryKeys.runs(source.id),
    queryFn: ({ signal }) => adminApi.runs(source.id, signal),
    refetchInterval: query => query.state.data?.some(run => run.status === 'RUNNING') ? 2000 : false,
  })
  const dataset = useQuery({
    queryKey: adminQueryKeys.dataset(source.id, source.lastSuccessBatchId),
    queryFn: ({ signal }) => adminApi.dataset(source.id, signal),
    enabled: Boolean(source.lastSuccessBatchId),
  })
  const test = useMutation({ mutationFn: () => adminApi.connectionTest(source.id) })
  const sync = useMutation({
    mutationFn: ({ key, retryOf }: { key: string; retryOf?: string }) => adminApi.synchronize(source.id, key, retryOf),
    onSuccess: result => {
      if (result.status === 'SUCCEEDED') void queryClient.invalidateQueries({ queryKey: ['cockpit-area'] })
    },
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.sources }),
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.runs(source.id) }),
    ]),
  })
  const busy = sync.isPending || test.isPending
  const running = runs.data?.some(run => run.status === 'RUNNING') || source.lastSyncStatus === 'RUNNING'

  function start(retryOf?: string) {
    if (!busy && !running) sync.mutate({ key: crypto.randomUUID(), retryOf })
  }

  return (
    <section className="admin-detail" aria-labelledby="source-detail-heading">
      <header className="admin-detail-head">
        <div>
          <h2 id="source-detail-heading">{source.name}</h2>
          <p>{source.id} · {sourceTypes[source.type]} · 配置版本 {source.version}</p>
        </div>
        <div className="admin-actions">
          <Button onClick={onEdit} disabled={busy} aria-haspopup="dialog">编辑配置</Button>
          <Button onClick={() => test.mutate()} loading={test.isPending} disabled={sync.isPending}>测试并预览</Button>
          <Button type="primary" onClick={() => start()} loading={sync.isPending} disabled={test.isPending || running}>启动同步</Button>
        </div>
      </header>
      <div className="admin-detail-body">
        <dl className="admin-kv">
          <div><dt>同步策略</dt><dd>{source.refreshMinutes ? '每 ' + source.refreshMinutes + ' 分钟' : '手动同步'}</dd></div>
          <div><dt>最近同步</dt><dd><SyncStatus status={source.lastSyncStatus} /></dd></div>
          <div><dt>最近成功</dt><dd><DisplayTime value={source.lastSuccessfulAt} /></dd></div>
          <div><dt>当前成功批次</dt><dd className="admin-break">{source.lastSuccessBatchId ?? '—'}</dd></div>
        </dl>

        <AdminError error={test.error} retry={() => test.mutate()} />
        {test.data && <Preview result={test.data} />}
        <AdminError error={sync.error} retry={sync.variables ? () => {
          if (sync.variables) sync.mutate(sync.variables)
        } : undefined} />
        {sync.data && <p className="admin-inline" role="status">
          <SyncStatus status={sync.data.status} /><span>{sync.data.message}</span>
        </p>}

        {dataset.data && <div className="admin-evidence" aria-label="当前数据集">
          <h3>当前数据集</h3>
          <p>{number.format(dataset.data.rowCount)} 行 · {dataset.data.measures.join('、')}</p>
          <Link to="/admin/metrics" className="admin-text-link">配置指标口径</Link>
        </div>}
        <AdminError error={dataset.error} retry={() => void dataset.refetch()} />

        <section aria-labelledby="run-history-heading" className="admin-history">
          <h3 id="run-history-heading">同步历史</h3>
          {runs.isPending && <p aria-busy="true"><Spin size="small" /> 正在查询记录</p>}
          <AdminError error={runs.error} retry={() => void runs.refetch()} />
          {runs.data?.length === 0 && <p className="admin-secondary">暂无同步记录。</p>}
          {!!runs.data?.length && (
            <div className="admin-table-scroll" role="region" aria-label="同步历史记录" tabIndex={0}>
              <table className="admin-table admin-compact">
                <thead><tr><th scope="col">开始时间</th><th scope="col">触发</th><th scope="col">状态</th><th scope="col">读取 / 接收 / 拒绝</th><th scope="col">结果</th><th scope="col">操作</th></tr></thead>
                <tbody>{runs.data.map(run => (
                  <tr key={run.id}>
                    <td><DisplayTime value={run.startedAt} /></td>
                    <td>{triggers[run.trigger]}</td><td><SyncStatus status={run.status} /></td>
                    <td className="admin-number">{number.format(run.rowsRead)} / {number.format(run.rowsAccepted)} / {number.format(run.rowsRejected)}</td>
                    <td className="admin-run-message">{run.message}{run.batchId && <small>批次 {run.batchId}</small>}</td>
                    <td>{(run.status === 'FAILED' || run.status === 'REJECTED') &&
                      <Button size="small" onClick={() => start(run.id)} disabled={busy || running}>重试此记录</Button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}

export function SourceDirectory() {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState('')
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(1)
  const [editor, setEditor] = useState<Source | 'new' | null>(null)
  const sources = useQuery({
    queryKey: adminQueryKeys.sources,
    queryFn: ({ signal }) => adminApi.sources(signal),
    refetchInterval: query => query.state.data?.some(source => source.lastSyncStatus === 'RUNNING') ? 2000 : false,
  })
  const selectedId = params.get('source')
  const selected = sources.data?.find(source => source.id === selectedId)
  const search = filter.trim().toLowerCase()
  const visible = (sources.data ?? []).filter(source =>
    (!kind || source.type === kind) && (!search || (source.name + ' ' + source.id).toLowerCase().includes(search)),
  )
  const { currentPage, pageCount, rows } = getAdminTablePage(visible, page)

  function choose(source: Source) {
    setParams({ source: source.id })
  }

  function saved(source: Source) {
    setEditor(null)
    queryClient.setQueryData<Source[]>(adminQueryKeys.sources, existing => {
      const current = existing ?? []
      return current.some(item => item.id === source.id)
        ? current.map(item => item.id === source.id ? source : item)
        : [...current, source]
    })
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.sources })
    choose(source)
  }

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div><h1>数据来源</h1><p>配置已批准的连接，预览标准化数据并执行同步。</p></div>
        <Button type="primary" icon={<AdminIcon name="add" />} onClick={() => setEditor('new')} aria-haspopup="dialog">新增来源</Button>
      </header>
      <section className="admin-list" aria-label="来源目录">
        <div className="admin-list-tools">
          <Input allowClear prefix={<AdminIcon name="search" />} value={filter} onChange={event => {
            setFilter(event.target.value)
            setPage(1)
          }}
            placeholder="搜索来源名称或编码" aria-label="搜索来源名称或编码" />
          <select aria-label="筛选接入方式" value={kind} onChange={event => {
            setKind(event.target.value)
            setPage(1)
          }}>
            <option value="">全部接入方式</option>
            {Object.entries(sourceTypes).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
          </select>
          {sources.data && <span className="admin-result-count" role="status">匹配 {visible.length} 个，共 {sources.data.length} 个</span>}
        </div>
        {sources.isPending && <p className="admin-list-message" aria-busy="true"><Spin size="small" /> 正在查询来源</p>}
        <AdminError error={sources.error} retry={() => void sources.refetch()} />
        {!sources.isPending && !sources.isError && visible.length === 0 && <p className="admin-list-message">
          {sources.data?.length ? '没有符合筛选条件的来源。' : '还没有数据来源。选择「新增来源」开始连接。'}
        </p>}
        {visible.length > 0 && (
          <div className="admin-table-scroll" role="region" aria-label="数据来源列表" tabIndex={0}>
            <table className="admin-table admin-directory-table">
              <thead><tr><th scope="col">来源</th><th scope="col">接入方式</th><th scope="col">最近同步</th><th scope="col">最近成功</th><th scope="col">操作</th></tr></thead>
              <tbody>{rows.map(source => (
                <tr key={source.id} data-active={source.id === selectedId}>
                  <th scope="row">
                    <div className="admin-table-name">
                      <span className="admin-row-mark" data-kind={source.type}><AdminIcon name={sourceIcons[source.type]} /></span>
                      <div><strong>{source.name}</strong><small className="admin-code">{source.id}</small></div>
                    </div>
                  </th>
                  <td>{sourceTypes[source.type]}</td>
                  <td><SyncStatus status={source.lastSyncStatus} /></td>
                  <td><DisplayTime value={source.lastSuccessfulAt} /></td>
                  <td><Button size="small" onClick={() => choose(source)} aria-label={'查看来源 ' + source.name}>查看</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <AdminTablePages pageCount={pageCount} current={currentPage} onChange={setPage} label="来源目录分页" />
      </section>
      {selected && <SourceDetail key={selected.id + ':' + selected.version} source={selected} onEdit={() => setEditor(selected)} />}
      {editor && <SourceEditor source={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={saved} />}
    </div>
  )
}
