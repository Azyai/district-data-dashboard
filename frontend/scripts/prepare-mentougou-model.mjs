import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js'

const modelDirectory = new URL('../../docs/地图模型/', import.meta.url)
const outputDirectory = new URL('../public/maps/local-model/', import.meta.url)
const sources = [
  { file: '门头沟地形.glb', name: 'terrain', triangles: 74_000, error: .001, keepBoundary: true },
  { file: '路网.glb', name: 'roads', triangles: 45_000, error: .0015, keepBoundary: false },
  { file: '水域.glb', name: 'water', triangles: 16_000, error: .0015, keepBoundary: false },
]
const landmarks = [
  { file: '天街和京西智谷.glb', node: '天街', name: 'landmark', output: 'tianjie.glb', triangles: 70_000, error: .012 },
  { file: '天街和京西智谷.glb', node: '京西智谷', name: 'landmark', output: 'jingxi.glb', triangles: 70_000, error: .012 },
]

function readBytes(fd, start, size) {
  const buffer = Buffer.alloc(size)
  if (readSync(fd, buffer, 0, size, start) !== size) throw new Error('GLB 数据不完整')
  return buffer
}

function readGlb(file, nodeName) {
  const fd = openSync(new URL(file, modelDirectory), 'r')
  try {
    const header = readBytes(fd, 0, 20)
    if (header.toString('ascii', 0, 4) !== 'glTF' || header.readUInt32LE(4) !== 2
      || header.toString('ascii', 16, 20) !== 'JSON') throw new Error(`${file} 不是 GLB 2.0 文件`)
    const jsonSize = header.readUInt32LE(12)
    const entries = JSON.parse(readBytes(fd, 20, jsonSize).toString())
    const binStart = 28 + jsonSize
    const parts = []
    const collect = (index, parent, selected) => {
      const node = entries.nodes[index]
      const retain = selected || node.name === nodeName
      const local = node.matrix
        ? new Matrix4().fromArray(node.matrix)
        : new Matrix4().compose(new Vector3().fromArray(node.translation ?? [0, 0, 0]),
          new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
          new Vector3().fromArray(node.scale ?? [1, 1, 1]))
      const transform = parent.clone().multiply(local)
      for (const primitive of (retain ? entries.meshes[node.mesh]?.primitives : undefined) ?? []) {
        if ((primitive.mode ?? 4) !== 4) throw new Error(`${file} 包含不支持的网格拓扑`)
        parts.push({ transform, positionId: primitive.attributes.POSITION, indexId: primitive.indices })
      }
      for (const child of node.children ?? []) collect(child, transform, retain)
    }
    for (const node of entries.scenes[entries.scene ?? 0].nodes) collect(node, new Matrix4(), !nodeName)
    if (!parts.length) throw new Error(`${file} 中找不到有效模型 ${nodeName ?? ''}`)
    const vertices = parts.reduce((sum, { positionId }) => sum + entries.accessors[positionId].count, 0)
    const indexCount = parts.reduce((sum, { indexId }) => sum + entries.accessors[indexId].count, 0)
    const positions = new Float32Array(vertices * 3)
    const indices = new Uint32Array(indexCount)
    const position = new Vector3()
    let vertexOffset = 0
    let indexOffset = 0

    const accessor = (id, Type, count) => {
      const item = entries.accessors[id]
      const view = entries.bufferViews[item.bufferView]
      if (view.byteStride && view.byteStride !== Type.BYTES_PER_ELEMENT * count) {
        throw new Error(`${file} 的顶点数据使用不支持的交错格式`)
      }
      const size = item.count * Type.BYTES_PER_ELEMENT * count
      const bytes = readBytes(fd, binStart + (view.byteOffset ?? 0) + (item.byteOffset ?? 0), size)
      return new Type(bytes.buffer, bytes.byteOffset, item.count * count)
    }

    for (const { transform, positionId, indexId } of parts) {
      const from = accessor(positionId, Float32Array, 3)
      const component = entries.accessors[indexId].componentType
      const Type = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array }[component]
      if (!Type || entries.accessors[positionId].componentType !== 5126) throw new Error(`${file} 的坐标格式不受支持`)
      const sourceIndices = accessor(indexId, Type, 1)
      for (let i = 0; i < from.length; i += 3) {
        position.fromArray(from, i).applyMatrix4(transform).toArray(positions, vertexOffset * 3 + i)
      }
      for (const index of sourceIndices) indices[indexOffset++] = vertexOffset + index
      vertexOffset += from.length / 3
    }
    return { positions, indices }
  } finally {
    closeSync(fd)
  }
}

