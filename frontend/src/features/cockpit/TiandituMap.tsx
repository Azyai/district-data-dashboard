import { skipToken, useQuery } from '@tanstack/react-query'
import { Map as MapLibreMap, Marker, ScaleControl } from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CockpitArea } from '../../api/client'
import MapGlobeControl from './MapGlobeControl'
import { boundaryCenter, boundaryContains, boundaryFor, districtBounds, parseBoundaries, readBoundaries } from './mapBoundaries'
import type { Coordinates, GeoBoundary, Polygon } from './mapBoundaries'
import { atlasStyle, atlasUrl, reliefUrl } from './tiandituStyle'
import { connectImagery, type Basemap } from './tiandituImagery'
import type { TwinId } from './twinSites'
import 'maplibre-gl/dist/maplibre-gl.css'
import './tianditu-map.css'

type View = '2d' | '3d'
type Props = {
  area: CockpitArea
  viewMode: View
  onViewModeChange: (mode: View) => void
  onSelectArea: (id: string) => void
  onOpenTwin: (id: TwinId) => void
}
type Pin = { id: string; name: string; point: Coordinates; boundary?: GeoBoundary }
type AreaGeometry = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
const token = (import.meta.env.VITE_TIANDITU_TOKEN as string | undefined)?.trim()
const featured = new Set(['zhaitang', 'qingshui', 'datai', 'miaofengshan'])
const empty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] })
const twinPoint: Coordinates = [116.122, 39.901]

async function readAtlas(signal: AbortSignal) {
  const response = await fetch(atlasUrl, { signal })
  if (!response.ok) throw new Error('区域底图暂不可用')
  const data = await response.json() as AreaGeometry
  const region = data.features.find(({ properties }) => properties?.kind === 'district')
  if (!region) throw new Error('缺少区界')
  const mask = region.geometry.type === 'Polygon' ? [region.geometry.coordinates] : region.geometry.coordinates
  const towns = parseBoundaries({ ...data, features: data.features.filter(({ properties }) => properties?.kind === 'town') })
  return { data, towns, mask: mask as Polygon[] }
}

function AreaPin({ map, pin, children }: { map: MapLibreMap; pin: Pin; children: React.ReactNode }) {
  const [el] = useState(() => document.createElement('div'))
  useEffect(() => {
    const marker = new Marker({ element: el, subpixelPositioning: true }).setLngLat(pin.point).addTo(map)
    return () => { marker.remove() }
  }, [map, el, pin])
  return createPortal(children, el)
}

