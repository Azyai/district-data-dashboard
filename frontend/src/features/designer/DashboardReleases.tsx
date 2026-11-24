import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Button, Empty, Input, List, Modal, Space, Spin, Tag } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { request, writeRequest } from '../../api/client'
import type { components } from '../../api/generated/openapi'
import { ScreenCanvas } from '../playback/ScreenCanvas'
import { previewDraft } from './draftLayout'
import type { DraftWorkspace } from './designerApi'

type Workspace = components['schemas']['DashboardReleaseWorkspace']
type Review = components['schemas']['DashboardReleaseReview']

const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Shanghai' })
const statuses = { PENDING: '待审核', APPROVED: '已通过', RETURNED: '已退回' }
const projects = [{ value: 'city-operations', label: '城市运行' }, { value: 'public-services', label: '政务服务' }]

function releasePath(projectId: string, reviewer: boolean) {
  const project = encodeURIComponent(projectId)
  return reviewer ? '/api/v1/dashboard-reviews/' + project : '/api/v1/admin/dashboards/' + project + '/releases'
}

function History({ workspace, action }: { workspace: Workspace; action?: (row: Workspace['releases'][number]) => ReactNode }) {
  return <List size="small" dataSource={workspace.releases} locale={{ emptyText: '暂无提交记录' }} renderItem={row => (
    <List.Item extra={action?.(row)}>
      <List.Item.Meta title={<Space wrap><span>草稿 v{row.revision}</span>
        <Tag color={row.status === 'PENDING' ? 'processing' : row.status === 'APPROVED' ? 'success' : 'warning'}>
          {workspace.activeRevision === row.revision ? '播放中' : statuses[row.status]}
        </Tag></Space>}
        description={date.format(new Date(row.submittedAt)) + (row.reviewNote ? ' · ' + row.reviewNote : '')} />
    </List.Item>
  )} />
}

