import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js'
import { glbBuffer, landmarkSource, packLandmarkDetail } from './pack-landmark-detail.mjs'

const modelDirectory = new URL('../../docs/地图模型/', import.meta.url)
const outputDirectory = new URL('../public/maps/local-model/', import.meta.url)
const sources = [
  { file: '门头沟地形.glb', name: 'terrain', retention: .20, error: .0002, texture: 'mentougou-terrain.jpg', keepBoundary: true },
  { file: '路网.glb', name: 'roads', triangles: 110_000, error: .0005 },
  { file: '水域.glb', name: 'water', triangles: 32_000, error: .0005 },
]
const landmarks = [
  { file: '天街和京西智谷.glb', node: '天街', name: 'landmark', output: 'tianjie-hd.glb', retention: .20, error: .02 },
  { file: '天街和京西智谷.glb', node: '京西智谷', name: 'landmark', output: 'jingxi-hd.glb', retention: .16, error: .02 },
]

function readBytes(fd, start, size) {
  const buffer = Buffer.alloc(size)
  if (readSync(fd, buffer, 0, size, start) !== size) throw new Error('GLB 数据不完整')
  return buffer
}

function readGlb(file, nodeName, consume) {
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
        parts.push({ transform, primitive })
      }
      for (const child of node.children ?? []) collect(child, transform, retain)
    }
    for (const node of entries.scenes[entries.scene ?? 0].nodes) collect(node, new Matrix4(), !nodeName)
    if (!parts.length) throw new Error(`${file} 中找不到有效模型 ${nodeName ?? ''}`)
    const accessor = (id, Type, count) => {
      const item = entries.accessors[id]
      const view = entries.bufferViews[item.bufferView]
      if (!Type || (view.byteStride && view.byteStride !== Type.BYTES_PER_ELEMENT * count)) {
        throw new Error(`${file} 的顶点数据使用不支持的交错格式`)
      }
      const size = item.count * Type.BYTES_PER_ELEMENT * count
      const bytes = readBytes(fd, binStart + (view.byteOffset ?? 0) + (item.byteOffset ?? 0), size)
      return new Type(bytes.buffer, bytes.byteOffset, item.count * count)
    }

    const meshPart = ({ transform, primitive }, withSurface = false) => {
      const { attributes: { POSITION, NORMAL, TEXCOORD_0 }, indices: indexId } = primitive
      const positions = accessor(POSITION, Float32Array, 3)
      const component = entries.accessors[indexId].componentType
      const Type = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array }[component]
      if (!Type || entries.accessors[POSITION].componentType !== 5126) throw new Error(`${file} 的坐标格式不受支持`)
      const coords = new Vector3()
      for (let offset = 0; offset < positions.length; offset += 3) {
        coords.fromArray(positions, offset).applyMatrix4(transform).toArray(positions, offset)
      }
      const indices = accessor(indexId, Type, 1)
      if (!withSurface) return { positions, indices }
      if (NORMAL == null || TEXCOORD_0 == null) throw new Error(`${file} 缺少法线或纹理坐标`)
      const normals = accessor(NORMAL, Float32Array, 3)
      const uvs = accessor(TEXCOORD_0, Float32Array, 2)
      const normalMatrix = new Matrix3().getNormalMatrix(transform)
      for (let offset = 0; offset < normals.length; offset += 3) {
        coords.fromArray(normals, offset).applyNormalMatrix(normalMatrix).toArray(normals, offset)
      }
      return { positions, indices, normals, uvs }
    }

    const bufferBytes = id => {
      const view = entries.bufferViews[id]
      return readBytes(fd, binStart + (view.byteOffset ?? 0), view.byteLength)
    }
    return consume({ entries, parts, meshPart, bufferBytes })
  } finally {
    closeSync(fd)
  }
}

function prepareOverlay(source) {
  return readGlb(source.file, source.node, ({ entries, parts, meshPart }) => {
    const vertices = parts.reduce((sum, { primitive }) => sum + entries.accessors[primitive.attributes.POSITION].count, 0)
    const indexCount = parts.reduce((sum, { primitive }) => sum + entries.accessors[primitive.indices].count, 0)
    const positions = new Float32Array(vertices * 3)
    const indices = new Uint32Array(indexCount)
    let vertexOffset = 0
    let indexOffset = 0
    for (const part of parts) {
      const mesh = meshPart(part)
      positions.set(mesh.positions, vertexOffset * 3)
      for (const index of mesh.indices) indices[indexOffset++] = vertexOffset + index
      vertexOffset += mesh.positions.length / 3
    }
    const weld = MeshoptSimplifier.generatePositionRemap(positions, 3)
    for (let index = 0; index < indices.length; index++) indices[index] = weld[indices[index]]
    const [reduced] = MeshoptSimplifier.simplify(indices, positions, 3, source.triangles * 3,
      source.error, ['Permissive'])
    if (!reduced.length) throw new Error(`${source.file} 未生成有效网格`)
    const [remap, count] = MeshoptSimplifier.compactMesh(reduced)
    const compact = new Float32Array(count * 3)
    for (let index = 0; index < remap.length; index++) {
      const vertex = remap[index]
      if (vertex !== 0xffffffff) compact.set(positions.subarray(index * 3, index * 3 + 3), vertex * 3)
    }
    console.info(`${source.file} ${indices.length / 3} → ${reduced.length / 3} 个三角面`)
    return { name: source.name, positions: compact, indices: count <= 65_536 ? Uint16Array.from(reduced) : reduced }
  })
}

