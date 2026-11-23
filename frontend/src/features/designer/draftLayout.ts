import type { ComponentData, Manifest } from '../../api/client'

export type ScreenComponent = Manifest['components'][number]
export type Geometry = ScreenComponent['geometry']
export type CanvasSize = Manifest['canvas']

export const maxComponents = 20

const minWidth = 160
const minHeight = 120
const maxLayer = 1000
const copyOffset = 24

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function canvasDelta(pixels: number, scale: number) {
  return Number.isFinite(pixels) && Number.isFinite(scale) && scale > 0 ? Math.round(pixels / scale) : 0
}

export function moveGeometry(geometry: Geometry, deltaX: number, deltaY: number, canvas: CanvasSize, scale = 1): Geometry {
  return {
    ...geometry,
    x: clamp(geometry.x + canvasDelta(deltaX, scale), 0, canvas.width - geometry.width),
    y: clamp(geometry.y + canvasDelta(deltaY, scale), 0, canvas.height - geometry.height),
  }
}

export function resizeGeometry(geometry: Geometry, deltaX: number, deltaY: number, canvas: CanvasSize, scale = 1): Geometry {
  return {
    ...geometry,
    width: clamp(geometry.width + canvasDelta(deltaX, scale), minWidth, canvas.width - geometry.x),
    height: clamp(geometry.height + canvasDelta(deltaY, scale), minHeight, canvas.height - geometry.y),
  }
}

export function cloneMaterial(material: ScreenComponent, components: ScreenComponent[], canvas: CanvasSize): ScreenComponent {
  const ids = new Set(components.map(component => component.id))
  let id = material.id
  for (let copy = 2; ids.has(id); copy += 1) {
    const suffix = '-' + copy
    id = material.id.slice(0, 64 - suffix.length) + suffix
  }

  const copies = components.filter(component => component.metricId === material.metricId).length
  const offset = copies * copyOffset
  const geometry = moveGeometry(material.geometry, offset, offset, canvas)
  const highest = Math.max(0, ...components.map(component => component.geometry.z))
  return { ...material, id, geometry: { ...geometry, z: Math.min(highest + 1, maxLayer) } }
}

export function setLayer(components: ScreenComponent[], componentId: string, placement: 'front' | 'back'): ScreenComponent[] {
  const stack = components.slice().sort((left, right) => left.geometry.z - right.geometry.z)
  const index = stack.findIndex(component => component.id === componentId)
  const targetIndex = placement === 'front' ? stack.length - 1 : 0
  if (index < 0 || index === targetIndex) return components

  const [target] = stack.splice(index, 1)
  stack.splice(targetIndex, 0, target)
  const layers = new Map(stack.map((component, layer) => [component.id, layer + 1]))
  return components.map(component => {
    const z = layers.get(component.id) ?? component.geometry.z
    return z === component.geometry.z ? component : { ...component, geometry: { ...component.geometry, z } }
  })
}

export function previewDraft(template: Manifest, snapshot: ComponentData, components: ScreenComponent[]) {
  const originals = new Map(template.components.map(component => [component.metricId, component]))
  const dataByComponent = new Map(snapshot.results.map(result => [result.componentId, result]))
  const matchingSnapshot = snapshot.projectId === template.projectId && snapshot.releaseId === template.releaseId
  const results = matchingSnapshot ? components.flatMap(component => {
    const original = originals.get(component.metricId)
    if (original?.type !== component.type || original.unit !== component.unit) return []
    const data = dataByComponent.get(original.id)
    return data?.metricId === component.metricId && data.unit === component.unit ? [{ ...data, componentId: component.id }] : []
  }) : []

  return { manifest: { ...template, components }, snapshot: { ...snapshot, results } }
}