export default function DashboardReleases({ projectId, revision, disabled }: {
  projectId: string; revision: number; disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const path = releasePath(projectId, false)
  const state = useQuery({ queryKey: ['draft-release', projectId], enabled: open, refetchOnMount: 'always',
    queryFn: ({ signal }) => request<Workspace>(path, { signal }) })
  const submit = useMutation({ mutationFn: () => writeRequest<Workspace>(path, 'POST', { body: { revision } }),
    onSuccess: () => { void state.refetch() } })
  const error = submit.error ?? state.error
  const queued = state.data?.releases.some(row => row.status === 'PENDING' || row.revision === revision)

  return <>
    <Button onClick={() => { submit.reset(); setOpen(true); void state.refetch() }}>发布管理</Button>
    <Modal open={open} onCancel={() => setOpen(false)} title="发布管理" footer={null} destroyOnHidden>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Space wrap>
          <Tag>{state.data?.activeRevision ? '播放中 v' + state.data.activeRevision : '系统默认版'}</Tag>
          <Button type="primary" loading={submit.isPending} disabled={!state.data || disabled || revision === 0 || queued}
            onClick={() => submit.mutate()}>提交保存版本审核</Button>
        </Space>
        {disabled || revision === 0 ? <span>保存画布后可提交审核。</span> : null}
        {error && <Alert type="error" title={error.message} />}
        {state.data ? <History workspace={state.data} /> : state.isPending && <Spin />}
      </Space>
    </Modal>
  </>
}

export function DashboardReviewPage({ identityControl }: { identityControl: ReactNode }) {
  const [projectId, setProjectId] = useState(projects[0].value)
  const [revision, setRevision] = useState<number>()
  const [note, setNote] = useState('')
  const path = releasePath(projectId, true)
  const state = useQuery({ queryKey: ['review-release', projectId],
    queryFn: ({ signal }) => request<Workspace>(path, { signal }) })
  const snapshot = useQuery({ queryKey: ['review-snapshot', projectId, revision], enabled: revision !== undefined && revision > 0,
    queryFn: ({ signal }) => request<DraftWorkspace>(path + '/' + revision, { signal }) })
  const decision = useMutation({ mutationFn: (body: Review) => writeRequest<Workspace>(path, 'POST', { body }),
    onSuccess: () => { setNote(''); setRevision(undefined); void state.refetch() },
    onError: () => { void state.refetch() } })
  const current = state.data?.releases.find(row => row.revision === revision)
  const preview = snapshot.data && previewDraft(snapshot.data.template, snapshot.data.snapshot, snapshot.data.components)
  const error = decision.error ?? snapshot.error ?? state.error

  function choose(next: number) {
    decision.reset()
    setNote('')
    setRevision(next)
  }

  function review(next: Review['decision'], target: number) {
    if (state.data) decision.mutate({ revision: target, decision: next, serial: state.data.serial, note: note.trim() })
  }

  return <main className="playback-shell" data-theme="city" aria-labelledby="review-title">
    <header className="playback-bar">
      <Link to="/" className="playback-back"><i aria-hidden="true" />返回驾驶舱</Link>
      {identityControl}
    </header>
    <section className="playback-heading">
      <h1 id="review-title">大屏发布审核</h1>
      <Space wrap>
        <select className="playback-select" aria-label="选择审核专题" value={projectId} disabled={decision.isPending}
          onChange={event => {
            setProjectId(event.currentTarget.value)
            setRevision(undefined)
            setNote('')
            decision.reset()
          }}>
          {projects.map(project => <option key={project.value} value={project.value}>{project.label}</option>)}
        </select>
        {state.data?.activeRevision && <Button onClick={() => choose(0)}>恢复系统默认版</Button>}
      </Space>
    </section>
    {error && <Alert type="error" title={error.message} />}
    {state.data ? <History workspace={state.data} action={row => (
      <Button size="small" disabled={decision.isPending} onClick={() => choose(row.revision)}>预览 v{row.revision}</Button>
    )} /> : state.isPending && <Spin />}
    {!state.data?.releases.length && !state.isPending && !state.error && <Empty description="暂无可审核版本" />}
    <Modal open={revision !== undefined} destroyOnHidden footer={null}
      title={revision === 0 ? '恢复系统默认版' : '送审画布 v' + revision}
      width="min(64rem, calc(100vw - 2rem))" mask={{ closable: !decision.isPending }}
      keyboard={!decision.isPending} closable={!decision.isPending} onCancel={() => setRevision(undefined)}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        {error && <Alert type="error" title={error.message} />}
        {preview ? <ScreenCanvas {...preview} /> : revision !== 0 && snapshot.isPending && <Spin />}
        {(revision === 0 || current?.status === 'PENDING' || (current?.status === 'APPROVED' && state.data?.activeRevision !== current.revision)) && <>
          <Input.TextArea aria-label="审批意见" placeholder="退回或回滚时填写原因" value={note} maxLength={200}
            rows={2} onChange={event => setNote(event.target.value)} />
          <Space wrap>
            {current?.status === 'PENDING' && preview && <>
              <Button type="primary" disabled={decision.isPending} onClick={() => review('APPROVE', current.revision)}>通过并发布</Button>
              <Button disabled={decision.isPending || !note.trim()} onClick={() => review('RETURN', current.revision)}>退回草稿</Button>
            </>}
            {current?.status === 'APPROVED' && preview && state.data?.activeRevision !== current.revision &&
              <Button disabled={decision.isPending || !note.trim()} onClick={() => review('ROLLBACK', current.revision)}>回滚到 v{current.revision}</Button>}
            {revision === 0 && <Button type="primary" disabled={decision.isPending || !note.trim()}
              onClick={() => review('ROLLBACK', 0)}>确认恢复默认版</Button>}
          </Space>
        </>}
      </Space>
    </Modal>
  </main>
}
