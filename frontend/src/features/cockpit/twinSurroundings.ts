import {
  CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3,
} from 'three'
import type { Box3 } from 'three'
import type { TwinId } from './twinSites'

type Point = [number, number]
type PlaneBounds = [number, number, number, number]
type Feature = { name: string; polygons: Point[][][] }
type Plan = { bounds: PlaneBounds; roads: Feature[]; water: Feature[] }

const assetRoot = import.meta.env.BASE_URL + 'maps/local-model/'
const mainRoads: Record<TwinId, ReadonlySet<string>> = {
  tianjie: new Set(['新城大街', '泰安北路', '金安路']),
  jingxi: new Set(['莲石湖西路', '永安路']),
}
const roadLabels: Record<TwinId, Record<string, [Point, number]>> = {
  tianjie: {
    新城大街: [[-3840, -1955], Math.PI / 2],
    泰安北路: [[-3690, -1812], -.06],
    金安路: [[-3680, -2052], -.06],
  },
  jingxi: {
    莲石湖西路: [[-3120, -1003], .09],
    永安路: [[-3457, -1014], .04],
  },
}

// These planting beds and block patterns are drawn as context; only the road
// and water footprints come from the supplied regional meshes.
const edgePlanting: Record<TwinId, Point[][]> = {
  tianjie: [
    [[.15, .24], [.32, .23], [.32, .29], [.21, .34], [.15, .33]],
    [[.77, .48], [.94, .48], [.94, .67], [.86, .70], [.77, .62]],
    [[.43, .79], [.58, .80], [.57, .94], [.38, .93]],
  ],
  jingxi: [
    [[.09, .38], [.27, .31], [.30, .45], [.25, .51], [.10, .49]],
    [[.72, .29], [.90, .26], [.93, .45], [.79, .46]],
    [[.68, .74], [.87, .67], [.91, .82], [.79, .87], [.67, .82]],
  ],
}

function contour(context: CanvasRenderingContext2D, points: Point[], transform: (point: Point) => Point) {
  context.moveTo(...transform(points[0]))
  for (const point of points.slice(1)) context.lineTo(...transform(point))
  context.closePath()
}

function drawFeature(context: CanvasRenderingContext2D, feature: Feature, transform: (point: Point) => Point,
  fill: string, outline: string, weight: number) {
  context.beginPath()
  for (const polygon of feature.polygons) for (const ring of polygon) contour(context, ring, transform)
  context.fillStyle = fill
  context.strokeStyle = outline
  context.lineWidth = weight
  context.stroke()
  context.fill('evenodd')
}

function drawPlanting(context: CanvasRenderingContext2D, bed: Point[], project: (point: Point) => Point, fill: string) {
  const boundary = new Path2D()
  const pixels = bed.map(project)
  boundary.moveTo(...pixels[0])
  for (const point of pixels.slice(1)) boundary.lineTo(...point)
  boundary.closePath()
  context.fillStyle = fill
  context.strokeStyle = '#6387789e'
  context.lineWidth = 2
  context.fill(boundary)
  context.stroke(boundary)

  const lowX = Math.min(...pixels.map(point => point[0]))
  const highX = Math.max(...pixels.map(point => point[0]))
  const lowY = Math.min(...pixels.map(point => point[1]))
  const highY = Math.max(...pixels.map(point => point[1]))
  context.save()
  context.clip(boundary)
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 5; column++) {
      const x = lowX + (highX - lowX) * (column + .46 + (row % 2) * .28) / 5
      const y = lowY + (highY - lowY) * (row + .45 + column % 3 * .14) / 5
      const radius = 8 + (row + column * 2) % 4 * 2
      if (!context.isPointInPath(boundary, x, y)) continue
      context.fillStyle = '#162f338c'
      context.beginPath()
      context.arc(x + 2.5, y + 3, radius, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = (row + column) % 3 === 0 ? '#679879' : '#547e69'
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
  }
  context.restore()
}

