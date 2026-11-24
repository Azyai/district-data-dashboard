import { addProtocol, MercatorCoordinate } from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import type { Coordinates } from './mapBoundaries'
import { districtBounds } from './mapBoundaries'

const root = import.meta.env.BASE_URL + 'maps/'
const { west, south, east, north } = districtBounds
const corners: [Coordinates, Coordinates, Coordinates, Coordinates] = [[west, north], [east, north], [east, south], [west, south]]
const northwest = MercatorCoordinate.fromLngLat(corners[0])
const southeast = MercatorCoordinate.fromLngLat(corners[2])
const elevationScheme = 'mentougou-elevation'

// One lossless local elevation image covers the entire district. Generate only
// the visible DEM tiles in memory, even at detailed street zoom levels.
let elevation: Promise<HTMLImageElement> | undefined
addProtocol(elevationScheme, async ({ url }, { signal }) => {
  const address = /^mentougou-elevation:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(url)
  if (!address) throw new Error('Invalid district elevation tile')
  if (!elevation) {
    const image = new Image()
    image.src = root + 'district-elevation.png'
    elevation = image.decode().then(() => image).catch(error => { elevation = undefined; throw error })
  }
  const source = await elevation
  signal.throwIfAborted()
  const world = 256 * 2 ** Number(address[1])
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.imageSmoothingEnabled = false
  const padding = 64
  const width = (southeast.x - northwest.x) * world
  const height = (southeast.y - northwest.y) * world
  const padX = width * padding / (source.width - padding * 2)
  const padY = height * padding / (source.height - padding * 2)
  ctx.drawImage(source, northwest.x * world - Number(address[2]) * 256 - padX,
    northwest.y * world - Number(address[3]) * 256 - padY, width + padX * 2, height + padY * 2)
  const data = await createImageBitmap(canvas)
  if (signal.aborted) { data.close(); signal.throwIfAborted() }
  return { data }
})

export const atlasUrl = root + 'district-atlas.geojson'
export const reliefUrl = root + 'district-relief.webp'

export function tileUrl(token: string) {
  return 'https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
    + '&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk='
    + encodeURIComponent(token)
}

function graticule(): GeoJSON.MultiLineString {
  const coordinates: number[][][] = []
  for (let x = 1140; x < 1180; x++) coordinates.push([[x / 10, 39], [x / 10, 41]])
  for (let y = 390; y < 410; y++) coordinates.push([[114, y / 10], [118, y / 10]])
  return { type: 'MultiLineString', coordinates }
}

export function atlasStyle(data: GeoJSON.FeatureCollection): StyleSpecification {
  return {
    version: 8,
    sources: {
      regional: { type: 'geojson', data, tolerance: .2 },
      graticule: { type: 'geojson', data: graticule() },
      relief: { type: 'image', url: reliefUrl, coordinates: corners },
      waterways: { type: 'geojson', data: import.meta.env.BASE_URL + 'monitoring/waterways.geojson', tolerance: .18 },
      focus: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      children: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      elevation: { type: 'raster-dem', tiles: [elevationScheme + '://{z}/{x}/{y}'], tileSize: 256,
        maxzoom: 11, bounds: [west - .04, south - .03, east + .04, north + .03], encoding: 'custom', redFactor: 256,
        greenFactor: 1, blueFactor: 0, baseShift: 0 },
    },
    layers: [
      { id: 'base', type: 'background', paint: { 'background-color': '#152435' } },
      { id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-fade-duration': 0 } },
      { id: 'outside', type: 'fill', source: 'regional', filter: ['==', 'kind', 'outside'],
        paint: { 'fill-color': '#1b2b3c', 'fill-opacity': .91 } },
      { id: 'grid', type: 'line', source: 'graticule', paint: { 'line-color': '#7393a7', 'line-opacity': .12, 'line-width': 1 } },
      { id: 'water-surface', type: 'fill', source: 'waterways',
        paint: { 'fill-color': '#197be9', 'fill-opacity': .82 } },
      { id: 'river-line', type: 'line', source: 'waterways',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#349dff', 'line-opacity': .94,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, .9, 12, 1.3, 16, 2] } },
      { id: 'towns', type: 'line', source: 'regional', filter: ['==', 'kind', 'town'],
        paint: { 'line-color': '#f4ffff', 'line-opacity': .83, 'line-width': 1 } },
      { id: 'boundary-glow', type: 'line', source: 'regional', filter: ['==', 'kind', 'district'],
        paint: { 'line-color': '#367e92', 'line-opacity': .75, 'line-width': 5, 'line-blur': 2 } },
      { id: 'boundary', type: 'line', source: 'regional', filter: ['==', 'kind', 'district'],
        paint: { 'line-color': '#e5feff', 'line-opacity': .97, 'line-width': 1.8 } },
      { id: 'selected-area', type: 'fill', source: 'focus', paint: { 'fill-color': '#539fbe', 'fill-opacity': .19 } },
      { id: 'selected-edge', type: 'line', source: 'focus', paint: { 'line-color': '#a1f2ef', 'line-width': 2 } },
      { id: 'child-edges', type: 'line', source: 'children', paint: { 'line-color': '#b8e7e6', 'line-width': 1, 'line-dasharray': [3, 3] } },
    ],
  }
}
