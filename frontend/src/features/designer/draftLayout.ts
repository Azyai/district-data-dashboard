import type { ComponentData, Manifest } from '../../api/client'

export type ScreenComponent = Manifest['components'][number]
export type Geometry = ScreenComponent['geometry']
export type CanvasSize = Manifest['canvas']
export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type AlignmentReference = 'selection' | 'canvas'

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

export function componentBounds(components: readonly ScreenComponent[]) {
  if (!components.length) return null
  const geometries = components.map(component => component.geometry)
  const x = Math.min(...geometries.map(geometry => geometry.x))
  const y = Math.min(...geometries.map(geometry => geometry.y))
  const right = Math.max(...geometries.map(geometry => geometry.x + geometry.width))
  const bottom = Math.max(...geometries.map(geometry => geometry.y + geometry.height))
  return { x, y, width: right - x, height: bottom - y }
}

function alignmentLine(geometry: Omit<Geometry, 'z'>, alignment: Alignment) {
  switch (alignment) {
    case 'left': return geometry.x
    case 'center': return geometry.x + geometry.width / 2
    case 'right': return geometry.x + geometry.width
    case 'top': return geometry.y
    case 'middle': return geometry.y + geometry.height / 2
    case 'bottom': return geometry.y + geometry.height
  }
}

export function alignComponents(
  components: ScreenComponent[], selection: ReadonlySet<string>, alignment: Alignment, canvas: CanvasSize,
  reference: AlignmentReference = 'selection',
): ScreenComponent[] {
  const selected = components.filter(component => selection.has(component.id))
  const guide = alignmentGuide(selected, alignment, canvas, reference)
  if (!guide) return components
  const aligned = components.map(component => {
    if (!selection.has(component.id)) return component
    const offset = guide.offset - alignmentLine(component.geometry, alignment)
    const geometry = moveGeometry(component.geometry, guide.axis === 'x' ? offset : 0, guide.axis === 'y' ? offset : 0, canvas)
    return geometry.x === component.geometry.x && geometry.y === component.geometry.y ? component : { ...component, geometry }
  })
  return aligned.every((component, index) => component === components[index]) ? components : aligned
}

export function alignmentGuide(
  selected: readonly ScreenComponent[], alignment: Alignment, canvas: CanvasSize, reference: AlignmentReference,
) {
  if (!selected.length || (reference === 'selection' && selected.length < 2)) return null
  const bounds = reference === 'canvas' ? { x: 0, y: 0, ...canvas } : componentBounds(selected)
  if (!bounds) return null
  const axis = alignment === 'left' || alignment === 'center' || alignment === 'right' ? 'x' : 'y'
  return { axis, offset: alignmentLine(bounds, alignment) } as const
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