function simplify(source) {
  const { positions, indices } = readGlb(source.file, source.node)
  const weld = MeshoptSimplifier.generatePositionRemap(positions, 3)
  for (let i = 0; i < indices.length; i++) indices[i] = weld[indices[i]]
  const [reduced] = MeshoptSimplifier.simplify(indices, positions, 3, source.triangles * 3,
    source.error, source.keepBoundary ? ['LockBorder'] : ['Permissive'])
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(reduced)
  const compact = new Float32Array(vertexCount * 3)
  for (let i = 0; i < remap.length; i++) {
    const vertex = remap[i]
    if (vertex === 0xffffffff) continue
    compact.set(positions.subarray(i * 3, i * 3 + 3), vertex * 3)
  }
  if (reduced.length === 0) throw new Error(`${source.file} 未生成有效网格`)
  console.info(`${source.node ?? source.file} ${indices.length / 3} → ${reduced.length / 3} 个三角面`)
  return { name: source.name, positions: compact, indices: vertexCount <= 65_536 ? Uint16Array.from(reduced) : reduced }
}

function packGlb(meshes, sources) {
  const gltf = {
    asset: { version: '2.0', generator: 'district-dashboard terrain LOD', extras: { source: sources.map(item => item.file) } },
    extensionsUsed: ['KHR_mesh_quantization'],
    extensionsRequired: ['KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: meshes.map((_, index) => index) }],
    nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [],
  }
  const binary = []
  let byteOffset = 0
  const addAccessor = (typed, accessor, target, byteStride) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
    const padding = Buffer.alloc((4 - bytes.length % 4) % 4)
    const bufferView = gltf.bufferViews.length
    const index = gltf.accessors.length
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target, byteStride })
    gltf.accessors.push({ ...accessor, bufferView })
    binary.push(bytes, padding)
    byteOffset += bytes.length + padding.length
    return index
  }
  for (const { name, positions, indices } of meshes) {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let index = 0; index < positions.length; index++) {
      const axis = index % 3
      min[axis] = Math.min(min[axis], positions[index])
      max[axis] = Math.max(max[axis], positions[index])
    }
    const scale = max.map((value, axis) => Math.max(.000001, (value - min[axis]) / 65_535))
    const quantized = new Uint16Array(positions.length / 3 * 4)
    const quantizedMax = [0, 0, 0]
    for (let index = 0; index < positions.length; index++) {
      const axis = index % 3
      const value = Math.round((positions[index] - min[axis]) / scale[axis])
      quantized[Math.floor(index / 3) * 4 + axis] = value
      quantizedMax[axis] = Math.max(quantizedMax[axis], value)
    }
    const position = addAccessor(quantized, {
      type: 'VEC3', componentType: 5123, count: positions.length / 3, min: [0, 0, 0], max: quantizedMax,
    }, 34962, 8)
    const elements = addAccessor(indices, { type: 'SCALAR', componentType: indices.BYTES_PER_ELEMENT === 2 ? 5123 : 5125, count: indices.length }, 34963)
    gltf.nodes.push({ name, mesh: gltf.meshes.length, translation: min, scale })
    gltf.meshes.push({ name, primitives: [{ attributes: { POSITION: position }, indices: elements }] })
  }
  gltf.buffers.push({ byteLength: byteOffset })
  const metadata = Buffer.from(JSON.stringify(gltf))
  const padding = Buffer.alloc((4 - metadata.length % 4) % 4, 0x20)
  const header = Buffer.alloc(20)
  header.write('glTF')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + metadata.length + padding.length + byteOffset, 8)
  header.writeUInt32LE(metadata.length + padding.length, 12)
  header.write('JSON', 16)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(byteOffset)
  binHeader.write('BIN\0', 4)
  return Buffer.concat([header, metadata, padding, binHeader, ...binary])
}

function writeModel(filename, items, budget) {
  const targetFile = fileURLToPath(new URL(filename, outputDirectory))
  const buffer = packGlb(items.map(simplify), items)
  if (buffer.length > budget) throw new Error(`${filename} 超过模型预算（${buffer.length} 字节）`)
  if (existsSync(targetFile) && readFileSync(targetFile).equals(buffer)) {
    console.info(`已是最新：${targetFile}`)
    return
  }
  mkdirSync(dirname(targetFile), { recursive: true })
  const temp = `${targetFile}.${process.pid}.tmp`
  try {
    writeFileSync(temp, buffer)
    renameSync(temp, targetFile)
  } finally {
    rmSync(temp, { force: true })
  }
  console.info(`已生成 ${targetFile}（${(buffer.length / 1_000_000).toFixed(2)} MB）`)
}

await MeshoptSimplifier.ready
writeModel('mentougou.glb', sources, 4_500_000)
for (const landmark of landmarks) writeModel(landmark.output, [landmark], 8_000_000)