function campusPlan(id: TwinId, plan: Plan, building: PlaneBounds) {
  const canvas = document.createElement('canvas')
  const [left, top, right, bottom] = plan.bounds
  const units = 1536 / Math.max(right - left, bottom - top)
  canvas.width = Math.max(1, Math.round((right - left) * units))
  canvas.height = Math.max(1, Math.round((bottom - top) * units))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('周边简图不可用')
  const { width, height } = canvas
  const relative = ([x, y]: Point): Point => [x * width, y * height]
  const project = ([x, z]: Point): Point => [(x - left) * units, (z - top) * units]
  const [bx, by] = project([building[0], building[1]])
  const [ex, ey] = project([building[2], building[3]])

  const fade = context.createLinearGradient(0, 0, width, height)
  fade.addColorStop(0, '#132737')
  fade.addColorStop(.5, '#243a49')
  fade.addColorStop(1, '#132637')
  context.roundRect(0, 0, width, height, 40)
  context.clip()
  context.fillStyle = fade
  context.fillRect(0, 0, width, height)
  context.lineWidth = 2
  context.strokeStyle = '#62809566'
  context.beginPath()
  context.roundRect(7, 7, width - 14, height - 14, 37)
  context.stroke()

  // The cleared area underneath the landmark keeps a small silhouette shadow
  // visible around the real geometry, without covering the lower floors.
  context.fillStyle = '#1a2a35'
  context.strokeStyle = '#49667990'
  context.lineWidth = 2
  context.beginPath()
  context.roundRect(bx - 16, by - 16, ex - bx + 32, ey - by + 32, 18)
  context.fill()
  context.stroke()

  if (plan.roads.length) for (const bed of edgePlanting[id]) {
    drawPlanting(context, bed, relative, id === 'tianjie' ? '#345148' : '#2a504d')
  }

  for (const water of plan.water) drawFeature(context, water, project, '#203d53', '#466f82a6', 3)
  for (const road of plan.roads) {
    const primary = mainRoads[id].has(road.name)
    drawFeature(context, road, project, primary ? '#627d8a' : '#4a6072', '#adc5cf91', primary ? 4 : 2)
  }
  context.font = '600 26px "Microsoft YaHei UI", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#e2f3f5'
  for (const [name, [point, angle]] of Object.entries(roadLabels[id])) {
    if (!plan.roads.some(road => road.name === name)) continue
    context.save()
    context.translate(...project(point))
    context.rotate(angle)
    context.fillText(name, 0, 0)
    context.restore()
  }
  return canvas
}

async function readPlan(id: TwinId, signal: AbortSignal): Promise<Plan | undefined> {
  try {
    const response = await fetch(assetRoot + id + '-context.json', { signal })
    if (!response.ok) return undefined
    const plan = await response.json() as Plan
    if (plan.bounds?.length === 4 && plan.bounds.every(Number.isFinite)
      && plan.bounds[0] < plan.bounds[2] && plan.bounds[1] < plan.bounds[3]
      && Array.isArray(plan.roads) && Array.isArray(plan.water)) return plan
  } catch {
    signal.throwIfAborted()
  }
}

export async function createTwinSurroundings(id: TwinId, bounds: Box3, scale: number, signal: AbortSignal) {
  const building: PlaneBounds = [bounds.min.x, bounds.min.z, bounds.max.x, bounds.max.z]
  const size = bounds.getSize(new Vector3()).multiplyScalar(scale)
  const margin = Math.max(size.x, size.z) * .12 / scale
  const expected: PlaneBounds = [building[0] - margin, building[1] - margin, building[2] + margin, building[3] + margin]
  const source = await readPlan(id, signal)
  signal.throwIfAborted()
  const plan: Plan = source ? {
    ...source,
    bounds: [
      Math.min(source.bounds[0], expected[0]), Math.min(source.bounds[1], expected[1]),
      Math.max(source.bounds[2], expected[2]), Math.max(source.bounds[3], expected[3]),
    ],
  } : { bounds: expected, roads: [], water: [] }
  const [left, top, right, bottom] = plan.bounds
  const map = new CanvasTexture(campusPlan(id, plan, building))
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 4
  const width = (right - left) * scale
  const depth = (bottom - top) * scale
  const surface = new Mesh(new PlaneGeometry(width, depth),
    new MeshBasicMaterial({ map, transparent: true, alphaTest: .15, toneMapped: false }))
  surface.rotation.x = -Math.PI / 2
  const center = bounds.getCenter(new Vector3())
  surface.position.set(
    ((left + right) / 2 - center.x) * scale,
    (bounds.min.y - center.y) * scale - .045,
    ((top + bottom) / 2 - center.z) * scale,
  )
  const object = new Group()
  object.name = 'landmark-surroundings'
  object.add(surface)

  // The plan extends slightly beyond the view's fit target. Keep the landmark
  // large enough that the underlying building detail is visible at first load.
  size.x = Math.max(size.x * 1.3, width * .8)
  size.z = Math.max(size.z * 1.3, depth * .8)
  return { object, size }
}
