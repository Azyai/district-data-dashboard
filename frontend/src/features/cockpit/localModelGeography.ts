import { BufferAttribute, CanvasTexture, LinearFilter, Mesh, Vector3 } from 'three'
import type { Box3, MeshBasicMaterial, MeshStandardMaterial, Object3D } from 'three'

type Coordinates = [longitude: number, latitude: number]
type Polygon = Coordinates[][]
type GeoBounds = { west: number; east: number; south: number; north: number }
type SurfaceMesh = Mesh<Mesh['geometry'], MeshBasicMaterial | MeshStandardMaterial>

export type GeoBoundary = {
  code: string
  name: string
  polygons: Polygon[]
  bounds: GeoBounds
}

export const districtBounds = { west: 115.416805, east: 116.169245, south: 39.810992, north: 40.177916 }
const dataRoot = import.meta.env.BASE_URL + 'maps/local-model/data/'
const sourceNames: Record<string, string> = { 'yongding-xixincheng': '西辛称村' }

export function boundaryFor(area: { id: string; name: string }, boundaries?: GeoBoundary[]) {
  return boundaries?.find(boundary => boundary.name === area.name)
    ?? boundaries?.find(boundary => boundary.name === sourceNames[area.id])
}

export async function readBoundaries(signal: AbortSignal, townCode?: string): Promise<GeoBoundary[]> {
  if (townCode && !/^110109\d{3}$/.test(townCode)) throw new Error('Invalid town code')
  const file = townCode ? 'villages/' + townCode + '.geojson' : 'towns.geojson'
  const response = await fetch(dataRoot + file, { signal })
  if (!response.ok) throw new Error('Local boundary unavailable')
  const collection = await response.json() as { type: string; features: Array<{
    properties: { code: string; name: string }
    geometry: { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: Polygon[] }
  }> }
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Invalid local boundary data')
  return collection.features.map(({ properties, geometry }) => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity }
    for (const polygon of polygons) for (const [longitude, latitude] of polygon[0]) {
      bounds.west = Math.min(bounds.west, longitude)
      bounds.east = Math.max(bounds.east, longitude)
      bounds.south = Math.min(bounds.south, latitude)
      bounds.north = Math.max(bounds.north, latitude)
    }
    return { code: properties.code, name: properties.name, polygons, bounds }
  })
}

function containsPoint(ring: Coordinates[], point: Coordinates) {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i]
    const [c, d] = ring[j]
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside
  }
  return inside
}

export function boundaryContains(boundary: GeoBoundary, point: Coordinates) {
  const { west, east, south, north } = boundary.bounds
  return point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north
    && boundary.polygons.some(([outer, ...holes]) => containsPoint(outer, point) && !holes.some(ring => containsPoint(ring, point)))
}

export function boundaryCenter(boundary: GeoBoundary): Coordinates {
  const { west, east, south, north } = boundary.bounds
  const center: Coordinates = [(west + east) / 2, (south + north) / 2]
  if (boundaryContains(boundary, center)) return center
  let nearest = Infinity
  let result = boundary.polygons[0][0][0]
  for (let x = 1; x < 12; x++) for (let y = 1; y < 12; y++) {
    const distance = (x - 6) ** 2 + (y - 6) ** 2
    const point: Coordinates = [west + (east - west) * x / 12, south + (north - south) * y / 12]
    if (distance < nearest && boundaryContains(boundary, point)) {
      nearest = distance
      result = point
    }
  }
  return result
}

// The supplied GLB has local coordinates only. Its model footprint aligns with
// the WGS84 district envelope in this north-up display projection.
export function modelCoordinates([longitude, latitude]: Coordinates, box: Box3): [number, number] {
  const { west, east, south, north } = districtBounds
  return [
    box.min.x + (longitude - west) / (east - west) * (box.max.x - box.min.x),
    box.min.z + (north - latitude) / (north - south) * (box.max.z - box.min.z),
  ]
}

export function geoCoordinates(x: number, z: number, box: Box3): Coordinates {
  const { west, east, south, north } = districtBounds
  return [
    west + (x - box.min.x) / (box.max.x - box.min.x) * (east - west),
    north - (z - box.min.z) / (box.max.z - box.min.z) * (north - south),
  ]
}

