export type Coordinates = [longitude: number, latitude: number]
export type Polygon = Coordinates[][]
type GeoBounds = { west: number; east: number; south: number; north: number }

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
  return parseBoundaries(await response.json())
}

export function parseBoundaries(data: unknown): GeoBoundary[] {
  const collection = data as { type: string; features: Array<{
    properties: { code: string; name: string }
    geometry: { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: Polygon[] }
  }> }
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Invalid local boundary data')
  return collection.features.flatMap(({ properties, geometry }) => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    if (!polygons?.[0]?.[0]?.length) return []
    const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity }
    for (const polygon of polygons) for (const [longitude, latitude] of polygon[0]) {
      bounds.west = Math.min(bounds.west, longitude)
      bounds.east = Math.max(bounds.east, longitude)
      bounds.south = Math.min(bounds.south, latitude)
      bounds.north = Math.max(bounds.north, latitude)
    }
    return [{ code: properties.code, name: properties.name, polygons, bounds }]
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
