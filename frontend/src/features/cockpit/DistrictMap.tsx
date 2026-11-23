import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import './district-map.css'

type Position = readonly [number, number]
type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString' | 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }
type Feature = {
  geometry: Geometry | null
  properties?: { kind?: string; id?: string; name?: string; highway?: string; ref?: string }
}
type Town = { id: string; name: string }
type Place = { id?: string; name: string; point: Position }
type MapLabel = { name: string; point: Position; length: number; water: boolean }
type MapModel = {
  outline: Path2D
  roads: Path2D[]
  rivers: Path2D
  land: Path2D
  water: Path2D
  width: number
  height: number
  longitudeScale: number
  center: Position
  hasRoads: boolean
  hasWater: boolean
  places: Place[]
  labels: MapLabel[]
}
type Frame = { left: number; top: number; width: number; height: number }
type Surface = { width: number; height: number; frame: Frame }
type View = { scale: number; x: number; y: number }
type Camera = { zoom: number; panX: number; panY: number }
type Drag = { pointerId: number; x: number; y: number; panX: number; panY: number }
type Pin = Town & { point: Position }
type LabelSide = 'east' | 'west' | 'north' | 'south'

const initialCamera: Camera = { zoom: 0, panX: 0, panY: 0 }
const zoomLevels = [1, 1.4, 1.95, 2.65]
const assetUrl = import.meta.env.BASE_URL + 'maps/mentougou.geojson'
const copyrightUrl = 'https://www.openstreetmap.org/copyright'

function polygonRings(geometry: Geometry | null): Position[][] {
  if (geometry?.type === 'Polygon') return geometry.coordinates
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flat()
  return []
}

function lineStrings(geometry: Geometry | null): Position[][] {
  if (geometry?.type === 'MultiLineString') return geometry.coordinates
  if (geometry?.type === 'LineString') return [geometry.coordinates]
  return []
}

function addPath(path: Path2D, coordinates: Position[], project: (point: Position) => Position, closed = false) {
  const start = coordinates[0]
  if (!start) return
  path.moveTo(...project(start))
  for (const point of coordinates.slice(1)) path.lineTo(...project(point))
  if (closed) path.closePath()
}

function toRelative(point: Position, center: Position, longitudeScale: number): Position {
  return [(point[0] - center[0]) * longitudeScale, center[1] - point[1]]
}

function saveLineLabel(labels: Map<string, MapLabel>, coordinateList: Position[], name: string | undefined,
  project: (point: Position) => Position, water = false) {
  if (!name || coordinateList.length < 2) return
  const points = coordinateList.map(project)
  const lengths = points.slice(1).map(([x, y], index) => Math.hypot(x - points[index][0], y - points[index][1]))
  const length = lengths.reduce((total, part) => total + part, 0)
  if (length < .025 || (labels.get(name)?.length ?? 0) >= length) return
  let midpoint = length / 2
  for (const [index, part] of lengths.entries()) {
    if (part >= midpoint && part > 0) {
      const [x, y] = points[index]
      const [nextX, nextY] = points[index + 1]
      const proportion = midpoint / part
      labels.set(name, { name, point: [x + (nextX - x) * proportion, y + (nextY - y) * proportion], length, water })
      return
    }
    midpoint -= part
  }
}