function surfaces(model: Object3D) {
  return model.children.filter((object): object is SurfaceMesh => object instanceof Mesh)
}

// The district model contains an enclosing base and full-district side walls.
// Their triangles leave isolated vertical strips when a smaller region clips them.
function terrainBase(mesh: Mesh) {
  const box = mesh.geometry.boundingBox
  return box ? box.min.y + (box.max.y - box.min.y) * .00045 : -Infinity
}

export function terrainSurfaceIndex(mesh: Mesh) {
  const geometry = mesh.geometry
  const original = geometry.index
  if (!original) return null
  const positions = geometry.getAttribute('position')
  const base = terrainBase(mesh)
  const elements = new Uint32Array(original.count)
  const point = new Vector3()
  const edgeA = new Vector3()
  const edgeB = new Vector3()
  const normal = new Vector3()
  let length = 0
  for (let i = 0; i < original.count; i += 3) {
    const a = original.getX(i)
    const b = original.getX(i + 1)
    const c = original.getX(i + 2)
    if (positions.getY(a) <= base || positions.getY(b) <= base || positions.getY(c) <= base) continue
    point.fromBufferAttribute(positions, a)
    edgeA.fromBufferAttribute(positions, b).sub(point).multiply(mesh.scale)
    edgeB.fromBufferAttribute(positions, c).sub(point).multiply(mesh.scale)
    normal.crossVectors(edgeA, edgeB)
    if (normal.y <= normal.length() * .06) continue
    elements[length++] = a
    elements[length++] = b
    elements[length++] = c
  }
  if (!length) return original
  return new BufferAttribute(elements.slice(0, length), 1)
}

export function clearBoundaryMask(model: Object3D) {
  for (const mesh of surfaces(model)) {
    mesh.material.alphaMap = null
    mesh.material.alphaTest = 0
    mesh.material.needsUpdate = true
    mesh.geometry.deleteAttribute('uv1')
  }
}

export function maskToBoundary(model: Object3D, boundary: GeoBoundary, box: Box3) {
  const { west, east, south, north } = boundary.bounds
  const left = west - (east - west) * .02
  const right = east + (east - west) * .02
  const top = north + (north - south) * .02
  const bottom = south - (north - south) * .02
  const u = (longitude: number) => (longitude - left) / (right - left)
  const v = (latitude: number) => (latitude - bottom) / (top - bottom)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Unable to create local geometry mask')
  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#fff'
  for (const polygon of boundary.polygons) {
    context.beginPath()
    for (const ring of polygon) {
      ring.forEach(([longitude, latitude], index) => {
        const x = u(longitude) * canvas.width
        const y = (1 - v(latitude)) * canvas.height
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.closePath()
    }
    context.fill('evenodd')
  }
  const texture = new CanvasTexture(canvas)
  texture.channel = 1
  texture.generateMipmaps = false
  texture.minFilter = LinearFilter
  const mask = context.getImageData(0, 0, canvas.width, canvas.height).data
  const vertex = new Vector3()
  let bottomY = Infinity
  let topY = -Infinity
  for (const mesh of surfaces(model)) {
    const positions = mesh.geometry.getAttribute('position')
    const uv = new Float32Array(positions.count * 2)
    const base = terrainBase(mesh)
    for (let index = 0; index < positions.count; index++) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrix)
      const [longitude, latitude] = geoCoordinates(vertex.x, vertex.z, box)
      const x = u(longitude)
      const y = v(latitude)
      uv[index * 2] = x
      uv[index * 2 + 1] = y
      if (mesh.name === 'terrain' && positions.getY(index) > base && x > 0 && x < 1 && y > 0 && y < 1) {
        const column = Math.floor(x * canvas.width)
        const row = Math.floor((1 - y) * canvas.height)
        if (mask[(row * canvas.width + column) * 4 + 1] >= 127) {
          bottomY = Math.min(bottomY, vertex.y)
          topY = Math.max(topY, vertex.y)
        }
      }
    }
    mesh.geometry.setAttribute('uv1', new BufferAttribute(uv, 2))
    mesh.material.alphaMap = texture
    mesh.material.alphaTest = .32
    mesh.material.needsUpdate = true
  }
  return { texture, bottomY, topY }
}
