import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = new URL('../../docs/地图模型/门头沟地形.glb', import.meta.url)
const output = fileURLToPath(new URL('../public/maps/local-model/terrain-texture/', import.meta.url))
const glb = readFileSync(source)
const headerBytes = glb.readUInt32LE(12)
const manifest = JSON.parse(glb.subarray(20, 20 + headerBytes))
const terrain = manifest.meshes[0].primitives[0]
const reference = manifest.materials[terrain.material].pbrMetallicRoughness.baseColorTexture
const image = manifest.images[manifest.textures[reference.index].source]
const view = manifest.bufferViews[image.bufferView]
const offset = 28 + headerBytes + (view.byteOffset ?? 0)
const png = glb.subarray(offset, offset + view.byteLength)
if (image.mimeType !== 'image/png' || png.toString('ascii', 12, 16) !== 'IHDR') {
  throw new Error('原地形纹理必须为嵌入的 PNG')
}
const width = png.readUInt32BE(16)
const height = png.readUInt32BE(20)
const tileWidth = Math.ceil(width / 3)
const tileHeight = Math.ceil(height / 2)
mkdirSync(output, { recursive: true })
const temporary = join(output, `source-${process.pid}.png`)
try {
  writeFileSync(temporary, png)
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 3; column++) {
      const x = column * tileWidth
      const y = row * tileHeight
      const crop = [Math.min(tileWidth, width - x), Math.min(tileHeight, height - y), x, y]
      const target = join(output, `${column}-${row}.jpg`)
      const converted = spawnSync(process.env.DASHBOARD_FFMPEG ?? 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', temporary, '-vf', `crop=${crop.join(':')}:exact=1`,
        '-frames:v', '1', '-q:v', '3', target,
      ], { stdio: 'inherit' })
      if (converted.error || converted.status !== 0) {
        throw new Error('原地形纹理切片失败，请确认 FFmpeg 可用', { cause: converted.error })
      }
    }
  }
  writeFileSync(join(output, 'index.json'), JSON.stringify({ width, height, tileWidth, tileHeight }))
} finally {
  rmSync(temporary, { force: true })
}
console.info(`已生成 ${width} × ${height} 原始纹理的 6 张地形切片`)
