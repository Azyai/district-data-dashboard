import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { dashboardApi } from '../../api/client'
import { screens, screenPath } from '../screens/screenCatalog'
import { answerFromSnapshot } from './answer'
import { queryHotlineAnswer } from './hotlineAnswer'
import { interpretScreenIntent } from './intent'
import { answerFromScreen } from './screenAnswer'
import { listenForCommands, wakeWord, type VoiceState } from './voiceSession'
import './voice-orb.css'

const size = 48
const gutter = 10
const storageKey = 'district.voice-orb.position.v1'
const clamp = (value: number, max: number) => Math.max(gutter, Math.min(value, max - size - gutter))
type Position = { x: number; y: number }

const monitorTerms = {
  overview: { 拥堵指数: /拥堵/, 平均车速: /车速|速度/, 监测流量: /流量|车流/, 畅通里程: /畅通|通畅|里程/ },
  grid: { 村居网格: /村居/, 微网格: /微网格/, 楼栋覆盖: /楼栋|建筑/, 运行指数: /运行指数/ },
  waters: { 监测水域: /多少(?:处|个)水域|水域有多少/, 监测流量: /流量/, 水库蓄水: /蓄水|库容/, 今日告警: /告警/ },
}
const spokenUnits: Readonly<Record<string, string>> = { 'km/h': '公里每小时', km: '公里', 'm³/s': '立方米每秒', '亿m³': '亿立方米' }

function readPosition(): Position | null {
  try {
    const saved: Position | null = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return saved
  } catch { /* Storage may be disabled for kiosk sessions. */ }
  return null
}

const hints = {
  off: '点击开启语音助手',
  connecting: '正在连接本机麦克风',
  standby: '说“' + wakeWord + '”唤醒',
  listening: '我在听，请说',
  thinking: '正在查询',
  speaking: '正在回答',
  error: '点击重试语音助手',
}

