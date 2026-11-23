import assert from 'node:assert/strict'
import test from 'node:test'
import { cloneMaterial, maxComponents, moveGeometry, previewDraft, resizeGeometry, setLayer } from '../src/features/designer/draftLayout.ts'

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
