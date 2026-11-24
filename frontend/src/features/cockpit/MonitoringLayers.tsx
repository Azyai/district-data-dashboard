import { useEffect, useRef } from 'react'
import type { FeatureCollection, Point } from 'geojson'
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { modelAreaName } from './mapBoundaries'
import type { Coordinates } from './mapBoundaries'
import { roadColors } from './monitoringData'
import type { MonitorArea, MonitorPage, MonitoringSnapshot } from './monitoringData'

export const detailLayers = ['monitor-road', 'monitor-water']
const source = 'monitor-source'

type Props = {
  map: MapLibreMap
  topic: MonitorPage
  area: MonitorArea
  data: MonitoringSnapshot
  selected: string
  status: string
}

function regionFilter(area: MonitorArea, villageField: 'name' | 'village'): ExpressionSpecification | boolean {
  if (area.level === 'district') return true
  const name = modelAreaName(area)
  if (area.level === 'town') return ['==', ['get', 'town'], name]

  const town = area.breadcrumbs?.[1]?.name
  if (!town) return false
  return ['all', ['==', ['get', 'town'], town], ['==', ['get', villageField], name]]
}

export default function MonitoringLayers({ map, topic, area, data, selected, status }: Props) {
  const previousSelection = useRef('')

  useEffect(() => {
    if (topic === 'roads') {
      map.addSource(source, {
        type: 'geojson',
        data: import.meta.env.BASE_URL + 'monitoring/roads.geojson',
        tolerance: .22,
      })
      map.addLayer({
        id: 'monitor-road', type: 'line', source,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.1, 12, 2.2, 16, 5],
          'line-opacity': .84,
        },
      })
      map.addLayer({
        id: 'monitor-highlight', type: 'line', source,
        filter: false,
        paint: { 'line-color': '#fff3ab', 'line-width': 5 },
      })
    } else if (topic === 'grid') {
      map.addSource(source, {
        type: 'geojson',
        data: import.meta.env.BASE_URL + 'monitoring/grid.geojson',
        tolerance: .25,
      })
      map.addLayer({
        id: 'monitor-grid', type: 'line', source,
        paint: {
          'line-color': '#58e7d1',
          'line-opacity': .7,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, .55, 14, 1.6],
        },
      })
    } else {
      map.addSource(source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'monitor-water', type: 'circle', source,
        paint: {
          'circle-color': '#32bde1',
          'circle-radius': 5,
          'circle-stroke-color': '#dafcff',
          'circle-stroke-width': 1.2,
          'circle-opacity': .92,
        },
      })
    }

    return () => {
      if (!map.getStyle()) return
      for (const layer of ['monitor-highlight', 'monitor-road', 'monitor-water', 'monitor-grid']) {
        if (map.getLayer(layer)) map.removeLayer(layer)
      }
      if (map.getSource(source)) map.removeSource(source)
    }
  }, [map, topic])

  useEffect(() => {
    if (topic === 'roads') {
      const region = regionFilter(area, 'village')
      const raw: ExpressionSpecification = ['*', ['get', 'congestion'], data.factor]
      const index: ExpressionSpecification = ['/', ['round', ['*', raw, 100]], 100]
      const congestion: ExpressionSpecification = ['step', index, '畅通', 1.6, '缓行', 2.2, '拥堵', 3.2, '严重拥堵']
      const visible: ExpressionSpecification | boolean = status ? ['all', region, ['==', congestion, status]] : region
      map.setFilter('monitor-road', visible)
      map.setFilter('monitor-highlight', ['all', visible, ['==', ['get', 'name'], selected]])
      map.setPaintProperty('monitor-road', 'line-color', [
        'match', congestion,
        '畅通', roadColors.畅通,
        '缓行', roadColors.缓行,
        '拥堵', roadColors.拥堵,
        roadColors.严重拥堵,
      ])
    } else if (topic === 'grid') {
      map.setFilter('monitor-grid', regionFilter(area, 'name'))
    } else {
      const features: FeatureCollection<Point> = {
        type: 'FeatureCollection',
        features: data.waters.map(site => ({
          type: 'Feature',
          properties: { name: site.name },
          geometry: { type: 'Point', coordinates: [site.lon, site.lat] },
        })),
      }
      const active: ExpressionSpecification = ['==', ['get', 'name'], selected]
      map.getSource<GeoJSONSource>(source)?.setData(features)
      map.setPaintProperty('monitor-water', 'circle-radius', ['case', active, 10, 5])
      map.setPaintProperty('monitor-water', 'circle-color', ['case', active, '#ffe29a', '#32bde1'])
    }

    const scope = [topic, area.id, selected].join('/')
    if (selected && previousSelection.current !== scope) {
      let point: Coordinates | undefined
      if (topic === 'waters') {
        const site = data.waters.find(item => item.name === selected)
        if (site) point = [site.lon, site.lat]
      } else if (topic === 'grid') {
        point = data.villages.find(item => item.name === selected)?.point
      } else {
        point = data.roads.find(item => item.name === selected)?.point
      }
      if (point) map.easeTo({ center: point, zoom: Math.max(13, map.getZoom()), duration: 450 })
    }
    previousSelection.current = scope
  }, [area, data, selected, status, map, topic])

  return null
}
