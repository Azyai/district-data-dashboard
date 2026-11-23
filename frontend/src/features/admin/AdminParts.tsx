import { Button } from 'antd'
import { cloneElement, useId } from 'react'
import type { ReactElement } from 'react'
import { ApiError } from '../../api/client'

const time = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai',
})

export const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 })

const tablePageSize = 25

const iconPaths = {
  home: 'M3 10h14m-8-6-6 6 6 6',
  source: 'M16 6c0 1.7-2.7 3-6 3s-6-1.3-6-3 2.7-3 6-3 6 1.3 6 3ZM4 6v8c0 1.7 2.7 3 6 3s6-1.3 6-3V6M4 10c0 1.7 2.7 3 6 3s6-1.3 6-3',
  chart: 'M3 3v14h14M7 13V9m4 4V6m4 7v-3',
  search: 'M12.5 12.5 17 17m-8.7-3.6a5.1 5.1 0 1 0 0-10.2 5.1 5.1 0 0 0 0 10.2Z',
  add: 'M10 4v12M4 10h12',
  link: 'm8 7 2.5-2.5a3.5 3.5 0 0 1 5 5L13 12m-1-6 1 1M7 8l-2.5 2.5a3.5 3.5 0 0 0 5 5L12 13m-4-1 4-4',
  file: 'M5 3h7l3 3v11H5zM12 3v4h3M8 10h4m-4 3h4',
  shield: 'M10 2.8 16 5v4.4c0 3.5-2.4 6.3-6 7.8-3.6-1.5-6-4.3-6-7.8V5zM7.6 10l1.6 1.6 3.3-3.3',
  settings: 'M4 5h12M4 10h12M4 15h12M8 3v4m4 1v4m-4 1v4',
} as const

export function AdminIcon({ name }: { name: keyof typeof iconPaths }) {
  return <svg className="admin-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.55"
    strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true"><path d={iconPaths[name]} /></svg>
}

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
