import { skipToken, useQuery } from '@tanstack/react-query'
import { Map as MapLibreMap, Marker } from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import type * as GeoJSON from 'geojson'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CockpitArea, CockpitDirectory } from '../../api/client'
import { createAtlasScale } from './atlasScale'
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
  directory?: CockpitDirectory
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
const districtBox: [Coordinates, Coordinates] = [[districtBounds.west, districtBounds.south], [districtBounds.east, districtBounds.north]]
const initialPitch = 35

function readCamera(map: MapLibreMap) {
  return { zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
}

function mapPlaces(areas: Array<{ id: string; name: string }>, boundaries?: GeoBoundary[]): Pin[] {
  return areas.flatMap(area => {
    const boundary = boundaryFor(area, boundaries)
    return boundary ? [{ ...area, boundary, point: boundaryCenter(boundary) }] : []
  })
}

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

export default function TiandituMap({ area, directory, viewMode, onViewModeChange, onSelectArea, onOpenTwin }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapLibreMap>()
  const [graphicsError, setGraphicsError] = useState(false)
  const [basemap, setBasemap] = useState<Basemap>(token ? 'connecting' : 'offline')
  const [reason, setReason] = useState<string>()
  const [camera, setCamera] = useState({ zoom: 0, pitch: 0, bearing: 0 })
  const [attempt, setAttempt] = useState(0)
  const [scope, setScope] = useState('')
  const reset = useRef<() => void>(() => {})
  const scale = useRef<ReturnType<typeof createAtlasScale> | undefined>(undefined)
  const currentView = useRef(viewMode)
  const last3dPose = useRef({ bearing: 0, pitch: initialPitch })
  const atlas = useQuery({ queryKey: ['district-atlas'], queryFn: ({ signal }) => readAtlas(signal), staleTime: Infinity })
  const town = area.breadcrumbs[1] && boundaryFor(area.breadcrumbs[1], atlas.data?.towns)
  const villages = useQuery({ queryKey: ['local-model-boundaries', town?.code], staleTime: Infinity,
    queryFn: town ? ({ signal }) => readBoundaries(signal, town.code) : skipToken })
  const village = area.level === 'village' && boundaryFor(area, villages.data)
  const focus = village || town || undefined
  const district = area.level === 'district'
  const townId = area.breadcrumbs[1]?.id
  const towns = useMemo(() => mapPlaces(directory?.filter(location => location.level === 'town')
    ?? (district ? area.children : []), atlas.data?.towns), [directory, district, area.children, atlas.data])
  const nearbyVillages = useMemo(() => mapPlaces(directory?.filter(location => location.level === 'village' && location.parentId === townId)
    ?? (area.level === 'town' ? area.children : []), villages.data), [area.children, area.level, directory, townId, villages.data])
  const places = district ? towns : nearbyVillages
  const pins = useMemo(() => {
    const result = [...places]
    if (district) result.push({ id: 'population', name: '全区人口专题', point: [115.81, 40.042] })
    if (district || (focus && boundaryContains(focus, twinPoint))) {
      result.push({ id: 'landmarks', name: '重点地标', point: twinPoint })
    }
    return result
  }, [district, focus, places])
  const actions = useRef({ towns, nearbyVillages, townId, areaId: area.id, onSelectArea })
  useEffect(() => {
    actions.current = { towns, nearbyVillages, townId, areaId: area.id, onSelectArea }
  }, [towns, nearbyVillages, townId, area.id, onSelectArea])

  useEffect(() => {
    if (!host.current || !atlas.data) return
    let instance: MapLibreMap
    try {
      instance = new MapLibreMap({ container: host.current, style: atlasStyle(atlas.data.data), center: [115.80, 40],
        zoom: 9.2, minZoom: 7.5, maxZoom: 18, maxBounds: [[114.45, 39.2], [117.15, 40.82]],
        maxPitch: 65, renderWorldCopies: false, attributionControl: false, trackResize: false, maxTileCacheSize: 72,
        canvasContextAttributes: { antialias: true }, pixelRatio: Math.min(2, window.devicePixelRatio || 1) })
    } catch {
      setGraphicsError(true)
      return
    }
    const mapScale = createAtlasScale()
    scale.current = mapScale
    instance.addControl(mapScale.control, 'bottom-left')
    instance.getCanvas().setAttribute('aria-label', '门头沟区域交互地图')
    instance.on('load', () => { setMap(instance); setCamera(readCamera(instance)) })
    instance.on('moveend', () => setCamera(readCamera(instance)))
    function placeAt(point: Coordinates) {
      const { towns, nearbyVillages, townId, areaId } = actions.current
      const contains = (pin: Pin) => pin.boundary && boundaryContains(pin.boundary, point)
      const place = nearbyVillages.find(contains) ?? towns.find(contains)
      return place && place.id !== areaId && place.id !== townId ? place : undefined
    }
    instance.on('mousemove', event => {
      if (!instance.isMoving()) instance.getCanvas().style.cursor = placeAt([event.lngLat.lng, event.lngLat.lat]) ? 'pointer' : ''
    })
    instance.on('click', event => {
      if ((event.originalEvent.target as Element | null)?.closest('button, a')) return
      const place = placeAt([event.lngLat.lng, event.lngLat.lat])
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
    if (map && currentView.current === '3d' && viewMode === '2d') {
      last3dPose.current = { bearing: map.getBearing(), pitch: map.getPitch() }
    }
    currentView.current = viewMode
    if (!map) return
    map.setTerrain(viewMode === '3d' ? { source: 'elevation', exaggeration: 1.35 } : null)
    map.jumpTo(viewMode === '3d' ? last3dPose.current : { pitch: 0, bearing: 0 })
    if (viewMode === '3d') { map.dragRotate.enable(); map.touchZoomRotate.enableRotation(); map.touchPitch.enable() }
    else { map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); map.touchPitch.disable() }
  }, [map, viewMode])

  useEffect(() => {
    if (!map || !frame.current || (!district && !town) || (area.level === 'village' && villages.isPending)) return
    const { west, south, east, north } = focus?.bounds ?? districtBounds
    const padding = () => {
      const width = map.getContainer().clientWidth
      const height = map.getContainer().clientHeight
      const inset = Math.min(frame.current?.offsetLeft ?? 0, width * .28)
      const v = Math.min(65, Math.round(height * .11))
      return { top: v, bottom: v, left: inset + 14, right: inset + 14 }
    }
    const fit = () => {
      const position = map.cameraForBounds([[west, south], [east, north]], {
        padding: padding(), maxZoom: map.getMaxZoom(),
      })
      if (position) map.jumpTo({ ...position, pitch: currentView.current === '3d' ? initialPitch : 0 })
    }
    const rows = (items: GeoBoundary[]) => ({
      type: 'FeatureCollection' as const,
      features: items.map(item => ({ type: 'Feature' as const, properties: { name: item.name },
        geometry: { type: 'MultiPolygon' as const, coordinates: item.polygons } })),
    })
    map.getSource<GeoJSONSource>('focus')?.setData(focus ? rows([focus]) : empty())
    map.getSource<GeoJSONSource>('children')?.setData(!district && villages.data ? rows(villages.data) : empty())
    reset.current = fit
    const onResize = () => {
      map.resize()
      const overview = map.cameraForBounds(districtBox, { padding: padding() })
      if (overview?.zoom !== undefined) scale.current?.setOverviewZoom(map, overview.zoom)
    }
    const observer = new ResizeObserver(onResize)
    observer.observe(frame.current)
    onResize()
    fit()
    setScope(area.id)
    return () => { observer.disconnect() }
  }, [map, area.id, area.level, district, focus, town, village, villages.data, villages.isPending])

  const failed = graphicsError || atlas.isError
  const status = basemap === 'connecting' ? '正在连接天地图'
    : basemap === 'unavailable' ? (reason ?? '天地图暂不可用') + ' · 本地地形'
      : basemap === 'offline' ? '本地地形 · 天地图未配置' : undefined
  const pendingBoundary = area.level === 'village' && !villages.isPending && !village
  return <section className="tianditu-map" data-basemap={basemap} data-view={viewMode} data-zoom={camera.zoom.toFixed(3)}
    data-bearing={camera.bearing.toFixed(1)} data-pitch={camera.pitch.toFixed(1)}
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
          aria-label={'查看' + pin.name} aria-current={pin.id === area.id ? 'location' : undefined}
          onClick={() => { if (pin.id !== area.id) onSelectArea(pin.id) }}>
          <span className="atlas-pin-dot" /><span className="atlas-pin-label">{pin.name}</span></button>}
    </AreaPin>)}
    {(status || pendingBoundary) && <div className="atlas-status" aria-live="polite">{status && <span>{status}</span>}
      {basemap === 'unavailable' && <button onClick={() => setAttempt(value => value + 1)}>重连</button>}
      {pendingBoundary && <span>当前显示镇街范围</span>}
    </div>}
    {map && <MapGlobeControl view={viewMode} onViewChange={onViewModeChange} onReset={() => reset.current()}
      attribution={basemap === 'online' ? <a href="https://map.tianditu.gov.cn/" target="_blank" rel="noreferrer">© 天地图</a> : undefined}
      orientation={{ bearing: camera.bearing, pitch: camera.pitch, onChange: pose => { map.jumpTo(pose) } }} />}
  </section>
}
