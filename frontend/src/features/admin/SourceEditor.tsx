import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, Drawer, Input, Spin } from 'antd'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { adminApi, adminQueryKeys } from './adminApi'
import type { Source, SourceInput } from './adminApi'
import { AdminError, AdminIcon, Field, number } from './AdminParts'

export const sourceTypes = {
  HTTPS_JSON: 'HTTPS JSON',
  MYSQL_VIEW: 'MySQL 只读视图',
  CSV: 'CSV 文件',
} as const

const defaultMapping = {
  region: 'region',
  date: 'date',
  measure: 'measure',
  value: 'value',
}

const mappingFields = [
  ['region', '区域字段'],
  ['date', '日期字段'],
  ['measure', '度量字段'],
  ['value', '数值字段'],
  ['denominator', '分母字段（可选）'],
] as const

function initialDraft(source?: Source): SourceInput {
  return source ? {
    id: source.id,
    name: source.name,
    type: source.type,
    config: source.config,
    mapping: source.mapping,
    refreshMinutes: source.refreshMinutes,
  } : { id: '', name: '', type: 'HTTPS_JSON', config: {}, mapping: defaultMapping, refreshMinutes: 0 }
}

export function SourceEditor({ source, onClose, onSaved }: {
  source?: Source
  onClose: () => void
  onSaved: (source: Source) => void
}) {
  const [draft, setDraft] = useState(() => initialDraft(source))
  const [file, setFile] = useState<File | null>(null)
  const [assetName, setAssetName] = useState<string | null>(null)
  const formId = useId()
  const fileId = useId()
  const title = source ? '编辑来源' : '新增来源'
  const options = useQuery({
    queryKey: adminQueryKeys.options,
    queryFn: ({ signal }) => adminApi.sourceOptions(signal),
    enabled: draft.type !== 'CSV',
  })
  const save = useMutation({
    mutationFn: (body: SourceInput) => source ? adminApi.updateSource(body, source.version) : adminApi.createSource(body),
    onSuccess: onSaved,
  })
  const upload = useMutation({
    mutationFn: adminApi.uploadCsv,
    onSuccess: asset => {
      setDraft(draft => ({ ...draft, config: { assetRef: asset.id } }))
      setAssetName(asset.fileName)
      setFile(null)
    },
  })

  const { type, config, mapping } = draft
  const connection = options.data?.mysqlConnections.find(item => item.id === config.connectionRef)
  const busy = save.isPending || upload.isPending
  const incomplete = type === 'CSV'
    ? !config.assetRef
    : type === 'HTTPS_JSON'
      ? !options.data?.httpsEndpoints.some(item => item.endpoint === config.endpoint)
      : !connection?.views.some(view => view.id === config.viewRef)

  function patch<K extends keyof SourceInput>(key: K, value: SourceInput[K]) {
    setDraft(draft => ({ ...draft, [key]: value }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || incomplete) return
    save.mutate({
      ...draft,
      id: draft.id.trim(),
      name: draft.name.trim(),
      mapping: {
        region: mapping.region.trim(),
        date: mapping.date.trim(),
        measure: mapping.measure.trim(),
        value: mapping.value.trim(),
        denominator: mapping.denominator?.trim() || undefined,
      },
    })
  }

  return (
    <Drawer open title={<span className="admin-overlay-title"><AdminIcon name="source" />{title}</span>}
      size="min(100vw, 40rem)" rootClassName="admin-drawer" keyboard={!busy}
      mask={{ closable: !busy }} onClose={() => { if (!busy) onClose() }}
      footer={
        <>
          <AdminError error={save.error} />
          <div className="admin-form-actions">
            <Button disabled={busy} onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" form={formId} disabled={incomplete || upload.isPending} loading={save.isPending}>
              保存来源
            </Button>
          </div>
        </>
      }>
      <form className="admin-form" id={formId} onSubmit={submit}>
        <fieldset disabled={save.isPending}>
          <legend><span><AdminIcon name="file" />来源标识</span></legend>
          <div className="admin-form-row">
            <Field label="来源名称"><Input value={draft.name} placeholder="例如：空气质量监测" onChange={event => patch('name', event.target.value)} maxLength={100} required /></Field>
            <Field label="来源编码" help="小写字母开头。可含小写字母、数字和短横线。">
              <Input value={draft.id} className="admin-code-input" placeholder="air-observations" onChange={event => patch('id', event.target.value)} readOnly={Boolean(source)} pattern="[a-z][a-z0-9\-]{0,63}" maxLength={64} required />
            </Field>
          </div>
        </fieldset>

        <fieldset disabled={save.isPending}>
          <legend><span><AdminIcon name="link" />连接配置</span></legend>
          <Field label="接入方式">
            <select value={type} disabled={upload.isPending} onChange={event => {
              const value = event.target.value as SourceInput['type']
              setDraft(draft => ({ ...draft, type: value, config: {} }))
              setFile(null)
              setAssetName(null)
              upload.reset()
            }}>
              {Object.entries(sourceTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          {type === 'HTTPS_JSON' && (
            <Field label="已批准接口">
              <select value={config.endpoint ?? ''} required onChange={event => patch('config', { endpoint: event.target.value })}>
                <option value="">选择接口</option>
                {options.data?.httpsEndpoints.map(item => <option value={item.endpoint} key={item.endpoint}>{item.label}</option>)}
              </select>
            </Field>
          )}
          {type === 'MYSQL_VIEW' && (
            <div className="admin-form-row">
              <Field label="只读连接">
                <select value={config.connectionRef ?? ''} required onChange={event => patch('config', { connectionRef: event.target.value })}>
                  <option value="">选择连接</option>
                  {options.data?.mysqlConnections.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="批准视图">
                <select value={config.viewRef ?? ''} required disabled={!connection}
                  onChange={event => patch('config', { ...config, viewRef: event.target.value })}>
                  <option value="">选择视图</option>
                  {connection?.views.map(view => <option value={view.id} key={view.id}>{view.label}</option>)}
                </select>
              </Field>
            </div>
          )}
          {type === 'CSV' ? (
            <>
              <div className="admin-field">
                <label htmlFor={fileId}>CSV 文件</label>
                <div className="admin-upload">
                  <div className="admin-file-choice">
                    <AdminIcon name="file" />
                    <span className="admin-break">{file?.name ?? '选择 CSV 文件'}</span>
                    <input id={fileId} key={config.assetRef ?? 'file'} type="file" accept=".csv,text/csv"
                      aria-describedby={fileId + '-help'} disabled={upload.isPending} onChange={event => {
                        setFile(event.target.files?.[0] ?? null)
                        upload.reset()
                      }} />
                  </div>
                  <Button loading={upload.isPending} disabled={!file} onClick={() => { if (file) upload.mutate(file) }}>上传文件</Button>
                </div>
                <small id={fileId + '-help'}>使用 UTF-8 编码，第一行为字段名。最大 2 MB。</small>
                {config.assetRef && <span className="admin-success" role="status">
                  已关联 {assetName ?? config.assetRef}{upload.data && ' · ' + number.format(upload.data.sizeBytes) + ' 字节'}
                </span>}
              </div>
              <AdminError error={upload.error} />
            </>
          ) : (
            <>
              {options.isPending && <Spin size="small" />}
              {options.data && type === 'HTTPS_JSON' && options.data.httpsEndpoints.length === 0 &&
                <p className="admin-secondary">当前环境暂无已批准的 HTTPS 接口。</p>}
              {options.data && type === 'MYSQL_VIEW' && options.data.mysqlConnections.length === 0 &&
                <p className="admin-secondary">当前环境暂无已登记的 MySQL 只读连接。</p>}
              <AdminError error={options.error} retry={() => void options.refetch()} />
            </>
          )}
        </fieldset>

        <fieldset disabled={save.isPending}>
          <legend><span><AdminIcon name="settings" />字段映射与同步</span></legend>
          <div className="admin-form-row">
            {mappingFields.map(([key, label]) => (
              <Field key={key} label={label}>
                <Input className="admin-code-input" value={mapping[key] ?? ''} onChange={event => patch('mapping', { ...mapping, [key]: event.target.value })}
                  required={key !== 'denominator'} />
              </Field>
            ))}
            <Field label="自动同步间隔（分钟）" help="填 0 仅手动同步。最大 1440 分钟。">
              <Input type="number" value={draft.refreshMinutes} min={0} max={1440} step={1} required
                onChange={event => patch('refreshMinutes', Number(event.target.value))} />
            </Field>
          </div>
        </fieldset>
      </form>
    </Drawer>
  )
}
