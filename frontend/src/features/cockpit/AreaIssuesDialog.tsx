import { Button, Modal } from 'antd'
import { useRef } from 'react'
import type { CockpitArea } from '../../api/client'
import './area-issues.css'

type AreaIssuesDialogProps = {
  area: CockpitArea
  open: boolean
  onClose: () => void
  signalId?: string
}

type Metric = CockpitArea['metrics'][number]

const dateTime = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
})
const valueFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const deltaFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, signDisplay: 'exceptZero' })

function SnapshotTime({ value }: { value: string }) {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return <span>时间未记录</span>
  return <time dateTime={value} title="北京时间">{dateTime.format(timestamp)}</time>
}

function MetricReading({ metric }: { metric: Metric }) {
  const { delta, evidence, label, status, unit, value } = metric
  const hasValue = status !== 'NO_DATA' && value != null && Number.isFinite(value)
  const hasDelta = hasValue && delta != null && Number.isFinite(delta)
  const deltaUnit = unit === '%' || unit === '％' ? '个百分点' : unit
  return (
    <li className="area-issues-metric">
      <div className="area-issues-reading">
        <h3>{label}</h3>
        {hasValue ? (
          <p className="area-issues-value">{valueFormat.format(value)} <span>{unit}</span></p>
        ) : <p className="area-issues-no-data">暂无数据</p>}
      </div>
      {hasDelta && (
        <p className="area-issues-comparison">
          较上个观测日 {delta === 0 ? '持平' : deltaFormat.format(delta) + ' ' + deltaUnit}
        </p>
      )}
      {evidence && (
        <div className="area-issues-evidence">
          <dl>
            <div><dt>观测日</dt><dd>{evidence.observedOn ? <time dateTime={evidence.observedOn}>{evidence.observedOn}</time> : '暂无观测'}</dd></div>
            <div><dt>已发布来源</dt><dd>{evidence.sourceName} · v{evidence.version}</dd></div>
          </dl>
          {evidence.description && <p>{evidence.description}</p>}
        </div>
      )}
    </li>
  )
}

export function AreaIssuesDialog({ area, open, onClose, signalId }: AreaIssuesDialogProps) {
  const focusedSignal = useRef<HTMLLIElement>(null)
  const signals = area.signals.filter(signal => signal.status === 'attention')
    .sort((left, right) => Number(right.id === signalId) - Number(left.id === signalId))

  return (
    <Modal
      open={open}
      title={area.name + '问题诊断'}
      rootClassName="area-issues-dialog"
      width="min(59rem, calc(100vw - 1.5rem))"
      centered
      destroyOnHidden
      focusable={{ focusTriggerAfterClose: true }}
      onCancel={onClose}
      afterOpenChange={visible => {
        const target = focusedSignal.current
        if (visible && target) {
          target.focus({ preventScroll: true })
          target.scrollIntoView({ block: 'nearest' })
        }
      }}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <p className="area-issues-snapshot">
        <span>模拟数据</span><span>快照更新 <SnapshotTime value={area.updatedAt} /></span>
      </p>
      <div className="area-issues-grid">
        <section aria-label="运行事项">
          <div className="area-issues-section-title">
            <h2>运行事项</h2>
            {signals.length > 0 && <span className="area-issues-attention">{signals.length} 项待关注</span>}
          </div>
          {signals.length ? (
            <ol className="area-issues-list">
              {signals.map(signal => (
                <li
                  className="area-issues-signal"
                  key={signal.id}
                  ref={signal.id === signalId ? focusedSignal : undefined}
                  tabIndex={signal.id === signalId ? -1 : undefined}
                  data-selected={signal.id === signalId}
                >
                  <div className="area-issues-signal-meta">
                    <SnapshotTime value={signal.time} />
                  </div>
                  <h3>{signal.title.replace(/^模拟\s*·\s*/, '')}</h3>
                  <p>{signal.detail}</p>
                </li>
              ))}
            </ol>
          ) : <p className="area-issues-empty">当前快照暂无待关注事项。</p>}
        </section>
        <section aria-label="指标与依据">
          <div className="area-issues-section-title"><h2>指标与依据</h2></div>
          {area.metrics.length ? (
            <ul className="area-issues-list">{area.metrics.map(metric => <MetricReading metric={metric} key={metric.id} />)}</ul>
          ) : <p className="area-issues-empty">当前区域暂无指标。</p>}
        </section>
      </div>
    </Modal>
  )
}

export default AreaIssuesDialog
