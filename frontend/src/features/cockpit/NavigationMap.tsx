import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AttributionControl, LngLatBounds, Map as MapLibreMap, Marker, ScaleControl } from 'maplibre-gl'
import type { PaddingOptions, RasterDEMSourceSpecification, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { styleCockpitBasemap } from './cockpit-map-style'
import DistrictMap from './DistrictMap'
import { attachDistrictViewportMask } from './district-viewport-mask'
import './navigation-map.css'

type Position = [number, number]
type Town = { id: string; name: string }
type Feature = {
  type: 'Feature'
  properties: { kind?: string; id?: string; name?: string }
  geometry: { type: 'Polygon'; coordinates: Position[][] }
    | { type: 'MultiPolygon'; coordinates: Position[][][] }
    | { type: 'Point'; coordinates: Position }
    | { type: 'LineString' | 'MultiLineString'; coordinates: unknown }
}
type Outline = {
  type: 'FeatureCollection'
  features: Array<Feature & { geometry: Extract<Feature['geometry'], { type: 'Polygon' | 'MultiPolygon' }> }>
}
type Place = { id?: string; name?: string; point: Position }
type District = { bounds: LngLatBounds; outline: Outline; places: Place[] }
type MapMode = '2d' | '3d'
type MapPhase = 'loading' | 'ready' | 'fallback'
type Camera = { pitch: number; zoom: number }
type Props = { areas: readonly Town[]; onSelectArea: (id: string) => void; fallback?: ReactNode }

const mapStyleUrl = 'https://tiles.openfreemap.org/styles/liberty'
const districtUrl = import.meta.env.BASE_URL + 'maps/mentougou.geojson'
const baseSource = 'openmaptiles'
const districtSource = 'mentougou-outline'
const elevationSource = 'mentougou-elevation'
const reliefSource = 'mentougou-relief'
const reliefLayer = 'mentougou-hillshade'
const buildingLayer = 'building-3d'
const imageryLayer = 'mentougou-sentinel-2'
const imageryUrl = import.meta.env.BASE_URL + 'maps/mentougou-sentinel-2-20261008.webp'
const imageryAttribution = '<a href="https://ewds.climate.copernicus.eu/licences/ec-sentinel" target="_blank" rel="noreferrer">Contains modified Copernicus Sentinel data 2026</a>'
const elevationTiles: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
  tileSize: 256,
  maxzoom: 14,
  encoding: 'terrarium',
}
const vectorAttribution = '<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a>'
  + ' © <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a>'
  + ' Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>'
const elevationAttribution = '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noreferrer">Mapzen / USGS SRTM</a>'

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Map resource request failed')
  return response.json()
}

async function readStyle(signal: AbortSignal) {
  const style = await readJson(mapStyleUrl, signal) as StyleSpecification
  if (style.version !== 8 || !Array.isArray(style.layers) || style.sources?.[baseSource]?.type !== 'vector') {
    throw new Error('Unexpected online map style')
  }
  style.sources[baseSource] = { ...style.sources[baseSource], attribution: vectorAttribution }
  return styleCockpitBasemap(style)
}

async function readDistrict(signal: AbortSignal): Promise<District> {
  const data = await readJson(districtUrl, signal) as { type?: string; features?: Feature[] }
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Unexpected district map')
  const bounds = new LngLatBounds()
  const outline: Outline = { type: 'FeatureCollection', features: [] }
  const places: Place[] = []
  for (const feature of data.features) {
    if (feature.properties?.kind === 'place' && feature.geometry.type === 'Point') {
      places.push({ id: feature.properties.id, name: feature.properties.name, point: feature.geometry.coordinates })
    }
    if (feature.properties?.kind === 'boundary'
      && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
      const { geometry } = feature
      outline.features.push({ ...feature, geometry })
      const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()
      for (const ring of rings) for (const position of ring) bounds.extend(position)
    }
  }
  if (bounds.isEmpty()) throw new Error('Missing district boundary')
  return { bounds, outline, places }
}

function framePadding(container: HTMLElement, frame: HTMLElement): PaddingOptions {
  const inset = Math.min(24, Math.floor(frame.clientWidth * .055))
  return {
    left: frame.offsetLeft + inset,
    right: Math.max(0, container.clientWidth - frame.offsetLeft - frame.clientWidth) + inset,
    top: frame.offsetTop + inset,
    bottom: Math.max(0, container.clientHeight - frame.offsetTop - frame.clientHeight) + inset,
  }
}

