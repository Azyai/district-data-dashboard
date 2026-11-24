import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const input = new URL('../../docs/地图模型/门头沟区各层级json文件/', import.meta.url)
const output = new URL('../public/maps/local-model/data/', import.meta.url)
const schema = [
  { level: 'district', input: '门头沟区.json', output: 'district.geojson', code: 'adcode' },
  { level: 'town', input: '镇街.json', output: 'towns.geojson', code: 'adcode', parent: 'districtAdcode' },
  { level: 'village', input: '村居.json', output: 'villages', code: 'adcode', parent: 'townAdcode' },
  { level: 'grid', input: '村居下一级网格.json', output: 'grids', code: 'adcode', parent: 'communityAdcode' },
  { level: 'building', input: '楼房建筑.json', output: 'buildings', code: 'buildingCode', parent: 'gridAdcode' },
]

function getRecords(spec) {
  const collection = JSON.parse(readFileSync(new URL(spec.input, input), 'utf8'))
  if (collection.type !== 'FeatureCollection' || collection.meta?.coordinate !== 'WGS84') {
    throw new Error(`${spec.input} 不是 WGS84 GeoJSON 数据`)
  }
  const seen = new Set()
  return collection.features.map(({ geometry, properties: details }) => {
    const code = details[spec.code]
    const parentCode = spec.parent ? details[spec.parent] : undefined
    const validCode = spec.level === 'building' ? typeof code === 'string' && code.length > 0 && code.length <= 100 : /^\d{6,21}$/.test(code)
    if (!validCode || (spec.parent && !/^\d{6,21}$/.test(parentCode)) || seen.has(code)
      || (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon')) {
      throw new Error(`${spec.input} 中存在无效或重复的地理要素 ${code}`)
    }
    if (typeof details.name !== 'string' || !details.name) throw new Error(`${spec.input} 中要素 ${code} 缺少名称`)
    seen.add(code)
    return {
      // Building codes exceed the vector-tile ID range. Keep them as string properties.
      type: 'Feature', geometry,
      properties: {
        name: details.name, code, parentCode,
        town: details.town, community: details.community, grid: details.gridName,
        floors: details.floors, areaM2: details.areaM2,
      },
    }
  })
}

function saveCollection(path, features) {
  const data = JSON.stringify({ type: 'FeatureCollection', features })
  const bytes = Buffer.byteLength(data)
  if (bytes > 1_500_000) throw new Error(`${path} 超过单次地图请求的 1.5 MB 上限（${bytes} 字节）`)
  const file = new URL(path, output)
  mkdirSync(dirname(fileURLToPath(file)), { recursive: true })
  writeFileSync(file, data)
  return bytes
}

const all = schema.map(getRecords)
const manifest = { version: 1, coordinate: 'WGS84', levels: {} }
for (const [index, spec] of schema.entries()) {
  const current = all[index]
  const known = new Set(all[index - 1]?.map(feature => feature.properties.code))
  const childCodes = new Set(all[index + 1]?.map(feature => feature.properties.parentCode))
  const groups = new Map()
  for (const feature of current) {
    const { code, parentCode } = feature.properties
    if (parentCode && !known.has(parentCode)) throw new Error(`${code} 的父级 ${parentCode} 缺失`)
    feature.properties.hasChildren = childCodes.has(code)
    const path = spec.output.endsWith('.geojson') ? spec.output : `${spec.output}/${parentCode}.geojson`
    const group = groups.get(path) ?? []
    group.push(feature)
    groups.set(path, group)
  }
  let largestShard = 0
  for (const [path, features] of groups) largestShard = Math.max(largestShard, saveCollection(path, features))
  manifest.levels[spec.level] = { count: current.length, shards: groups.size, largestShard }
}
writeFileSync(new URL('manifest.json', output), JSON.stringify(manifest))
console.info(JSON.stringify(manifest, null, 2))
