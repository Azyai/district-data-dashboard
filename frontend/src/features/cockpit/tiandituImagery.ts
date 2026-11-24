import { addProtocol, MercatorCoordinate, removeProtocol } from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Coordinates, Polygon } from './mapBoundaries'
import { tileUrl } from './tiandituStyle'

export type Basemap = 'offline' | 'connecting' | 'online' | 'unavailable'
let sequence = 0
const origin = MercatorCoordinate.fromLngLat([115.8, 40])
const outsidePalette = Array.from({ length: 256 }, (_, luminance) => {
  const shade = Math.min(1, Math.max(0, (luminance / 255 - .05) / .78)) ** .8
  return [9 + 86 * shade, 16 + 118 * shade, 26 + 148 * shade] as const
})

function gradeSurroundings(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // The reference uses a steel-blue luminance ramp to retain the terrain texture.
  const pixels = ctx.getImageData(0, 0, width, height)
  const { data } = pixels
  for (let index = 0; index < data.length; index += 4) {
    const luminance = (data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114) | 0
    const [red, green, blue] = outsidePalette[luminance]
    data[index] = red
    data[index + 1] = green
    data[index + 2] = blue
  }
  ctx.putImageData(pixels, 0, 0)
}

// Tint the same source imagery outside the actual multi-polygon. Keeping the
// mask in tile coordinates makes colours and boundaries agree while pitching.
function maskPath(polygons: Polygon[]) {
  const path = new Path2D()
  for (const polygon of polygons) for (const ring of polygon) {
    ring.forEach((coordinate: Coordinates, index) => {
      const { x, y } = MercatorCoordinate.fromLngLat(coordinate)
      if (index === 0) path.moveTo(x - origin.x, y - origin.y)
      else path.lineTo(x - origin.x, y - origin.y)
    })
    path.closePath()
  }
  return path
}

export function connectImagery(map: MapLibreMap, token: string, boundary: Polygon[],
  onStatus: (state: Basemap, reason?: string) => void) {
  const scheme = 'tianditu-district-' + ++sequence
  const outline = maskPath(boundary)
  let disposed = false
  let success = false
  let errors = 0
  const subscription = new AbortController()
  function failure(reason?: string) {
    if (disposed) return
    disposed = true
    subscription.abort()
    if (map.getLayer('national-imagery')) map.removeLayer('national-imagery')
    if (map.getSource('national-imagery')) map.removeSource('national-imagery')
    map.setPaintProperty('outside', 'fill-opacity', .91)
    map.setPaintProperty('grid', 'line-opacity', .12)
    onStatus('unavailable', reason)
  }
  const deadline = window.setTimeout(() => { if (!success) failure() }, 12_000)
  addProtocol(scheme, async ({ url }, { signal }) => {
    const coords = new URL(url)
    const z = Number(coords.hostname)
    const [x, y] = coords.pathname.slice(1).split('/').map(Number)
    const requestUrl = tileUrl(token).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
    const requestSignal = AbortSignal.any([signal, subscription.signal, AbortSignal.timeout(10_000)])
    let reason: string | undefined
    try {
      const response = await fetch(requestUrl, { signal: requestSignal, credentials: 'omit' })
      if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().startsWith('image/')) {
        const body = await response.json().catch(() => ({}))
        if (String(body.code) === '301012') reason = '影像密钥类型不匹配'
        if (response.status === 401 || response.status === 403) failure(reason)
        throw new Error('Imagery service unavailable')
      }
      const bitmap = await createImageBitmap(await response.blob())
      try {
        requestSignal.throwIfAborted()
        if (bitmap.width !== 256 || bitmap.height !== 256) throw new Error('Unexpected imagery tile')
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 256
        const ctx = canvas.getContext('2d', { alpha: false })!
        ctx.drawImage(bitmap, 0, 0)
        gradeSurroundings(ctx, canvas.width, canvas.height)
        ctx.save()
        const world = 2 ** z * 256
        ctx.setTransform(world, 0, 0, world, origin.x * world - x * 256, origin.y * world - y * 256)
        ctx.clip(outline, 'evenodd')
        ctx.resetTransform()
        ctx.filter = 'saturate(.87) contrast(1.12) brightness(.8)'
        ctx.drawImage(bitmap, 0, 0)
        ctx.restore()
        const data = await createImageBitmap(canvas)
        if (requestSignal.aborted) { data.close(); requestSignal.throwIfAborted() }
        errors = 0
        if (!success) {
          success = true
          window.clearTimeout(deadline)
          map.setPaintProperty('outside', 'fill-opacity', 0)
          map.setPaintProperty('grid', 'line-opacity', 0)
          onStatus('online')
        }
        return { data }
      } finally { bitmap.close() }
    } catch {
      if (!disposed && !signal.aborted && ++errors >= 4) failure(reason)
      // Never propagate a signed tile URL or provider response through WebGL errors.
      throw new Error('Imagery tile unavailable')
    }
  })
  map.addSource('national-imagery', {
    type: 'raster', tiles: [scheme + '://{z}/{x}/{y}'], tileSize: 256,
    minzoom: 2, maxzoom: 18, bounds: [114.4, 39.2, 117.1, 40.8],
  })
  map.addLayer({ id: 'national-imagery', source: 'national-imagery', type: 'raster',
    paint: { 'raster-fade-duration': 0 } }, 'outside')
  return () => {
    disposed = true
    subscription.abort()
    window.clearTimeout(deadline)
    if (map.getStyle()) {
      if (map.getLayer('national-imagery')) map.removeLayer('national-imagery')
      if (map.getSource('national-imagery')) map.removeSource('national-imagery')
    }
    removeProtocol(scheme)
  }
}
