import assert from 'node:assert/strict'
import test from 'node:test'
import { alignComponents, alignmentGuide, cloneMaterial, componentBounds, maxComponents, moveGeometry, previewDraft, resizeGeometry, setLayer } from '../src/features/designer/draftLayout.ts'

const canvas = { width: 1920, height: 1080 }
const geometry = { x: 48, y: 40, width: 592, height: 148, z: 1 }
const material = { id: 'events-kpi', title: '受理事件', type: 'kpi', unit: '件', metricId: 'accepted-events', geometry }
const template = { schemaVersion: 1, projectId: 'city-operations', releaseId: 'city-release-1', canvas, components: [material] }
const snapshot = {
  projectId: template.projectId,
  releaseId: template.releaseId,
  results: [{ componentId: material.id, metricId: material.metricId, unit: material.unit, value: 72 }],
}

test('converts rendered movement and resize into the same integer geometry across zoom levels', () => {
  for (const scale of [0.5, 1, 1.5]) {
    assert.deepEqual(moveGeometry(geometry, 80 * scale, -25 * scale, canvas, scale), { ...geometry, x: 128, y: 15 })
    assert.deepEqual(resizeGeometry(geometry, -100 * scale, 50 * scale, canvas, scale), { ...geometry, width: 492, height: 198 })
  }
  assert.equal(moveGeometry(geometry, 1, -1, canvas, 1.5).x, 49)
  assert.equal(moveGeometry(geometry, 1, -1, canvas, 1.5).y, 39)
  assert.deepEqual(geometry, { x: 48, y: 40, width: 592, height: 148, z: 1 })
})

test('clamps moves and sizes to the canvas and enforces the server minimum dimensions', () => {
  assert.deepEqual(moveGeometry(geometry, -9999, 9999, canvas), { ...geometry, x: 0, y: 932 })
  assert.deepEqual(resizeGeometry(geometry, -9999, -9999, canvas), { ...geometry, width: 160, height: 120 })
  assert.deepEqual(resizeGeometry(geometry, 9999, 9999, canvas), { ...geometry, width: 1872, height: 1040 })
})

test('aligns all six sides and axes to a group while leaving sizes, layers and unselected components intact', () => {
  const second = { ...material, id: 'second', geometry: { x: 500, y: 198, width: 300, height: 200, z: 4 } }
  const unselected = { ...material, id: 'unselected', geometry: { ...geometry, x: 1100, y: 600, z: 6 } }
  const input = [material, second, unselected]
  const selection = new Set([material.id, second.id])
  const cases = {
    left: ['x', 48, 48], center: ['x', 128, 274], right: ['x', 208, 500],
    top: ['y', 40, 40], middle: ['y', 145, 119], bottom: ['y', 250, 198],
  }
  assert.deepEqual(componentBounds([material, second]), { x: 48, y: 40, width: 752, height: 358 })
  for (const [direction, [axis, firstTarget, secondTarget]] of Object.entries(cases)) {
    const aligned = alignComponents(input, selection, direction, canvas)
    assert.deepEqual(aligned[0].geometry, { ...material.geometry, [axis]: firstTarget }, direction)
    assert.deepEqual(aligned[1].geometry, { ...second.geometry, [axis]: secondTarget }, direction)
    assert.strictEqual(aligned[2], unselected)
  }
  assert.deepEqual(material.geometry, geometry)
  assert.strictEqual(alignComponents(input, new Set([material.id, 'removed']), 'left', canvas), input)
  const aligned = alignComponents(input, selection, 'left', canvas)
  assert.strictEqual(alignComponents(aligned, selection, 'left', canvas), aligned)
})

test('centers mixed odd and even sizes on integer positions within canvas bounds', () => {
  const wide = { ...material, geometry: { x: 0, y: 0, width: 1919, height: 151, z: 1 } }
  const narrow = { ...material, id: 'narrow', geometry: { x: 1, y: 930, width: 180, height: 150, z: 2 } }
  const input = [wide, narrow]
  const selection = new Set([wide.id, narrow.id])
  assert.deepEqual(alignComponents(input, selection, 'center', canvas).map(component => component.geometry.x), [0, 870])
  assert.deepEqual(alignComponents(input, selection, 'middle', canvas).map(component => component.geometry.y), [465, 465])
})

test('aligns one selected component to the canvas with a matching edge or center guide', () => {
  const unchanged = { ...material, id: 'unchanged' }
  const original = [material, unchanged]
  const selection = new Set([material.id])
  assert.equal(alignmentGuide([material], 'left', canvas, 'selection'), null)
  assert.deepEqual(alignmentGuide([material], 'center', canvas, 'canvas'), { axis: 'x', offset: 960 })
  const expected = {
    left: ['x', 0], center: ['x', 664], right: ['x', 1328],
    top: ['y', 0], middle: ['y', 466], bottom: ['y', 932],
  }
  for (const [direction, [axis, offset]] of Object.entries(expected)) {
    const transformed = alignComponents(original, selection, direction, canvas, 'canvas')
    assert.deepEqual(transformed[0].geometry, { ...geometry, [axis]: offset })
    assert.strictEqual(transformed[1], unchanged)
  }
})

test('clones a material with a bounded unique ID and a separate layer', () => {
  const longMaterial = { ...material, id: 'm' + 'x'.repeat(63) }
  const components = [longMaterial]
  for (let index = 1; index < maxComponents; index += 1) components.push(cloneMaterial(longMaterial, components, canvas))
  const ids = components.map(component => component.id)
  assert.equal(new Set(ids).size, maxComponents)
  assert.ok(ids.every(id => /^[a-z][a-z0-9-]{0,63}$/.test(id)))
  assert.equal(components.at(-1).geometry.z, maxComponents)
})

test('moves a component to either end of the stack while preserving list order', () => {
  const second = { ...material, id: 'second' }
  const third = { ...material, id: 'third' }
  const initial = [material, second, third]
  const front = setLayer(initial, material.id, 'front')
  assert.deepEqual(front.map(component => component.id), initial.map(component => component.id))
  assert.deepEqual(front.map(component => component.geometry.z), [3, 1, 2])
  assert.deepEqual(setLayer(front, material.id, 'back').map(component => component.geometry.z), [1, 2, 3])
  assert.strictEqual(setLayer(front, material.id, 'front'), front)
})

test('maps canonical snapshot data to edited IDs without mixing release, project, or material bindings', () => {
  const copy = cloneMaterial(material, [material], canvas)
  const updated = { ...material, title: '已修改标题' }
  const missing = { ...material, id: 'missing', metricId: 'unknown-metric' }
  const invalidType = { ...material, id: 'invalid-type', type: 'trend' }
  const preview = previewDraft(template, snapshot, [updated, copy, missing, invalidType])
  assert.equal(preview.manifest.components[0].title, '已修改标题')
  assert.deepEqual(preview.snapshot.results.map(result => [result.componentId, result.value]), [[updated.id, 72], [copy.id, 72]])
  assert.deepEqual(previewDraft(template, { ...snapshot, releaseId: 'other-release' }, [copy]).snapshot.results, [])
  assert.deepEqual(previewDraft(template, { ...snapshot, projectId: 'public-services' }, [copy]).snapshot.results, [])
  assert.deepEqual(previewDraft(template, snapshot, []).snapshot.results, [])
})