function createModel(features: Feature[]): MapModel {
  const boundaries = features.filter(feature => feature.properties?.kind === 'boundary')
  const rings = boundaries.flatMap(feature => polygonRings(feature.geometry))
  const coordinates = rings.flat()
  if (coordinates.length < 4) throw new Error('缺少门头沟区边界')

  const bounds = coordinates.reduce(([west, south, east, north], [lon, lat]) => [
    Math.min(west, lon), Math.min(south, lat), Math.max(east, lon), Math.max(north, lat),
  ], [Infinity, Infinity, -Infinity, -Infinity])
  const [west, south, east, north] = bounds
  const center: Position = [(west + east) / 2, (south + north) / 2]
  const longitudeScale = Math.cos(center[1] * Math.PI / 180)
  const width = (east - west) * longitudeScale
  const height = north - south
  if (!Number.isFinite(width + height) || width <= 0 || height <= 0) throw new Error('地图数据范围无效')

  const project = (point: Position) => toRelative(point, center, longitudeScale)
  const outline = new Path2D()
  const roads = [new Path2D(), new Path2D(), new Path2D()]
  const rivers = new Path2D()
  const land = new Path2D()
  const water = new Path2D()
  const places: Place[] = []
  const labels = new Map<string, MapLabel>()
  let hasRoads = false
  let hasWater = false
  for (const ring of rings) addPath(outline, ring, project, true)
  for (const { geometry, properties } of features) {
    switch (properties?.kind) {
      case 'road': {
        const highway = properties.highway ?? ''
        const rank = /^(motorway|trunk|primary)/.test(highway) ? 2 : /^(secondary|tertiary)/.test(highway) ? 1 : 0
        for (const line of lineStrings(geometry)) {
          addPath(roads[rank], line, project)
          if (rank === 2) saveLineLabel(labels, line, properties.ref ?? properties.name, project)
          hasRoads = true
        }
        break
      }
      case 'water':
        for (const line of lineStrings(geometry)) {
          addPath(rivers, line, project)
          saveLineLabel(labels, line, properties.name, project, true)
          hasWater = true
        }
        for (const ring of polygonRings(geometry)) {
          addPath(water, ring, project, true)
          hasWater = true
        }
        break
      case 'land':
      case 'wood':
        for (const ring of polygonRings(geometry)) addPath(land, ring, project, true)
        break
      case 'place':
        if (geometry?.type === 'Point' && properties.name) {
          places.push({ id: properties.id, name: properties.name, point: project(geometry.coordinates) })
        }
        break
    }
  }
  return {
    outline, roads, rivers, land, water, width, height, center, longitudeScale, hasRoads, hasWater, places,
    labels: [...labels.values()].sort((a, b) => b.length - a.length),
  }
}

async function loadMap(signal: AbortSignal) {
  const response = await fetch(assetUrl, { signal })
  if (!response.ok) throw new Error('地图数据加载失败')
  const data = await response.json() as { type?: string; features?: Feature[] }
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('地图数据格式无效')
  return createModel(data.features)
}

function fittedView(model: MapModel, surface: Surface, camera: Camera): View {
  const { frame } = surface
  const padding = Math.min(32, frame.width * .063, frame.height * .085)
  const fit = Math.min(
    Math.max(frame.width - padding * 2, 1) / model.width,
    Math.max(frame.height - padding * 2, 1) / model.height,
  )
  const zoom = zoomLevels[camera.zoom]
  const scale = fit * zoom
  const travelX = Math.min(model.width * scale / 2, Math.max(0, (zoom - 1) * frame.width / 2))
  const travelY = Math.min(model.height * scale / 2, Math.max(0, (zoom - 1) * frame.height / 2))
  return {
    scale,
    x: frame.left + frame.width / 2 + Math.max(-travelX, Math.min(camera.panX, travelX)),
    y: frame.top + frame.height / 2 + Math.max(-travelY, Math.min(camera.panY, travelY)),
  }
}

function mapStroke(context: CanvasRenderingContext2D, shape: Path2D, color: string, width: number, scale: number) {
  context.lineWidth = width / scale
  context.strokeStyle = color
  context.stroke(shape)
}

function drawGrid(context: CanvasRenderingContext2D, model: MapModel, surface: Surface, view: View) {
  const step = [.05, .1, .25, .5, 1, 2, 5, 10, 20].find(value => value * view.scale >= 58) ?? 45
  const [centerLon, centerLat] = model.center
  const minLongitude = centerLon - view.x / (view.scale * model.longitudeScale)
  const minLatitude = centerLat - (surface.height - view.y) / view.scale
  const line = new Path2D()
  for (let lon = Math.ceil(minLongitude / step) * step; ; lon += step) {
    const x = view.x + (lon - centerLon) * model.longitudeScale * view.scale
    if (x > surface.width) break
    line.moveTo(x, 0)
    line.lineTo(x, surface.height)
  }
  for (let lat = Math.ceil(minLatitude / step) * step; ; lat += step) {
    const y = view.y + (centerLat - lat) * view.scale
    if (y < 0) break
    line.moveTo(0, y)
    line.lineTo(surface.width, y)
  }
  mapStroke(context, line, '#5a82a229', .7, 1)
}