function surfaceImage(source, bytes) {
  const target = fileURLToPath(new URL(source.texture, outputDirectory))
  const temporaryInput = `${target}.${process.pid}.png`
  const temporaryOutput = `${target}.${process.pid}.jpg`
  mkdirSync(dirname(target), { recursive: true })
  try {
    writeFileSync(temporaryInput, bytes)
    const converted = spawnSync(process.env.DASHBOARD_FFMPEG ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', temporaryInput,
      '-vf', 'scale=8192:-2:flags=lanczos', '-frames:v', '1', '-threads:v', '1', '-q:v', '3', temporaryOutput,
    ], { stdio: 'inherit' })
    if (converted.error || converted.status !== 0) throw new Error('地形纹理转换失败，请将 FFmpeg 放入 PATH', { cause: converted.error })
    const image = readFileSync(temporaryOutput)
    if (image.byteLength > 12_000_000) throw new Error('地形纹理超过 12 MB 预算')
    if (!existsSync(target) || !readFileSync(target).equals(image)) renameSync(temporaryOutput, target)
  } finally {
    rmSync(temporaryInput, { force: true })
    rmSync(temporaryOutput, { force: true })
  }
  return { uri: source.texture }
}

function prepareSurfaces(source) {
  return readGlb(source.file, source.node, ({ entries, parts, meshPart, bufferBytes }) => {
    const retainedImages = new Map()
    let sourceCount = 0
    let reducedCount = 0
    const primitives = parts.map(part => {
      const { positions, indices, normals, uvs } = meshPart(part, true)
      const target = Math.min(indices.length, Math.max(60, Math.round(indices.length / 3 * source.retention) * 3))
      const reduced = target < indices.length
        ? MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, uvs, 2, [.022, .022], null, target,
          source.error, source.keepBoundary ? ['LockBorder'] : ['Permissive'])[0]
        : Uint32Array.from(indices)
      const [remap, count] = MeshoptSimplifier.compactMesh(reduced)
      const retainedPositions = new Float32Array(count * 3)
      const retainedNormals = new Int8Array(count * 4)
      const retainedUvs = new Float32Array(count * 2)
      for (let index = 0; index < remap.length; index++) {
        const vertex = remap[index]
        if (vertex === 0xffffffff) continue
        for (let axis = 0; axis < 3; axis++) {
          retainedPositions[vertex * 3 + axis] = positions[index * 3 + axis]
          retainedNormals[vertex * 4 + axis] = Math.round(normals[index * 3 + axis] * 127)
        }
        retainedUvs.set(uvs.subarray(index * 2, index * 2 + 2), vertex * 2)
      }
      if (!reduced.length) throw new Error(`${source.file} 包含无法简化的材质网格`)
      sourceCount += indices.length / 3
      reducedCount += reduced.length / 3

      const material = structuredClone(entries.materials[part.primitive.material])
      const textureInfo = material.pbrMetallicRoughness.baseColorTexture
      let texture
      if (textureInfo) {
        const textureSource = entries.textures[textureInfo.index]
        const sourceImage = entries.images[textureSource.source]
        if (!retainedImages.has(textureSource.source)) {
          const bytes = bufferBytes(sourceImage.bufferView)
          retainedImages.set(textureSource.source, source.texture ? surfaceImage(source, bytes) : {
            bytes, mimeType: sourceImage.mimeType, name: sourceImage.name,
          })
        }
        texture = {
          image: retainedImages.get(textureSource.source),
          sampler: entries.samplers?.[textureSource.sampler],
        }
      }
      if (source.texture) material.alphaMode = 'OPAQUE'
      return { positions: retainedPositions, normals: retainedNormals, uvs: retainedUvs, material, texture,
        indices: count <= 65_536 ? Uint16Array.from(reduced) : reduced }
    })
    console.info(`${source.node ?? source.file} ${sourceCount} → ${reducedCount} 个三角面，保留 ${primitives.length} 个材质分组和 ${retainedImages.size} 张原始纹理`)
    return { name: source.name, primitives }
  })
}