export default function VoiceOrb() {
  const navigate = useNavigate()
  const location = useLocation()
  const client = useQueryClient()
  const session = useRef<AbortController | null>(null)
  const [voice, setVoice] = useState<VoiceState>({ phase: 'off' })
  const [customPosition, setPosition] = useState(readPosition)
  const [viewport, setViewport] = useState(() => ({ width: innerWidth, height: innerHeight }))
  const onMap = /^\/(?:$|areas\/|screens\/(?:grid|waters)\/?$)/.test(location.pathname)
  const preferred = customPosition ?? {
    x: viewport.width - size - (onMap ? 81 : 19),
    y: viewport.height - size - (onMap ? 18 : 84),
  }
  const position = { x: clamp(preferred.x, viewport.width), y: clamp(preferred.y, viewport.height) }
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ id: number; x: number; y: number; start: Position } | null>(null)
  const moved = useRef(false)
  const lastMetric = useRef<{ context: string; id: string } | null>(null)
  const context = location.pathname + location.search
  const screen = screens.find(item => '/screens/' + item.id === location.pathname)?.id ?? 'overview'
  const params = new URLSearchParams(location.search)
  const currentArea = /^\/(?:data\/)?areas\/([a-z0-9-]+)\/?$/.exec(location.pathname)?.[1] ?? (params.get('area') || 'mentougou')

  async function respond(question: string, signal: AbortSignal): Promise<string> {
    const unchanged = () => {
      signal.throwIfAborted()
      return context === window.location.pathname + window.location.search
    }
    const locations = await client.fetchQuery({ queryKey: ['cockpit-locations'], staleTime: 300_000,
      queryFn: ({ signal }) => dashboardApi.locations(signal) })
    if (!unchanged()) return '页面已切换，请在当前区域重新提问。'
    const intent = interpretScreenIntent(question, currentArea, locations, screen)
    if (intent.kind === 'clarify') return intent.message
    if (intent.kind === 'home') {
      void navigate('/')
      return '已返回门头沟全域。'
    }
    if (intent.kind === 'screen' || intent.kind === 'navigate') {
      const next = intent.kind === 'screen' ? intent.screen : screen
      void navigate(screenPath(next, intent.areaId, screen === 'governance' ? params.get('month') : undefined))
      const name = locations.find(item => item.id === intent.areaId)?.name ?? '所选区域'
      return '已打开' + name + '的' + (screens.find(item => item.id === next)?.title ?? '区域页面') + '。'
    }
    if (intent.kind === 'hotline') {
      const reply = await queryHotlineAnswer(client, question, intent.areaId, signal, params.get('month') ?? undefined)
      return unchanged() ? reply.answer.text : '页面已切换，请在当前区域重新提问。'
    }
    const area = await client.fetchQuery({ queryKey: ['cockpit-area', intent.areaId], staleTime: 60_000,
      queryFn: ({ signal }) => dashboardApi.area(intent.areaId, signal) })
    if (!unchanged()) return '页面已切换，请在当前区域重新提问。'
    const topic = answerFromScreen(question, area, screen)
    if (topic) return topic.text
    if (screen === 'overview' || screen === 'grid' || screen === 'waters') {
      const { readMonitoring, monitoringSnapshot } = await import('../cockpit/monitoringData')
      const catalog = await client.fetchQuery({
        queryKey: ['monitoring-catalog'], staleTime: Infinity, queryFn: ({ signal }) => readMonitoring(signal),
      })
      if (!unchanged()) return '页面已切换，请在当前区域重新提问。'
      const period = document.querySelector<HTMLElement>('.monitoring-stage')?.dataset.hour
      const hour = period && /^\d{1,2}(?:\.5)?$/.test(period) ? Number(period) : undefined
      const monitor = monitoringSnapshot(catalog, screen === 'overview' ? 'roads' : screen, area, hour)
      const keys = Object.entries(monitorTerms[screen]).filter(([label, pattern]) => question.includes(label) || pattern.test(question))
        .map(([label]) => label)
      const matched = monitor.kpis.filter(item => keys.includes(item.label))
      const general = /概况|情况|概览|态势|分析|有哪些指标/.test(question)
      if (keys.length || general) {
        if (!monitor.kpis.length) return area.name + '当前缺少这个主题的监测样本。'
        const halfHour = hour ?? catalog.baseHour
        const periodName = screen === 'overview'
          ? Math.floor(halfHour) + '点' + (halfHour % 1 ? '半的' : '的') : '的'
        return area.name + periodName + '模拟监测数据，' + (matched.length ? matched : monitor.kpis)
          .map(item => item.label + '为' + item.value + (spokenUnits[item.unit] ?? item.unit)).join('，') + '。'
      }
    }
    if (intent.kind === 'problems') {
      const signals = area.signals.filter(item => item.status === 'attention')
      return signals.length ? area.name + '当前需要关注' + signals.length + '项。' +
        signals.slice(0, 3).map(item => item.title + '。' + item.detail).join('。') : area.name + '当前没有待关注的事项。'
    }
    const previous = lastMetric.current
    const scope = context + '/' + area.id
    const value = answerFromSnapshot(question, area, previous?.context === scope ? previous.id : undefined)
    lastMetric.current = value.metricId ? { context: scope, id: value.metricId } : null
    return value.text
  }

  const answer = useRef(respond)
  useLayoutEffect(() => { answer.current = respond })
  useEffect(() => {
    function resize() { setViewport({ width: innerWidth, height: innerHeight }) }
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); session.current?.abort() }
  }, [])

  function toggle() {
    const enabled = session.current && voice.phase !== 'error'
    session.current?.abort()
    session.current = null
    if (enabled) { setVoice({ phase: 'off' }); return }
    const controller = new AbortController()
    session.current = controller
    listenForCommands(controller.signal, (text, signal) => answer.current(text, signal), setVoice)
  }

  function move(x: number, y: number, save: boolean) {
    const next = { x: clamp(x, innerWidth), y: clamp(y, innerHeight) }
    setPosition(next)
    if (save) {
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* In-memory positioning still works. */ }
    }
  }
  const active = voice.phase !== 'off' && voice.phase !== 'error'
  const label = active ? '关闭语音助手' : '开启语音助手'
  return <div className="voice-orb" data-phase={voice.phase} data-dragging={dragging}
    data-side={position.x + size / 2 < innerWidth / 2 ? 'right' : 'left'}
    data-edge={position.y < innerHeight / 2 ? 'top' : 'bottom'}
    style={{ left: position.x, top: position.y }}>
    <button className="voice-orb-button" type="button" aria-label={label} aria-pressed={active}
      aria-describedby="voice-orb-state" title={label + ' · 唤醒词“' + wakeWord + '” · 拖动或用方向键移动'}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return
        moved.current = false
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: position }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        const start = drag.current
        if (!start || start.id !== event.pointerId) return
        const dx = event.clientX - start.x, dy = event.clientY - start.y
        if (!moved.current && Math.hypot(dx, dy) < 5) return
        moved.current = true
        setDragging(true)
        move(start.start.x + dx, start.start.y + dy, false)
      }}
      onPointerUp={event => {
        const start = drag.current
        if (!start || start.id !== event.pointerId) return
        if (moved.current) move(start.start.x + event.clientX - start.x, start.start.y + event.clientY - start.y, true)
        drag.current = null
        setDragging(false)
      }}
      onPointerCancel={() => { moved.current = true; drag.current = null; setDragging(false) }}
      onClick={event => {
        if (!moved.current || event.detail === 0) toggle()
        moved.current = false
      }}
      onKeyDown={event => {
        const delta: Record<string, Position> = { ArrowLeft: { x: -16, y: 0 }, ArrowRight: { x: 16, y: 0 },
          ArrowUp: { x: 0, y: -16 }, ArrowDown: { x: 0, y: 16 } }
        const step = delta[event.key]
        if (step) { event.preventDefault(); move(position.x + step.x, position.y + step.y, true) }
      }}>
      <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2">
        <path d="M6 14v4 M11 10v12 M16 6v20 M21 11v10 M26 14v4" />
      </svg>
    </button>
    <output className="voice-orb-state" id="voice-orb-state" aria-live="polite" data-show={Boolean(voice.message) || ['listening', 'connecting', 'thinking'].includes(voice.phase)}>
      {voice.message ?? hints[voice.phase]}
    </output>
  </div>
}
