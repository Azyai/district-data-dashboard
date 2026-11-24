import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import './map-globe-control.css'

type View = '2d' | '3d'
type Position = { x: number; y: number }
type Drag = { id: number; start: Position; origin: Position; moved: boolean }
type Props = { view: View; onViewChange: (view: View) => void; onReset: () => void }

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const directions: Record<string, Position> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
}

export default function MapGlobeControl({ view, onViewChange, onReset }: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const drag = useRef<Drag | undefined>(undefined)
  const ignoreClick = useRef(false)
  const [position, setPosition] = useState<Position>({ x: 1, y: 1 })
  const [open, setOpen] = useState(false)
  const id = useId()

  useEffect(() => {
    if (!open) return
    function dismiss(event: globalThis.PointerEvent | FocusEvent) {
      if (!frame.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('focusin', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('focusin', dismiss)
    }
  }, [open])

  function move(origin: Position, dx: number, dy: number) {
    const bounds = frame.current?.getBoundingClientRect()
    if (!bounds?.width || !bounds.height) return
    setPosition({ x: clamp(origin.x + dx / bounds.width), y: clamp(origin.y + dy / bounds.height) })
  }

  function begin(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return
    event.stopPropagation()
    ignoreClick.current = false
    drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: position, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function track(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (active?.id !== event.pointerId) return
    const dx = event.clientX - active.start.x
    const dy = event.clientY - active.start.y
    if (!active.moved && Math.hypot(dx, dy) < 5) return
    active.moved = true
    ignoreClick.current = true
    setOpen(false)
    move(active.origin, dx, dy)
  }

  function keyMove(event: KeyboardEvent<HTMLButtonElement>) {
    const step = directions[event.key]
    if (!step) return
    event.preventDefault()
    event.stopPropagation()
    move(position, step.x * 24, step.y * 24)
  }

  function close() {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }

  const offsets = { '--globe-x': position.x * 100 + '%', '--globe-y': position.y * 100 + '%' } as CSSProperties
  return (
    <div className="map-globe-dock" ref={frame} style={offsets} onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.stopPropagation(); close() }
    }}>
      <button ref={trigger} type="button" className="map-globe-trigger" aria-label="地图工具"
        aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={id + '-help'}
        title="地图工具 · 可拖动" onPointerDown={begin} onPointerMove={track}
        onLostPointerCapture={() => { drag.current = undefined }}
        onKeyDown={keyMove}
        onClick={event => {
          if (event.detail === 0 || !ignoreClick.current) setOpen(current => !current)
          ignoreClick.current = false
        }}>
        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.45" aria-hidden="true">
          <g transform="rotate(-19 16 16)">
            <circle cx="16" cy="16" r="11.4" />
            <ellipse cx="16" cy="16" rx="5.1" ry="11.4" />
            <path d="M4.6 16h22.8M6.7 9.4q9.3 4.2 18.6 0M6.7 22.6q9.3-4.2 18.6 0" />
          </g>
        </svg>
      </button>
      <span className="map-globe-sr" id={id + '-help'}>点击打开工具，拖动或使用方向键移动按钮。</span>
      {open && (
        <div className="map-globe-panel" id={id} role="group" aria-label="地图视角"
          data-below={position.y < .5} data-align-end={position.x >= .5}>
          <div className="map-globe-modes">
            {(['2d', '3d'] as const).map(mode => (
              <button key={mode} type="button" aria-pressed={view === mode}
                onClick={() => { onViewChange(mode); close() }}>{mode.toUpperCase()}</button>
            ))}
          </div>
          <button type="button" className="map-globe-reset" onClick={() => { onReset(); close() }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.55" aria-hidden="true">
              <circle cx="10" cy="10" r="5.4" /><path d="M10 2v4m0 8v4M2 10h4m8 0h4" />
            </svg>
            复位视角
          </button>
        </div>
      )}
    </div>
  )
}
