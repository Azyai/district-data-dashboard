import type { IControl, Map as AtlasMap } from 'maplibre-gl'
import { districtBounds } from './mapBoundaries'

const nearMeters = 50
const farMeters = 5_000
const steps = [5_000, 3_000, 2_000, 1_000, 500, 300, 200, 100, 50]
const referenceLatitude = (districtBounds.north + districtBounds.south) / 2
// Use the district midpoint as the reference for the Web Mercator scale, so
// switching areas or tilting the camera keeps the same zoom endpoints.
const metersAtZoomZero = 2 * Math.PI * 6_371_008.8 * Math.cos(referenceLatitude * Math.PI / 180) / 512

export function createAtlasScale() {
  const scale = document.createElement('div')
  scale.className = 'maplibregl-ctrl atlas-scale'
  const label = document.createElement('span')
  const line = document.createElement('i')
  line.setAttribute('aria-hidden', 'true')
  scale.append(label, line)
  let width = 82
  let current: AtlasMap | undefined

  function update() {
    if (!current) return
    const metersPerPixel = metersAtZoomZero / 2 ** current.getZoom()
    const available = width * metersPerPixel
    const distance = steps.find(step => step <= available + 1e-6) ?? nearMeters
    label.textContent = distance >= 1000 ? distance / 1000 + ' km' : distance + ' m'
    scale.dataset.meters = String(distance)
    line.style.width = distance / metersPerPixel + 'px'
  }

  const control: IControl = {
    onAdd(map) {
      current = map
      map.on('move', update)
      update()
      return scale
    },
    onRemove() {
      current?.off('move', update)
      current = undefined
      scale.remove()
    },
  }

  return {
    control,
    setOverviewZoom(map: AtlasMap, overviewZoom: number) {
      // A shorter scale on narrow screens still leaves room for the full district.
      width = Math.min(82, farMeters * 2 ** overviewZoom / metersAtZoomZero)
      const minimum = Math.log2(width * metersAtZoomZero / farMeters)
      const maximum = Math.log2(width * metersAtZoomZero / nearMeters)
      map.setMinZoom(minimum)
      map.setMaxZoom(maximum)
      update()
    },
  }
}
