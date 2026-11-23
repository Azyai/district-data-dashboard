import { Button } from 'antd'
import { Link } from 'react-router'
import { ApiError } from '../api/client'

export function Problem({ title, error, onRetry, returnToCockpit = false }: {
  title: string
  error: Error
  onRetry?: () => void
  returnToCockpit?: boolean
}) {
  const requestId = error instanceof ApiError ? error.requestId : null
  return (
    <section className="center-state" role="alert">
      <h1>{title}</h1>
      <p>{error.message}</p>
      {requestId && <small className="muted">请求编号 {requestId}</small>}
      <div className="state-actions">
        {onRetry && <Button onClick={onRetry}>重试</Button>}
        {returnToCockpit && <Link to="/" className="action-link">返回驾驶舱</Link>}
      </div>
    </section>
  )
}
