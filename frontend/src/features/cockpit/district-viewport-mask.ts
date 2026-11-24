import type { Map as MapLibreMap, MapSourceDataEvent } from 'maplibre-gl'

type Position = [longitude: number, latitude: number]
type Ring = Position[]
type MaskOutline = {
  features: ReadonlyArray<{
    geometry: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }
  }>
}

const background = '#0e1d30'
const feather = 10

function perimeterRings(rings: Ring[]): Ring[] {
  if (rings.length <= 1) return rings
  // Exact shared edges between town polygons contribute twice to an even-odd fill and cancel.
  const points = new Map<string, Position>()
  const edges = new Map<string, [string, string]>()
  for (const ring of rings) {
    const keys = ring.map(point => {
      const key = point.join(',')
      points.set(key, point)
      return key
    })
    for (const [index, start] of keys.entries()) {
      const end = keys[(index + 1) % keys.length]
      if (start === end) continue
      const id = start < end ? `${start};${end}` : `${end};${start}`
      if (!edges.delete(id)) edges.set(id, [start, end])
    }
  }

  const links = new Map<string, Array<{ id: string; to: string }>>()
  for (const [id, [a, b]] of edges) {
    const first = links.get(a) ?? []
    const second = links.get(b) ?? []
    first.push({ id, to: b })
    second.push({ id, to: a })
    links.set(a, first)
    links.set(b, second)
  }

  const outlines: Ring[] = []
  while (edges.size) {
    const segment = edges.values().next().value
    if (!segment) break
    const [start] = segment
    const outline: Ring = []
    let current = start
    do {
      const point = points.get(current)
      const next = links.get(current)?.find(link => edges.has(link.id))
      if (!point || !next) return rings
      outline.push(point)
      edges.delete(next.id)
      current = next.to
    } while (current !== start)
    if (outline.length > 2) outlines.push(outline)
  }
  return outlines
}

function clipAt(ring: Ring, axis: 0 | 1, edge: number, keepGreater: boolean): Ring {
  const clipped: Ring = []
  let previous = ring.at(-1)
  if (!previous) return clipped
  const inside = (point: Position) => keepGreater ? point[axis] >= edge : point[axis] <= edge
  let wasInside = inside(previous)
  for (const point of ring) {
    const isInside = inside(point)
    if (isInside !== wasInside) {
      const fraction = (edge - previous[axis]) / (point[axis] - previous[axis])
      const intersection: Position = [
        previous[0] + (point[0] - previous[0]) * fraction,
        previous[1] + (point[1] - previous[1]) * fraction,
      ]
      intersection[axis] = edge
      clipped.push(intersection)
    }
    if (isInside) clipped.push(point)
    previous = point
    wasInside = isInside
  }
  return clipped
}

function visiblePath(map: MapLibreMap, rings: Ring[]): Path2D {
  const path = new Path2D()
  const bounds = map.getBounds()
  const allowance = map.getPitch() ? .26 : .12
  const longitudeMargin = (bounds.getEast() - bounds.getWest()) * allowance
  const latitudeMargin = (bounds.getNorth() - bounds.getSouth()) * allowance
  const west = bounds.getWest() - longitudeMargin
  const east = bounds.getEast() + longitudeMargin
  const south = bounds.getSouth() - latitudeMargin
  const north = bounds.getNorth() + latitudeMargin

  for (const ring of rings) {
    // Trim distant vertices before projecting so tilted views cannot wrap behind the camera.
    const longitudeClipped = clipAt(clipAt(ring, 0, west, true), 0, east, false)
    const clipped = clipAt(clipAt(longitudeClipped, 1, south, true), 1, north, false)
    if (clipped.length < 3) continue
    const first = map.project(clipped[0])
    path.moveTo(first.x, first.y)
    for (let index = 1; index < clipped.length; index++) {
      const point = map.project(clipped[index])
      path.lineTo(point.x, point.y)
    }
    path.closePath()
  }
  return path
}

export function attachDistrictViewportMask(map: MapLibreMap, outline: MaskOutline): () => void {
  const rings = perimeterRings(outline.features.flatMap(({ geometry }) =>
    geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()))
  const canvas = document.createElement('canvas')
  const mapCanvas = map.getCanvas()
  const mapContainer = map.getContainer()
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create district viewport mask')
  canvas.className = 'district-viewport-mask'
  canvas.setAttribute('aria-hidden', 'true')

  let dirty = true
  const invalidate = () => { dirty = true }
  const updateTerrain = (event: MapSourceDataEvent) => {
    if (event.sourceId === map.getTerrain()?.source) invalidate()
  }
  const paint = () => {
    if (!dirty) return
    // MapLibre sizes its projection from the container before the canvas element finishes reflowing.
    const { clientWidth: width, clientHeight: height } = mapContainer
    if (!width || !height) return
    dirty = false

    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3_000_000 / (width * height)))
    const pixelsWide = Math.round(width * ratio)
    const pixelsHigh = Math.round(height * ratio)
    if (canvas.width !== pixelsWide) canvas.width = pixelsWide
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh
    context.setTransform(pixelsWide / width, 0, 0, pixelsHigh / height, 0, 0)
    context.globalCompositeOperation = 'copy'
    context.fillStyle = background
    context.fillRect(0, 0, width, height)

    context.save()
    context.globalCompositeOperation = 'destination-out'
    context.shadowColor = 'rgba(0, 0, 0, .62)'
    context.shadowBlur = feather * ratio
    context.fill(visiblePath(map, rings), 'evenodd')
    context.restore()
    canvas.dataset.maskReady = 'true'
  }
  const resize = () => {
    invalidate()
    paint()
  }

  mapCanvas.after(canvas)
  map.on('move', invalidate)
  map.on('resize', resize)
  map.on('terrain', invalidate)
  map.on('sourcedata', updateTerrain)
  map.on('render', paint)
  paint()

  return () => {
    map.off('move', invalidate)
    map.off('resize', resize)
    map.off('terrain', invalidate)
    map.off('sourcedata', updateTerrain)
    map.off('render', paint)
    canvas.remove()
  }
}
