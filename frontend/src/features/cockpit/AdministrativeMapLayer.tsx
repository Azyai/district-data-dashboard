import { useEffect, useState } from 'react'
import { LngLatBounds } from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import './administrative-map.css'

type Level = 'district' | 'town' | 'village' | 'grid' | 'building'
type Position = [number, number]
type AreaProps = {
  code: string; name: string; hasChildren: boolean
  town?: string; community?: string; grid?: string; floors?: number; areaM2?: number
}
type AreaFeature = {
  type: 'Feature'
  properties: AreaProps
  geometry: { type: 'Polygon'; coordinates: Position[][] } | { type: 'MultiPolygon'; coordinates: Position[][][] }
}
type Collection = { type: 'FeatureCollection'; features: AreaFeature[] }
type AreaView = { level: Level; parent: string; label: string; bounds?: LngLatBounds }
type Props = {
  map: MapLibreMap
  mode: '2d' | '3d'
  onFit: (bounds: LngLatBounds) => void
  onOpenTown: (name: string) => void
  onDistrictOutline: (outline?: Collection) => void
}

const dataUrl = import.meta.env.BASE_URL + 'maps/local-model/data/'
const source = 'mentougou-administration'
const fill = 'mentougou-administrative-fill'
const line = 'mentougou-administrative-line'
const selected = 'mentougou-administrative-highlight'
const buildings = 'mentougou-administrative-buildings'
const empty: Collection = { type: 'FeatureCollection', features: [] }
const levels: Record<Level, { label: string; next?: Level; file: (parent: string) => string }> = {
  district: { label: '区级', next: 'town', file: () => 'district.geojson' },
  town: { label: '镇街', next: 'village', file: () => 'towns.geojson' },
  village: { label: '村居', next: 'grid', file: parent => `villages/${parent}.geojson` },
  grid: { label: '微网格', next: 'building', file: parent => `grids/${parent}.geojson` },
  building: { label: '楼房', file: parent => `buildings/${parent}.geojson` },
}

function boundary(feature: AreaFeature) {
  const bounds = new LngLatBounds()
  const { geometry } = feature
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()
  for (const ring of rings) for (const position of ring) bounds.extend(position)
  return bounds
}

function installLayers(map: MapLibreMap) {
  map.addSource(source, { type: 'geojson', data: empty })
  const label = map.getStyle().layers.find(layer => layer.type === 'symbol')?.id
  map.addLayer({ id: fill, type: 'fill', source, paint: { 'fill-color': '#227db3', 'fill-opacity': .19 } }, label)
  map.addLayer({ id: line, type: 'line', source, paint: { 'line-color': '#4da9d0', 'line-opacity': .86, 'line-width': 1.6 } }, label)
  map.addLayer({
    id: buildings, type: 'fill-extrusion', source, layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': '#4cb7e3',
      'fill-extrusion-height': ['*', ['to-number', ['get', 'floors'], 0], 3],
      'fill-extrusion-opacity': .83,
    },
  }, label)
  map.addLayer({
    id: selected, type: 'line', source, filter: ['==', ['get', 'code'], ''],
    paint: { 'line-color': '#faf4b8', 'line-width': 3, 'line-opacity': .96 },
  })
}

async function readLevel(view: AreaView, signal: AbortSignal) {
  if (!/^\d{6,15}$/.test(view.parent)) throw new Error('Invalid administrative area code')
  const response = await fetch(dataUrl + levels[view.level].file(view.parent), { signal })
  if (!response.ok) throw new Error('Administrative geometry unavailable')
  const collection = await response.json() as Collection
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Invalid geometry')
  return collection
}

