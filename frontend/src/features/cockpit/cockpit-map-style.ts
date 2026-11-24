import type { StyleSpecification } from 'maplibre-gl'

const land = '#1a3045'
const labelHalo = '#13263a'

const fills: Record<string, string> = {
  aeroway: '#263f55',
  building: '#3c5971',
  landcover: '#223e4b',
  landuse: '#243b4e',
  park: '#224953',
  water: '#205b80',
}

function roadColor(id: string) {
  if (id.endsWith('_casing')) return '#162839'
  if (/motorway|trunk_primary/.test(id)) return '#e7bd83'
  if (/secondary_tertiary|_ramp|_link/.test(id)) return '#a8a99b'
  if (id.includes('rail')) return '#8198ae'
  return '#536e83'
}

export function styleCockpitBasemap(style: StyleSpecification) {
  for (const layer of style.layers) {
    const source = 'source-layer' in layer ? layer['source-layer'] ?? '' : ''
    switch (layer.type) {
      case 'background':
        layer.paint = { ...layer.paint, 'background-color': land }
        break
      case 'raster':
        if (layer.id === 'natural_earth') layer.layout = { ...layer.layout, visibility: 'none' }
        break
      case 'fill': {
        const color = layer.id === 'landcover_wood' ? '#214551' : fills[source]
        if (color) layer.paint = { ...layer.paint, 'fill-color': color, 'fill-outline-color': color }
        if (layer.id === 'road_area_pattern') layer.layout = { ...layer.layout, visibility: 'none' }
        break
      }
      case 'fill-extrusion':
        if (source === 'building') {
          layer.layout = { ...layer.layout, visibility: 'none' }
          layer.paint = { ...layer.paint, 'fill-extrusion-color': '#6786a1' }
        }
        break
      case 'line':
        if (source === 'boundary') {
          layer.layout = { ...layer.layout, visibility: 'none' }
          break
        }
        layer.paint = { ...layer.paint, 'line-color': source === 'transportation' ? roadColor(layer.id)
          : source === 'waterway' ? '#5aaac5' : '#3d6579' }
        break
      case 'symbol': {
        if (!layer.layout?.['text-field']) break
        if (JSON.stringify(layer.layout['text-field']).includes('name:nonlatin')) {
          layer.layout['text-field'] = [
            'coalesce', ['get', 'name:zh'], ['get', 'name:nonlatin'], ['get', 'name'], ['get', 'name:latin'], '',
          ]
        }
        const isShield = layer.id.startsWith('highway-shield') || layer.id === 'road_shield_us'
        if (isShield) {
          delete layer.layout['icon-image']
          layer.layout['text-optional'] = false
        }
        if (source === 'poi') layer.minzoom = Math.max(layer.minzoom ?? 0, 13)
        layer.paint = {
          ...layer.paint,
          'text-color': isShield ? '#ffdda4' : source.startsWith('water') ? '#a0deec' : '#e5eef6',
          'text-halo-color': labelHalo,
          'text-halo-width': isShield ? 1.6 : 1.15,
        }
        break
      }
    }
  }
  return style
}
