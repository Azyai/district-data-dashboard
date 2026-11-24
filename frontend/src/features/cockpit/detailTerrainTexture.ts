import { CanvasTexture, SRGBColorSpace, type BufferGeometry } from 'three'

type Uv = readonly [number, number]
type Atlas = { width: number; height: number; tileWidth: number; tileHeight: number }
const textureRoot = import.meta.env.BASE_URL + 'maps/local-model/terrain-texture/'

export function terrainUvProjection(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  if (!positions || !uv || positions.count < 3) return

  let left = 0
  let right = 0
  let north = 0
  for (let index = 1; index < positions.count; index++) {
    if (positions.getX(index) < positions.getX(left)) left = index
    if (positions.getX(index) > positions.getX(right)) right = index
    if (positions.getZ(index) < positions.getZ(north)) north = index
  }
  const originX = positions.getX(left)
  const originZ = positions.getZ(left)
  const ax = positions.getX(right) - originX
  const az = positions.getZ(right) - originZ
  const bx = positions.getX(north) - originX
  const bz = positions.getZ(north) - originZ
  const determinant = ax * bz - az * bx
  if (Math.abs(determinant) < 1) return
  return ([x, z]: Uv): Uv => {
    const dx = x - originX
    const dz = z - originZ
    const a = (dx * bz - dz * bx) / determinant
    const b = (ax * dz - az * dx) / determinant
    return [
      uv.getX(left) + a * (uv.getX(right) - uv.getX(left)) + b * (uv.getX(north) - uv.getX(left)),
      uv.getY(left) + a * (uv.getY(right) - uv.getY(left)) + b * (uv.getY(north) - uv.getY(left)),
    ]
  }
}

export async function loadTerrainDetail(scope: Uv[], maxTextureSize: number, signal: AbortSignal) {
  const index = await fetch(textureRoot + 'index.json', { signal })
  if (!index.ok) throw new Error('地形细节纹理暂不可用')
  const atlas = await index.json() as Atlas
  const { width, height, tileWidth, tileHeight } = atlas
  if (![width, height, tileWidth, tileHeight].every(size => Number.isInteger(size) && size > 0 && size <= 16_384)
    || Math.ceil(width / tileWidth) !== 3 || Math.ceil(height / tileHeight) !== 2) {
    throw new Error('无效的地形纹理索引')
  }
  const padding = 16
  const left = Math.max(0, Math.floor(Math.min(...scope.map(point => point[0])) * width) - padding)
  const top = Math.max(0, Math.floor(Math.min(...scope.map(point => point[1])) * height) - padding)
  const right = Math.min(width, Math.ceil(Math.max(...scope.map(point => point[0])) * width) + padding)
  const bottom = Math.min(height, Math.ceil(Math.max(...scope.map(point => point[1])) * height) + padding)
  const cropWidth = right - left
  const cropHeight = bottom - top
  if (!(cropWidth > 0 && cropHeight > 0)) throw new Error('地形纹理范围无效')

  const canvas = document.createElement('canvas')
  const scale = Math.min(1, Math.min(4096, maxTextureSize) / Math.max(cropWidth, cropHeight))
  canvas.width = Math.max(1, Math.round(cropWidth * scale))
  canvas.height = Math.max(1, Math.round(cropHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法生成地形细节纹理')
  const painter = context
  painter.imageSmoothingQuality = 'high'
  const scaleX = canvas.width / cropWidth
  const scaleY = canvas.height / cropHeight

  const jobs: Array<Promise<void>> = []
  for (let row = Math.floor(top / tileHeight); row <= Math.floor((bottom - 1) / tileHeight); row++) {
    for (let column = Math.floor(left / tileWidth); column <= Math.floor((right - 1) / tileWidth); column++) {
      jobs.push(composite(column, row))
    }
  }
  await Promise.all(jobs)
  signal.throwIfAborted()
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.repeat.set(width / cropWidth, height / cropHeight)
  texture.offset.set(-left / cropWidth, -top / cropHeight)
  return texture

  async function composite(column: number, row: number) {
    const response = await fetch(textureRoot + column + '-' + row + '.jpg', { signal })
    if (!response.ok) throw new Error('地形纹理切片暂不可用')
    const image = await createImageBitmap(await response.blob())
    try {
      signal.throwIfAborted()
      painter.drawImage(image, (column * tileWidth - left) * scaleX, (row * tileHeight - top) * scaleY,
        image.width * scaleX, image.height * scaleY)
    } finally {
      image.close()
    }
  }
}