export default function AdministrativeMapLayer({ map, mode, onFit, onOpenTown, onDistrictOutline }: Props) {
  const [path, setPath] = useState<AreaView[]>([{ level: 'district', parent: '110109', label: '门头沟区' }])
  const [content, setContent] = useState<Collection>(empty)
  const [picked, setPicked] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const view = path[path.length - 1]
  const feature = content.features.find(item => item.properties.code === picked)
  const detail = feature?.properties
  const level = levels[view.level]

  useEffect(() => {
    installLayers(map)
    const choose = (event: MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(event.point, { layers: [buildings, fill] })[0]
      if (typeof hit?.properties?.code === 'string') setPicked(hit.properties.code)
    }
    map.on('click', choose)
    return () => {
      map.off('click', choose)
      if (!map.getStyle()) return
      onDistrictOutline()
      for (const id of [selected, buildings, line, fill]) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(source)) map.removeSource(source)
    }
  }, [map, onDistrictOutline])

  useEffect(() => {
    const pending = new AbortController()
    void readLevel(view, pending.signal).then(items => {
      if (pending.signal.aborted) return
      setContent(items)
      setPicked(items.features.length === 1 ? items.features[0].properties.code : '')
      setPhase('ready')
      if (view.level === 'district') onDistrictOutline(items)
    }).catch(() => {
      if (!pending.signal.aborted) setPhase('unavailable')
    })
    return () => pending.abort()
  }, [view, onDistrictOutline])

  useEffect(() => {
    map.getSource<GeoJSONSource>(source)?.setData(content)
  }, [map, content])

  useEffect(() => {
    if (map.getLayer(selected)) map.setFilter(selected, ['==', ['get', 'code'], picked])
    if (map.getLayer(buildings)) map.setLayoutProperty(buildings, 'visibility', view.level === 'building' && mode === '3d' ? 'visible' : 'none')
  }, [map, mode, picked, view.level])

  function show(next: AreaView[]) {
    setContent(empty)
    setPicked('')
    setPhase('loading')
    setPath(next)
  }

  function descend() {
    if (!feature || !detail?.hasChildren || !level.next) return
    const bounds = boundary(feature)
    if (!bounds.isEmpty() && view.level !== 'district') onFit(bounds)
    show([...path, { level: level.next, parent: detail.code, label: detail.name, bounds }])
  }

  function ascend() {
    const previous = path.slice(0, -1)
    const previousBounds = previous.at(-1)?.bounds
    if (previousBounds && !previousBounds.isEmpty()) onFit(previousBounds)
    show(previous)
  }

  function choose(code: string) {
    setPicked(code)
    const chosen = content.features.find(item => item.properties.code === code)
    if (chosen && view.level !== 'district') {
      const bounds = boundary(chosen)
      if (!bounds.isEmpty()) onFit(bounds)
    }
  }

  return (
    <aside className="administrative-map-panel" aria-label="行政区划要素" data-geography-level={view.level} data-geography-ready={phase}>
      <div className="administrative-map-heading">
        <strong>{level.label}</strong>
        {path.length > 1 && <button type="button" onClick={ascend}>返回上一级</button>}
      </div>
      {view.level !== 'district' && <p className="administrative-map-parent">{view.label}</p>}
      {phase === 'loading' && <p role="status">正在读取{level.label}边界</p>}
      {phase === 'unavailable' && <p role="status">本地区划数据暂不可用</p>}
      {phase === 'ready' && (
        <>
          <select aria-label={`选择${level.label}要素`} value={picked} onChange={event => choose(event.target.value)}>
            <option value="">选择{level.label}</option>
            {content.features.map(item => <option key={item.properties.code} value={item.properties.code}>{item.properties.name}</option>)}
          </select>
          {detail && (
            <dl className="administrative-map-details">
              <dt>编码</dt><dd>{detail.code}</dd>
              {detail.town && <><dt>镇街</dt><dd>{detail.town}</dd></>}
              {detail.community && <><dt>村居</dt><dd>{detail.community}</dd></>}
              {detail.grid && <><dt>网格</dt><dd>{detail.grid}</dd></>}
              {typeof detail.floors === 'number' && <><dt>层数</dt><dd>{detail.floors} 层</dd></>}
              {typeof detail.areaM2 === 'number' && <><dt>面积</dt><dd>{detail.areaM2.toLocaleString('zh-CN')} 平方米</dd></>}
            </dl>
          )}
          <div className="administrative-map-actions">
            {detail?.hasChildren && level.next && <button type="button" onClick={descend}>查看{levels[level.next].label}</button>}
            {detail && view.level === 'town' && <button type="button" onClick={() => onOpenTown(detail.name)}>打开镇街驾驶舱</button>}
          </div>
          {view.level === 'building' && mode === '3d' && <p className="administrative-map-note">三维高度按层数估算</p>}
        </>
      )}
    </aside>
  )
}
