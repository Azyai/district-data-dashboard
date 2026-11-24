import { pack } from 'gltfpack'

export function glbBuffer(gltf, binary, byteLength) {
  const metadata = Buffer.from(JSON.stringify(gltf))
  const padding = Buffer.alloc((4 - metadata.length % 4) % 4, 0x20)
  const header = Buffer.alloc(20)
  header.write('glTF')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + metadata.length + padding.length + byteLength, 8)
  header.writeUInt32LE(metadata.length + padding.length, 12)
  header.write('JSON', 16)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(byteLength)
  binHeader.write('BIN\0', 4)
  return Buffer.concat([header, metadata, padding, binHeader, ...binary])
}

export function landmarkSource(entries, nodeName, readBufferView) {
  const sourceNode = entries.nodes.findIndex(item => item.name === nodeName)
  if (sourceNode < 0) throw new Error(`找不到地标模型 ${nodeName}`)
  const binary = []
  let byteLength = 0
  const gltf = {
    asset: { version: '2.0' }, extensionsUsed: entries.extensionsUsed, scene: 0,
    scenes: [], nodes: [], meshes: [], samplers: entries.samplers,
    accessors: [], bufferViews: [], materials: [], textures: [], images: [], buffers: [],
  }
  const copied = new Map()

  function copy(field, sourceIndex, update) {
    if (sourceIndex === undefined) return undefined
    const key = `${field}/${sourceIndex}`
    if (copied.has(key)) return copied.get(key)
    const entry = structuredClone(entries[field][sourceIndex])
    update(entry, sourceIndex)
    const index = gltf[field].push(entry) - 1
    copied.set(key, index)
    return index
  }

  const copyView = index => copy('bufferViews', index, (view, sourceIndex) => {
    const bytes = readBufferView(sourceIndex)
    const padding = Buffer.alloc((4 - bytes.length % 4) % 4)
    view.byteOffset = byteLength
    binary.push(bytes, padding)
    byteLength += bytes.length + padding.length
  })
  const copyAccessor = index => copy('accessors', index, item => {
    item.bufferView = copyView(item.bufferView)
  })
  const copyMaterial = index => copy('materials', index, material => {
    const color = material.pbrMetallicRoughness?.baseColorTexture
    if (!color) return
    color.index = copy('textures', color.index, texture => {
      texture.source = copy('images', texture.source, image => {
        image.bufferView = copyView(image.bufferView)
      })
    })
  })

  const copyMesh = index => copy('meshes', index, mesh => {
    for (const primitive of mesh.primitives) {
      for (const key of Object.keys(primitive.attributes)) {
        primitive.attributes[key] = copyAccessor(primitive.attributes[key])
      }
      primitive.indices = copyAccessor(primitive.indices)
      primitive.material = copyMaterial(primitive.material)
    }
  })
  const copyNode = index => copy('nodes', index, item => {
    item.mesh = copyMesh(item.mesh)
    item.children = item.children?.map(copyNode)
  })
  let root = copyNode(sourceNode)
  let child = sourceNode
  gltf.nodes[root].name = 'landmark'
  for (let parent = entries.nodes.findIndex(item => item.children?.includes(child)); parent >= 0;
    parent = entries.nodes.findIndex(item => item.children?.includes(child))) {
    root = copy('nodes', parent, item => {
      const { translation, rotation, scale, matrix } = item
      for (const key of Object.keys(item)) delete item[key]
      Object.assign(item, { translation, rotation, scale, matrix, children: [root] })
    })
    child = parent
  }
  if (!gltf.meshes.length) throw new Error(`地标模型 ${nodeName} 没有源网格`)
  gltf.scenes.push({ nodes: [root] })
  gltf.buffers.push({ byteLength })
  return glbBuffer(gltf, binary, byteLength)
}

export async function packLandmarkDetail(source) {
  let output
  // Preserve façade topology. Position quantization stays in floating point,
  // while source UVs are kept as floats for the original material boundaries.
  await pack([
    '-i', 'source.glb', '-o', 'detail.glb', '-cc', '-kn', '-km', '-kv',
    '-vpf', '-vp', '16', '-vtf', '-vn', '12',
  ], {
    read(path) {
      if (path === 'source.glb') return source
      throw new Error(`无法读取地标素材 ${path}`)
    },
    write(path, bytes) {
      if (path !== 'detail.glb') throw new Error(`未预期的地标输出 ${path}`)
      output = Buffer.from(bytes)
    },
  })
  if (!output?.length) throw new Error('未生成地标精细模型')
  return output
}