function tileArea(bounds: LngLatBounds): [number, number, number, number] {
  return [bounds.getWest() - .04, bounds.getSouth() - .03, bounds.getEast() + .04, bounds.getNorth() + .03]
}

function addOutline(map: MapLibreMap, outline: Outline) {
  map.addSource(districtSource, { type: 'geojson', data: outline })
  const firstLabel = map.getStyle().layers.find(layer => layer.type === 'symbol')?.id
  map.addLayer({
    id: 'mentougou-context', source: districtSource, type: 'fill',
    paint: { 'fill-color': '#4788b5', 'fill-opacity': .085 },
  }, firstLabel)
  map.addLayer({
    id: 'mentougou-boundary-halo', source: districtSource, type: 'line',
    layout: { 'line-join': 'round' },
    paint: { 'line-color': '#3c9eca', 'line-width': 5, 'line-opacity': .3, 'line-blur': 1.2 },
  }, firstLabel)
  map.addLayer({
    id: 'mentougou-boundary', source: districtSource, type: 'line',
    layout: { 'line-join': 'round' },
    paint: { 'line-color': '#88d6eb', 'line-width': 1.5, 'line-opacity': .93 },
  }, firstLabel)
}

function showRelief(map: MapLibreMap, bounds: LngLatBounds) {
  const tiles = { ...elevationTiles, bounds: tileArea(bounds) }
  map.addSource(elevationSource, { ...tiles, attribution: elevationAttribution })
  map.addSource(reliefSource, tiles)
  const waterway = map.getStyle().layers.find(layer => layer.type === 'line' && layer['source-layer'] === 'waterway')?.id
  map.addLayer({
    id: reliefLayer, source: reliefSource, type: 'hillshade',
    paint: {
      'hillshade-shadow-color': '#0b1829',
      'hillshade-highlight-color': '#81bad3',
      'hillshade-accent-color': '#203e53',
      'hillshade-exaggeration': .49,
      'hillshade-illumination-anchor': 'map',
    },
  }, waterway)
  map.setTerrain({ source: elevationSource, exaggeration: 1 })
}

function hideRelief(map: MapLibreMap) {
  map.setTerrain(null)
  map.removeLayer(reliefLayer)
  map.removeSource(reliefSource)
  map.removeSource(elevationSource)
}

function setImageryLayer(map: MapLibreMap, visible: boolean) {
  if (map.getLayer(imageryLayer)) {
    map.setLayoutProperty(imageryLayer, 'visibility', visible ? 'visible' : 'none')
    return
  }
  if (!visible) return
  map.addSource(imageryLayer, {
    type: 'image', url: imageryUrl,
    coordinates: [[115.405, 40.19], [116.181, 40.19], [116.181, 39.798], [115.405, 39.798]],
  })
  const before = map.getLayer(reliefLayer) ? reliefLayer
    : map.getStyle().layers.find(layer => layer.type === 'line' && layer['source-layer'] === 'waterway')?.id
  map.addLayer({
    id: imageryLayer, source: imageryLayer, type: 'raster',
    paint: { 'raster-brightness-min': .06, 'raster-fade-duration': 0 },
  }, before)
}