function paintMap(canvas: HTMLCanvasElement, model: MapModel, surface: Surface, view: View) {
  const density = Math.min(window.devicePixelRatio || 1, 2)
  const pixelWidth = Math.max(1, Math.round(surface.width * density))
  const pixelHeight = Math.max(1, Math.round(surface.height * density))
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  const context = canvas.getContext('2d')
  if (!context) return
  const { scale, x, y } = view
  context.setTransform(density, 0, 0, density, 0, 0)
  context.clearRect(0, 0, surface.width, surface.height)
  drawGrid(context, model, surface, view)
  context.translate(x, y)
  context.scale(scale, scale)
  context.lineJoin = 'round'
  context.lineCap = 'round'

  const districtFill = context.createLinearGradient(-model.width / 2, -model.height / 2, model.width / 2, model.height / 2)
  districtFill.addColorStop(0, '#12344e')
  districtFill.addColorStop(.55, '#112d49')
  districtFill.addColorStop(1, '#183c58')
  context.fillStyle = districtFill
  context.fill(model.outline, 'evenodd')
  mapStroke(context, model.outline, '#72c8ff2a', 8, scale)

  context.save()
  context.clip(model.outline, 'evenodd')
  context.fillStyle = '#174552'
  context.fill(model.land, 'evenodd')
  context.fillStyle = '#2473a4'
  context.fill(model.water, 'evenodd')
  mapStroke(context, model.rivers, '#2f86b7', 2.8, scale)
  mapStroke(context, model.rivers, '#86d7f3a8', 1, scale)
  for (const [index, color] of ['#6f97ae5c', '#afbdc382', '#ddab75cf'].entries()) {
    const width = [.75, 1.05, 1.6][index]
    mapStroke(context, model.roads[index], '#122437', width + 1.5, scale)
    mapStroke(context, model.roads[index], color, width, scale)
  }
  if (surface.frame.width >= 490) {
    context.save()
    context.setTransform(density, 0, 0, density, 0, 0)
    context.font = '600 11px system-ui, "Microsoft YaHei", sans-serif'
    context.textAlign = 'center'
    context.lineWidth = 3
    context.strokeStyle = '#12273b'
    for (const { name, point: [px, py], water } of model.labels.slice(0, 5)) {
      context.fillStyle = water ? '#a2dcf1' : '#e9c49d'
      context.strokeText(name, x + px * scale, y + py * scale - 5)
      context.fillText(name, x + px * scale, y + py * scale - 5)
    }
    context.restore()
  }
  context.restore()
  mapStroke(context, model.outline, '#5ba4d7', 1.6, scale)
}

const directionOrder: LabelSide[] = ['east', 'west', 'north', 'south']

function layoutPins(model: MapModel, areas: readonly Town[], view: View, frame: Frame) {
  const pins = areas.flatMap<Pin>(area => {
    const place = model.places.find(place => place.id === area.id) ?? model.places.find(place => place.name === area.name)
    if (!place) return []
    const [px, py] = place.point
    return [{ ...area, point: [view.x + px * view.scale, view.y + py * view.scale] }]
  })
  const right = frame.left + frame.width
  const bottom = frame.top + frame.height
  const visible = pins.filter(({ point: [x, y] }) => x > frame.left + 8 && x < right - 8 && y > frame.top + 8 && y < bottom - 8)
  const occupied = visible.map(({ point: [left, top] }) => ({ left: left - 6, top: top - 6, width: 12, height: 12 }))
  return visible.map(pin => {
    const [x, y] = pin.point
    const width = pin.name.length * 12 + 10
    const sides = directionOrder.map(side => {
      const left = side === 'east' ? x + 9 : side === 'west' ? x - 9 - width : x - width / 2
      const top = side === 'north' ? y - 29 : side === 'south' ? y + 9 : y - 10
      return { side, left, top, width, height: 20 }
    })
    const within = (box: Frame) => box.left >= frame.left && box.left + box.width <= right &&
      box.top >= frame.top && box.top + box.height <= bottom
    const preferred = sides.find(box => within(box) && !occupied.some(other => box.left < other.left + other.width &&
      box.left + box.width > other.left && box.top < other.top + other.height && box.top + box.height > other.top))
    if (preferred) occupied.push(preferred)
    return { ...pin, side: (preferred ?? sides.find(within) ?? sides[0]).side, label: Boolean(preferred) }
  })
}

function ScaleBar({ scale }: { scale: number }) {
  const pixelsPerKilometre = scale / 111.2
  const span = [20, 10, 5, 2, 1, .5, .2, .1].find(length => length * pixelsPerKilometre < 94) ?? .1
  const label = span >= 1 ? span + ' 千米' : Math.round(span * 1000) + ' 米'
  return <span className="district-map-scale" style={{ width: Math.round(span * pixelsPerKilometre) }} aria-label={'比例尺 ' + label}>{label}</span>
}

