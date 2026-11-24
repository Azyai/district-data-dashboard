import { useLayoutEffect, useRef } from 'react'
import type { Manifest } from '../../api/client'
import './topic-network.css'

type TopicMode = 'radial' | 'branch' | 'split'
type CanvasSize = Manifest['canvas']
type ScreenComponent = Manifest['components'][number]
type Geometry = ScreenComponent['geometry']
type Point = { x: number; y: number }

const colors = {
  radial: ['#69dfff', '#a987ff'],
  branch: ['#4fc0ff', '#be90ff'],
  split: ['#5ac4f1', '#73e6dd'],
} satisfies Record<TopicMode, [string, string]>

export function topicModeFor(theme: string): TopicMode | undefined {
  if (theme === 'population') return 'radial'
  if (theme === 'hotline') return 'branch'
  if (theme === 'water') return 'split'
}

function isRadial(component: ScreenComponent) {
  return component.chartStyle === 'network' || component.chartStyle === 'radar'
}

function topicFocus(components: ScreenComponent[]) {
  return components.reduce<ScreenComponent | undefined>((best, component) => {
    if (component.type === 'kpi') return best
    if (!best || (!isRadial(best) && isRadial(component))) return component
    if (isRadial(best) !== isRadial(component)) return best
    const { width, height } = component.geometry
    return width * height > best.geometry.width * best.geometry.height ? component : best
  }, undefined)
}

export function topicFocusId(components: ScreenComponent[]) {
  return topicFocus(components)?.id
}

function center({ x, y, width, height }: Geometry): Point {
  return { x: x + width / 2, y: y + height / 2 }
}

function dock(box: Geometry, target: Point, mode: TopicMode): Point | undefined {
  const middle = center(box)
  const dx = target.x - middle.x
  const dy = target.y - middle.y
  const reach = Math.max(Math.abs(dx) / (box.width / 2), Math.abs(dy) / (box.height / 2))
  if (reach < 1) return undefined
  if (mode !== 'radial' && Math.abs(dx) > box.width / 2) {
    return { x: middle.x + Math.sign(dx) * box.width / 2, y: middle.y }
  }
  return { x: middle.x + dx / reach, y: middle.y + dy / reach }
}

function trace(context: CanvasRenderingContext2D, start: Point, end: Point, mode: TopicMode, spread: number) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const distance = Math.hypot(dx, dy)
  const normal = { x: -dy / distance, y: dx / distance }
  context.beginPath()
  context.moveTo(start.x, start.y)
  if (mode === 'radial') {
    context.bezierCurveTo(
      start.x + dx * .32 + normal.x * spread, start.y + dy * .32 + normal.y * spread,
      start.x + dx * .77 + normal.x * spread, start.y + dy * .77 + normal.y * spread,
      end.x, end.y,
    )
  } else {
    context.bezierCurveTo(
      start.x + dx * .60 + normal.x * spread, start.y + normal.y * spread,
      end.x - dx * .36 + normal.x * spread, end.y + normal.y * spread,
      end.x, end.y,
    )
  }
  context.stroke()
}

function halo(context: CanvasRenderingContext2D, point: Point, radius: number, tone: string, opacity: string) {
  const glow = context.createRadialGradient(point.x, point.y, 1, point.x, point.y, radius)
  glow.addColorStop(0, tone + opacity)
  glow.addColorStop(1, tone + '00')
  context.fillStyle = glow
  context.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2)
}

function draw(context: CanvasRenderingContext2D, mode: TopicMode, focus: ScreenComponent, components: ScreenComponent[]) {
  const [blue, violet] = colors[mode]
  const hub = center(focus.geometry)
  const radius = Math.min(focus.geometry.width, focus.geometry.height) * .23
  const bloom = Math.max(54, radius * 1.8)
  halo(context, { x: hub.x - radius * .6, y: hub.y }, bloom, blue, '22')
  halo(context, { x: hub.x + radius * .6, y: hub.y }, bloom, violet, '24')

  for (const component of components) {
    if (component.id === focus.id) continue
    const end = dock(component.geometry, hub, mode)
    if (!end) continue
    const dx = end.x - hub.x
    const dy = end.y - hub.y
    const distance = Math.hypot(dx, dy)
    if (distance < 30) continue
    const inset = Math.min(radius, distance * .32)
    const start = { x: hub.x + dx / distance * inset, y: hub.y + dy / distance * inset }
    const tone = end.x < hub.x ? blue : violet
    const fiber = context.createLinearGradient(start.x, start.y, end.x, end.y)
    fiber.addColorStop(0, tone + '00')
    fiber.addColorStop(.3, tone + 'B2')
    fiber.addColorStop(.75, tone + 'DD')
    fiber.addColorStop(1, tone + 'F2')
    context.strokeStyle = fiber
    context.globalAlpha = .22
    context.lineWidth = 1.2
    for (const spread of [-38, -26, -14, 14, 26, 38]) trace(context, start, end, mode, spread)
    context.globalAlpha = 1
    context.lineWidth = 1.9
    trace(context, start, end, mode, mode === 'radial' ? 12 : 0)
    halo(context, end, 22, tone, 'A0')
    context.fillStyle = tone
    context.beginPath()
    context.arc(end.x, end.y, 3.7, 0, Math.PI * 2)
    context.fill()
  }
}

export function TopicNetwork({ theme, size, components }: {
  theme: string
  size: CanvasSize
  components: ScreenComponent[]
}) {
  const host = useRef<HTMLCanvasElement>(null)
  const mode = topicModeFor(theme)
  const focus = mode ? topicFocus(components) : undefined
  const resolution = Math.min(1, 2200 / Math.max(size.width, size.height))

  useLayoutEffect(() => {
    const canvas = host.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !mode || !focus) return
    context.setTransform(canvas.width / size.width, 0, 0, canvas.height / size.height, 0, 0)
    context.clearRect(0, 0, size.width, size.height)
    draw(context, mode, focus, components)
  }, [components, focus, mode, size.height, size.width])

  return mode && focus ? (
    <canvas className="topic-network" ref={host} aria-hidden="true"
      width={Math.max(1, Math.round(size.width * resolution))} height={Math.max(1, Math.round(size.height * resolution))} />
  ) : null
}