export default function NavigationMap({ areas, onSelectArea, fallback }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const mount = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const bounds = useRef<LngLatBounds | null>(null)
  const hasFullExtent = useRef(true)
  const elevationTimer = useRef<number | undefined>(undefined)
  const [district, setDistrict] = useState<District>()
  const [phase, setPhase] = useState<MapPhase>('loading')
  const [mode, setMode] = useState<MapMode>('2d')
  const [imagery, setImagery] = useState(false)
  const [camera, setCamera] = useState<Camera>({ pitch: 0, zoom: 0 })
  const [terrainNotice, setTerrainNotice] = useState(false)

  useEffect(() => {
    const container = root.current
    const host = mount.current
    const safe = frame.current
    if (!container || !host || !safe) return

    const controller = new AbortController()
    let cancelled = false
    let failed = false
    let map: MapLibreMap | null = null
    let observer: ResizeObserver | undefined
    let detachMask: (() => void) | undefined
    const release = () => {
      observer?.disconnect()
      detachMask?.()
      detachMask = undefined
      if (map) map.remove()
      map = null
      mapRef.current = null
      bounds.current = null
    }
    const fail = () => {
      if (cancelled || failed) return
      failed = true
      controller.abort()
      window.clearTimeout(timer)
      window.clearTimeout(elevationTimer.current)
      release()
      setMode('2d')
      setCamera({ pitch: 0, zoom: 0 })
      setTerrainNotice(false)
      setPhase('fallback')
    }
    const timer = window.setTimeout(fail, 12000)
    void Promise.all([readStyle(controller.signal), readDistrict(controller.signal)]).then(([style, local]) => {
      if (cancelled || controller.signal.aborted) return
      const source = style.sources[baseSource]
      if (source.type === 'vector') source.bounds = tileArea(local.bounds)
      const instance = new MapLibreMap({
        container: host,
        style,
        center: local.bounds.getCenter(),
        zoom: 10,
        minZoom: 7,
        maxZoom: 18,
        maxPitch: 58,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: true,
        locale: {
          'CooperativeGesturesHandler.WindowsHelpText': '按住 Ctrl 并滚动缩放地图',
          'CooperativeGesturesHandler.MacHelpText': '按住 ⌘ 并滚动缩放地图',
          'CooperativeGesturesHandler.MobileHelpText': '使用双指移动地图',
          'ScaleControl.Meters': '米',
          'ScaleControl.Kilometers': '千米',
        },
        renderWorldCopies: false,
        trackResize: false,
        attributionControl: false,
        localIdeographFontFamily: '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
      })
      map = instance
      mapRef.current = instance
      bounds.current = local.bounds
      detachMask = attachDistrictViewportMask(instance, local.outline)
      instance.keyboard.disableRotation()
      instance.touchZoomRotate.disableRotation()
      instance.getCanvas().setAttribute('aria-label', '北京市门头沟区导航地图')
      instance.addControl(new ScaleControl({ unit: 'metric', maxWidth: 92 }), 'bottom-left')
      instance.on('error', () => {
        // Tile and glyph failures can be transient. The basemap deadline handles a failed initial view.
      })
      instance.on('webglcontextlost', fail)
      const syncCamera = () => setCamera({
        pitch: Math.round(instance.getPitch() * 100) / 100,
        zoom: Math.round(instance.getZoom() * 100) / 100,
      })
      const fit = () => instance.fitBounds(local.bounds, { padding: framePadding(container, safe), duration: 0, maxZoom: 13.5 })
      instance.on('movestart', event => {
        if (event.originalEvent) hasFullExtent.current = false
      })
      instance.on('moveend', syncCamera)
      instance.once('style.load', () => {
        addOutline(instance, local.outline)
        setDistrict(local)
        syncCamera()
      })
      instance.on('sourcedata', event => {
        if (event.tile?.state !== 'loaded') return
        if (event.sourceId === baseSource) {
          window.clearTimeout(timer)
          setPhase('ready')
        }
        if (event.sourceId === elevationSource) window.clearTimeout(elevationTimer.current)
      })
      observer = new ResizeObserver(() => {
        instance.resize()
        if (hasFullExtent.current && safe.clientWidth > 0 && safe.clientHeight > 0) fit()
      })
      observer.observe(container)
      observer.observe(safe)
      fit()
    }).catch(fail)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
      window.clearTimeout(elevationTimer.current)
      release()
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || phase !== 'ready') return
    const control = new AttributionControl({ compact: false, customAttribution: imagery ? imageryAttribution : undefined })
    map.addControl(control, 'bottom-left')
    return () => {
      if (map.hasControl(control)) map.removeControl(control)
    }
  }, [imagery, phase])

  useEffect(() => {
    const map = mapRef.current
    const safe = frame.current
    if (!map || !safe || !district || phase !== 'ready') return
    const points = new Map(district.places.map(place => [place.id ?? place.name, place.point]))
    const markers = areas.flatMap(area => {
      const point = points.get(area.id) ?? points.get(area.name)
      if (!point) return []
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'navigation-map-pin'
      button.setAttribute('aria-label', area.name)
      const label = document.createElement('span')
      label.className = 'navigation-map-pin-label'
      label.textContent = area.name
      label.setAttribute('aria-hidden', 'true')
      button.append(label)
      button.addEventListener('click', () => onSelectArea(area.id))
      const marker = new Marker({ element: button, anchor: 'center', opacityWhenCovered: .65 })
        .setLngLat(point).addTo(map)
      return [{ marker, button, point, labelWidth: area.name.length * 12 + 12 }]
    })
    const measure = () => {
      const left = safe.offsetLeft
      const right = left + safe.clientWidth
      const top = safe.offsetTop
      const bottom = top + safe.clientHeight
      const pins = markers.map(({ point }) => map.project(point))
      const occupied = pins.map(({ x, y }) => [x - 8, y - 8, x + 8, y + 8])
      markers.forEach(({ button, labelWidth }, index) => {
        const { x, y } = pins[index]
        const inside = x > left + 8 && x < right - 8 && y > top + 8 && y < bottom - 8
        button.tabIndex = inside ? 0 : -1
        button.dataset.visible = String(inside)
        const candidates = [
          { side: 'east', box: [x + 10, y - 10, x + 10 + labelWidth, y + 10] },
          { side: 'west', box: [x - 10 - labelWidth, y - 10, x - 10, y + 10] },
        ]
        const placement = candidates.find(({ box: [a, b, c, d] }) =>
          a >= left && c <= right && b >= top && d <= bottom
          && !occupied.some(([e, f, g, h]) => a < g && c > e && b < h && d > f))
        button.dataset.side = (placement ?? candidates.find(({ box }) => box[2] <= right) ?? candidates[1]).side
        button.dataset.label = String(Boolean(inside && placement))
        if (inside && placement) occupied.push(placement.box)
      })
    }
    measure()
    map.on('moveend', measure)
    map.on('resize', measure)
    return () => {
      map.off('moveend', measure)
      map.off('resize', measure)
      for (const { marker } of markers) marker.remove()
    }
  }, [areas, district, onSelectArea, phase])

  function changeZoom(direction: number) {
    const map = mapRef.current
    if (!map) return
    hasFullExtent.current = false
    map.setZoom(map.getZoom() + direction)
  }

  function reset() {
    const map = mapRef.current
    if (!map || !bounds.current || !root.current || !frame.current) return
    hasFullExtent.current = true
    map.fitBounds(bounds.current, { padding: framePadding(root.current, frame.current), duration: 0, maxZoom: 13.5 })
  }

  function changeMode(next: MapMode) {
    const map = mapRef.current
    const districtBounds = bounds.current
    if (!map || !districtBounds || next === mode) return
    window.clearTimeout(elevationTimer.current)
    setTerrainNotice(false)
    if (next === '3d') {
      showRelief(map, districtBounds)
      elevationTimer.current = window.setTimeout(() => {
        if (mapRef.current !== map || !map.getSource(elevationSource)) return
        hideRelief(map)
        setTerrainNotice(true)
      }, 8000)
    } else if (map.getSource(elevationSource)) {
      hideRelief(map)
    }
    if (map.getLayer(buildingLayer)) map.setLayoutProperty(buildingLayer, 'visibility', next === '3d' ? 'visible' : 'none')
    map.jumpTo({ pitch: next === '3d' ? 52 : 0, bearing: 0 })
    setMode(next)
  }

  function toggleImagery() {
    const map = mapRef.current
    if (!map) return
    setImageryLayer(map, !imagery)
    setImagery(!imagery)
  }

  return (
    <div className="navigation-map" ref={root} data-map-mode={mode}
      data-map-ready={phase === 'ready' ? 'true' : phase} data-map-zoom={camera.zoom} data-map-pitch={camera.pitch}>
      <div ref={frame} className="district-map-frame" aria-hidden="true" />
      <div ref={mount} className="navigation-map-surface" hidden={phase === 'fallback'} />
      {phase === 'loading' && <div className="navigation-map-status" role="status">正在加载门头沟区底图</div>}
      {phase === 'fallback' && (
        <div className="navigation-map-fallback">
          <DistrictMap areas={areas} onSelectArea={onSelectArea} fallback={fallback} />
          <p className="navigation-map-status navigation-map-status-fallback" role="status">在线底图暂不可用，已切换本地地图</p>
        </div>
      )}
      {phase === 'ready' && (
        <>
          <div className="navigation-map-tools" aria-label="地图操作">
            <button type="button" aria-label="卫星影像" aria-pressed={imagery} onClick={toggleImagery}>影像</button>
            <div className="navigation-map-mode" aria-label="地图模式">
              <button type="button" aria-pressed={mode === '2d'} onClick={() => changeMode('2d')}>2D</button>
              <button type="button" aria-pressed={mode === '3d'} onClick={() => changeMode('3d')}>3D</button>
            </div>
            <div className="navigation-map-zoom" aria-label="地图缩放">
              <button type="button" aria-label="缩小地图" disabled={camera.zoom <= 7} onClick={() => changeZoom(-1)}>−</button>
              <button type="button" aria-label="放大地图" disabled={camera.zoom >= 18} onClick={() => changeZoom(1)}>+</button>
              <button type="button" onClick={reset}>全域</button>
            </div>
          </div>
          {terrainNotice && <p className="navigation-map-status navigation-map-status-fallback" role="status">高程暂不可用，已保留三维视角</p>}
        </>
      )}
    </div>
  )
}