export default function TiandituMap({ area, viewMode, onViewModeChange, onSelectArea, onOpenTwin }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapLibreMap>()
  const [graphicsError, setGraphicsError] = useState(false)
  const [basemap, setBasemap] = useState<Basemap>(token ? 'connecting' : 'offline')
  const [reason, setReason] = useState<string>()
  const [zoom, setZoom] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [scope, setScope] = useState('')
  const reset = useRef<() => void>(() => {})
  const currentView = useRef(viewMode)
  const atlas = useQuery({ queryKey: ['district-atlas'], queryFn: ({ signal }) => readAtlas(signal), staleTime: Infinity })
  const town = area.breadcrumbs[1] && boundaryFor(area.breadcrumbs[1], atlas.data?.towns)
  const villages = useQuery({ queryKey: ['local-model-boundaries', town?.code], staleTime: Infinity,
    queryFn: town ? ({ signal }) => readBoundaries(signal, town.code) : skipToken })
  const village = area.level === 'village' && boundaryFor(area, villages.data)
  const focus = village || town || undefined
  const district = area.level === 'district'
  const places = useMemo<Pin[]>(() => {
    const candidates = district ? atlas.data?.towns : villages.data
    return area.children.flatMap(child => {
      const boundary = boundaryFor(child, candidates)
      return boundary ? [{ ...child, boundary, point: boundaryCenter(boundary) }] : []
    })
  }, [district, atlas.data, villages.data, area.children])
  const pins = useMemo(() => {
    const result = [...places]
    if (district) result.push({ id: 'population', name: '全区人口专题', point: [115.81, 40.042] })
    if (district || (focus && boundaryContains(focus, twinPoint))) {
      result.push({ id: 'landmarks', name: '重点地标', point: twinPoint })
    }
    return result
  }, [district, focus, places])
  const actions = useRef({ places, onSelectArea })
  useEffect(() => { actions.current = { places, onSelectArea } }, [places, onSelectArea])

  useEffect(() => {
    if (!host.current || !atlas.data) return
    let instance: MapLibreMap
    try {
      instance = new MapLibreMap({ container: host.current, style: atlasStyle(atlas.data.data), center: [115.80, 40],
        zoom: 9.2, minZoom: 7.5, maxZoom: 18, maxBounds: [[114.45, 39.2], [117.15, 40.82]],
        maxPitch: 65, renderWorldCopies: false, attributionControl: false, maxTileCacheSize: 72,
        canvasContextAttributes: { antialias: true }, pixelRatio: Math.min(2, window.devicePixelRatio || 1) })
    } catch {
      setGraphicsError(true)
      return
    }
    instance.addControl(new ScaleControl({ maxWidth: 82, unit: 'metric' }), 'bottom-left')
    instance.getCanvas().setAttribute('aria-label', '门头沟区域交互地图')
    instance.on('load', () => { setMap(instance); setZoom(instance.getZoom()) })
    instance.on('moveend', () => setZoom(instance.getZoom()))
    instance.on('click', event => {
      if ((event.originalEvent.target as Element | null)?.closest('button, a')) return
      const point: Coordinates = [event.lngLat.lng, event.lngLat.lat]
      const place = actions.current.places.find(pin => pin.boundary && boundaryContains(pin.boundary, point))
      if (place) actions.current.onSelectArea(place.id)
    })
    return () => { instance.remove(); setMap(undefined) }
  }, [atlas.data])

  useEffect(() => {
    if (!map || !token || !atlas.data) return
    setBasemap('connecting')
    setReason(undefined)
    return connectImagery(map, token, atlas.data.mask, (state, message) => { setBasemap(state); setReason(message) })
  }, [map, atlas.data, attempt])

  useEffect(() => {
    currentView.current = viewMode
    if (!map) return
    map.setTerrain(viewMode === '3d' ? { source: 'elevation', exaggeration: 1.35 } : null)
    map.jumpTo({ pitch: viewMode === '3d' ? 35 : 0, bearing: 0 })
    if (viewMode === '3d') { map.dragRotate.enable(); map.touchZoomRotate.enableRotation(); map.touchPitch.enable() }
    else { map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); map.touchPitch.disable() }
  }, [map, viewMode])

  useEffect(() => {
    if (!map || !frame.current || (!district && !town) || (area.level === 'village' && villages.isPending)) return
    const { west, south, east, north } = focus?.bounds ?? districtBounds
    const fit = () => {
      if (!frame.current) return
      const width = map.getContainer().clientWidth
      const height = map.getContainer().clientHeight
      const inset = Math.min(frame.current.offsetLeft, width * .28)
      const v = Math.min(65, Math.round(height * .11))
      const position = map.cameraForBounds([[west, south], [east, north]], {
        padding: { top: v, bottom: v, left: inset + 14, right: inset + 14 }, maxZoom: 16.8,
      })
      if (position) map.jumpTo({ ...position, pitch: currentView.current === '3d' ? 35 : 0 })
    }
    const rows = (items: GeoBoundary[]) => ({
      type: 'FeatureCollection' as const,
      features: items.map(item => ({ type: 'Feature' as const, properties: { name: item.name },
        geometry: { type: 'MultiPolygon' as const, coordinates: item.polygons } })),
    })
    map.getSource<GeoJSONSource>('focus')?.setData(focus ? rows([focus]) : empty())
    map.getSource<GeoJSONSource>('children')?.setData(!district && villages.data ? rows(villages.data) : empty())
    reset.current = fit
    const onResize = () => { map.resize(); fit() }
    const observer = new ResizeObserver(onResize)
    observer.observe(frame.current)
    fit()
    setScope(focus && area.level === 'village' && !village ? town?.code ?? '' : area.id)
    return () => { observer.disconnect() }
  }, [map, area.id, area.level, district, focus, town, village, villages.data, villages.isPending])

  const failed = graphicsError || atlas.isError
  const status = basemap === 'online' ? '天地图 · 卫星影像' : basemap === 'connecting' ? '正在连接天地图'
    : basemap === 'unavailable' ? (reason ?? '天地图暂不可用') + ' · 本地地形' : '本地地形 · 天地图未配置'
  return <section className="tianditu-map" data-basemap={basemap} data-view={viewMode} data-zoom={zoom.toFixed(3)}
    data-map-ready={failed ? 'unavailable' : map && scope ? 'ready' : 'loading'} data-map-scope={scope}
    aria-label={area.name + '区域地图'}>
    <div className="atlas-render" ref={host} />
    <div className="atlas-camera-frame" ref={frame} aria-hidden="true" />
    {failed && <div className="atlas-static"><img src={reliefUrl} alt="门头沟区地形概览" />
      <p role="status">{graphicsError ? '浏览器图形加速不可用' : '区界数据暂不可用'}</p></div>}
    {map && pins.map(pin => <AreaPin key={pin.id} map={map} pin={pin}>
      {pin.id === 'population' ? <a className="atlas-population" href="/workbench?topic=population"
        target="_blank" rel="noopener noreferrer" aria-label="查看全区人口专题">
        <span className="atlas-pin-dot" /><span className="atlas-callout"><small>全区常住人口</small>
          <strong>39.2 <em>万人</em></strong></span></a>
        : pin.id === 'landmarks' ? <div className="atlas-landmarks"><span className="atlas-pin-dot" />
          <nav aria-label="重点地标"><button type="button" onClick={() => onOpenTwin('tianjie')}>长安天街</button>
            <button type="button" onClick={() => onOpenTwin('jingxi')}>京西智谷</button></nav></div>
        : <button className="atlas-place" data-place={pin.id} data-featured={!district || featured.has(pin.id)}
          aria-label={'查看' + pin.name} onClick={() => onSelectArea(pin.id)}>
          <span className="atlas-pin-dot" /><span className="atlas-pin-label">{pin.name}</span></button>}
    </AreaPin>)}
    <div className="atlas-credit" aria-live="polite">{basemap === 'online'
      ? <a href="https://map.tianditu.gov.cn/" target="_blank" rel="noreferrer">© {status}</a>
      : <span>{status}</span>}
      {basemap === 'unavailable' && <button onClick={() => setAttempt(value => value + 1)}>重连</button>}
      {area.level === 'village' && !villages.isPending && !village && <span>当前显示镇街范围</span>}
    </div>
    {map && <MapGlobeControl view={viewMode} onViewChange={onViewModeChange} onReset={() => reset.current()} />}
  </section>
}