function packGlb(meshes, sources) {
  const gltf = {
    asset: { version: '2.0', generator: 'district-dashboard terrain LOD', extras: { source: sources.map(item => item.file) } },
    extensionsUsed: ['KHR_mesh_quantization'],
    extensionsRequired: ['KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: meshes.map((_, index) => index) }],
    nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [],
    materials: [], textures: [], images: [], samplers: [],
  }
  const binary = []
  let byteOffset = 0
  const addBufferView = (typed, target, byteStride) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
    const padding = Buffer.alloc((4 - bytes.length % 4) % 4)
    const bufferView = gltf.bufferViews.length
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target, byteStride })
    binary.push(bytes, padding)
    byteOffset += bytes.length + padding.length
    return bufferView
  }
  const addAccessor = (typed, accessor, target, byteStride) => {
    const index = gltf.accessors.length
    gltf.accessors.push({ ...accessor, bufferView: addBufferView(typed, target, byteStride) })
    return index
  }
  const imageIndices = new Map()
  const textureIndices = new Map()
  const samplerIndices = new Map()

  function addMaterial(material, texture) {
    for (const extension of Object.keys(material.extensions ?? {})) {
      if (!gltf.extensionsUsed.includes(extension)) gltf.extensionsUsed.push(extension)
    }
    if (texture) {
      if (!imageIndices.has(texture.image)) {
        const { bytes, ...metadata } = texture.image
        imageIndices.set(texture.image, gltf.images.length)
        gltf.images.push(bytes ? { ...metadata, bufferView: addBufferView(bytes) } : metadata)
      }
      const source = imageIndices.get(texture.image)
      let sampler
      if (texture.sampler) {
        const key = JSON.stringify(texture.sampler)
        if (!samplerIndices.has(key)) {
          samplerIndices.set(key, gltf.samplers.length)
          gltf.samplers.push(texture.sampler)
        }
        sampler = samplerIndices.get(key)
      }
      const textureKey = JSON.stringify([source, sampler])
      if (!textureIndices.has(textureKey)) {
        textureIndices.set(textureKey, gltf.textures.length)
        gltf.textures.push({ source, sampler })
      }
      material.pbrMetallicRoughness.baseColorTexture.index = textureIndices.get(textureKey)
    }
    return gltf.materials.push(material) - 1
  }
  function positionBounds(positions) {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let index = 0; index < positions.length; index++) {
      const axis = index % 3
      min[axis] = Math.min(min[axis], positions[index])
      max[axis] = Math.max(max[axis], positions[index])
    }
    return { min, max }
  }
  const writeElements = indices => addAccessor(indices, {
    type: 'SCALAR', componentType: indices.BYTES_PER_ELEMENT === 2 ? 5123 : 5125, count: indices.length,
  }, 34963)

  for (const mesh of meshes) {
    const { name, positions, indices } = mesh
    if (mesh.primitives) {
      const primitives = mesh.primitives.map(item => {
        const count = item.positions.length / 3
        const position = addAccessor(item.positions, {
          type: 'VEC3', componentType: 5126, count, ...positionBounds(item.positions),
        }, 34962)
        const normal = addAccessor(item.normals, { type: 'VEC3', componentType: 5120, normalized: true, count }, 34962, 4)
        const uv = addAccessor(item.uvs, { type: 'VEC2', componentType: 5126, count }, 34962)
        return {
          attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv },
          indices: writeElements(item.indices), material: addMaterial(item.material, item.texture),
        }
      })
      gltf.nodes.push({ name, mesh: gltf.meshes.length })
      gltf.meshes.push({ name, primitives })
      continue
    }
    const { min, max } = positionBounds(positions)
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
    gltf.nodes.push({ name, mesh: gltf.meshes.length, translation: min, scale })
    gltf.meshes.push({ name, primitives: [{ attributes: { POSITION: position }, indices: writeElements(indices) }] })
  }
  for (const key of ['materials', 'textures', 'images', 'samplers']) if (!gltf[key].length) delete gltf[key]
  gltf.buffers.push({ byteLength: byteOffset })
  return glbBuffer(gltf, binary, byteOffset)
}

function writeModelFile(filename, buffer, budget) {
  const targetFile = fileURLToPath(new URL(filename, outputDirectory))
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

function writeModel(filename, items, budget) {
  writeModelFile(filename, packGlb(items.map(item => item.retention ? prepareSurfaces(item) : prepareOverlay(item)), items), budget)
}

await MeshoptSimplifier.ready
writeModel('mentougou-hd.glb', sources, 25_000_000)
for (const landmark of landmarks) {
  writeModel(landmark.output, [landmark], 26_000_000)
  const source = readGlb(landmark.file, landmark.node,
    ({ entries, bufferBytes }) => landmarkSource(entries, landmark.node, bufferBytes))
  const detail = await packLandmarkDetail(source)
  writeModelFile(landmark.output.replace('-hd.glb', '-detail.glb'), detail, 36_000_000)
}