type DistrictMapProps = {
  areas: readonly Town[]
  onSelectArea: (id: string) => void
  fallback?: ReactNode
}

export default function DistrictMap({ areas, onSelectArea, fallback }: DistrictMapProps) {
  const map = useQuery({
    queryKey: ['static-map', 'mentougou'],
    queryFn: ({ signal }) => loadMap(signal),
    staleTime: Infinity,
  })
  const root = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const [surface, setSurface] = useState<Surface>()
  const [camera, setCamera] = useState(initialCamera)
  const [dragging, setDragging] = useState(false)
  const model = map.data
  const view = model && surface ? fittedView(model, surface, camera) : undefined
  const pins = model && surface && view ? layoutPins(model, areas, view, surface.frame) : []

  useLayoutEffect(() => {
    const node = root.current
    const safeArea = frame.current
    if (!node || !safeArea) return
    const measure = () => setSurface({
      width: node.clientWidth,
      height: node.clientHeight,
      frame: { left: safeArea.offsetLeft, top: safeArea.offsetTop, width: safeArea.clientWidth, height: safeArea.clientHeight },
    })
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    observer.observe(safeArea)
    measure()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (canvas.current && model && surface) paintMap(canvas.current, model, surface, fittedView(model, surface, camera))
  }, [model, surface, camera])

  function changeZoom(delta: number) {
    setCamera(current => {
      const zoom = Math.max(0, Math.min(zoomLevels.length - 1, current.zoom + delta))
      return zoom === 0 ? initialCamera : { ...current, zoom }
    })
  }

  function startDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (camera.zoom === 0 || !view || !surface || event.button !== 0) return
    const { frame } = surface
    drag.current = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      panX: view.x - (frame.left + frame.width / 2), panY: view.y - (frame.top + frame.height / 2),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  function moveDrag(event: PointerEvent<HTMLCanvasElement>) {
    const start = drag.current
    if (!start || event.pointerId !== start.pointerId) return
    setCamera(current => ({
      ...current, panX: start.panX + event.clientX - start.x, panY: start.panY + event.clientY - start.y,
    }))
  }

  function endDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
  }

  return (
    <div className="district-map" ref={root} data-ready={!!model} data-zoomed={camera.zoom > 0} data-dragging={dragging}>
      <div className="district-map-frame" ref={frame} aria-hidden="true" />
      {model ? (
        <>
          <canvas ref={canvas} role="img" aria-label="北京市门头沟区公开地图"
            onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
            onPointerCancel={endDrag} onLostPointerCapture={endDrag} />
          {pins.map(({ point, id, name, side, label }) => (
            <button key={id} type="button" className="district-map-pin" aria-label={name}
              data-side={side} data-label={label} style={{ left: point[0], top: point[1] }}
              onClick={() => onSelectArea(id)}>
              <span className="district-map-point" aria-hidden="true" />
              <span className="district-map-pin-label" aria-hidden="true">{name}</span>
            </button>
          ))}
          <div className="district-map-north" aria-label="正北向"><i aria-hidden="true" />北</div>
          <div className="district-map-key">
            <div className="district-map-legend" aria-label="图例">
              <span data-mark="boundary">区界</span>
              {model.hasRoads && <span data-mark="road">道路</span>}
              {model.hasWater && <span data-mark="water">水系</span>}
            </div>
            {view && <ScaleBar scale={view.scale} />}
          </div>
          <div className="district-map-tools" aria-label="地图缩放">
            <button type="button" aria-label="缩小地图" disabled={camera.zoom === 0} onClick={() => changeZoom(-1)}>−</button>
            <button type="button" aria-label="放大地图" disabled={camera.zoom === zoomLevels.length - 1} onClick={() => changeZoom(1)}>+</button>
            <button type="button" onClick={() => setCamera(initialCamera)} disabled={camera.zoom === 0}>全域</button>
          </div>
          <a className="district-map-credit" href={copyrightUrl} target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
        </>
      ) : map.isError ? fallback ?? (
        <div className="district-map-status" role="status">
          <p>地图数据暂不可用</p>
          <button type="button" onClick={() => void map.refetch()}>重试</button>
        </div>
      ) : <div className="district-map-status" role="status">正在加载门头沟区地图</div>}
    </div>
  )
}
