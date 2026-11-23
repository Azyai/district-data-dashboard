import { Button } from 'antd'
import { cloneElement, useId } from 'react'
import type { ReactElement } from 'react'
import { ApiError } from '../../api/client'

const time = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai',
})

export const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 })

const tablePageSize = 25

export function getAdminTablePage<Row>(rows: Row[], page: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / tablePageSize))
  const currentPage = Math.min(page, pageCount)
  const start = (currentPage - 1) * tablePageSize
  return { currentPage, pageCount, rows: rows.slice(start, start + tablePageSize) }
}

export function AdminTablePages({ pageCount, current, onChange, label }: {
  pageCount: number
  current: number
  onChange: (page: number) => void
  label: string
}) {
  if (pageCount <= 1) return null
  return (
    <nav className="admin-table-pages" aria-label={label}>
      <Button size="small" disabled={current <= 1} onClick={() => onChange(current - 1)}>上一页</Button>
      <span className="admin-secondary" role="status">第 {current} / {pageCount} 页</span>
      <Button size="small" disabled={current >= pageCount} onClick={() => onChange(current + 1)}>下一页</Button>
    </nav>
  )
}

export function DisplayTime({ value }: { value?: string | null }) {
  if (!value) return <span className="admin-secondary">—</span>
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return <span className="admin-secondary">—</span>
  return <time className="admin-number" dateTime={value} title={value}>{time.format(date)}</time>
}

export function AdminError({ error, retry }: { error: Error | null; retry?: () => void }) {
  if (!error) return null
  return (
    <div role="alert" className="admin-error">
      <span>{error.message}</span>
      {error instanceof ApiError && error.requestId && <small>请求编号 {error.requestId}</small>}
      {retry && <Button size="small" onClick={retry}>重试</Button>}
    </div>
  )
}

export function Field({ label, children, help }: {
  label: string
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>
  help?: string
}) {
  const id = useId()
  const controlId = children.props.id ?? id
  const describedBy = help ? id + '-help' : children.props['aria-describedby']
  return (
    <div className="admin-field">
      <label htmlFor={controlId}>{label}</label>
      {cloneElement(children, { id: controlId, 'aria-describedby': describedBy })}
      {help && <small id={describedBy}>{help}</small>}
    </div>
  )
}
