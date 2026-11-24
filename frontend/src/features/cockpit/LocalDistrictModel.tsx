import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight, Box3, BufferAttribute, Color, DirectionalLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OrthographicCamera, Raycaster, Scene, SRGBColorSpace, TextureLoader, Vector2, Vector3, WebGLRenderer,
} from 'three'
import type { Object3D, Texture } from 'three'
import { Link } from 'react-router'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CockpitArea } from '../../api/client'
import { twinSites, type TwinId } from './twinSites'
import './navigation-map.css'
import './local-model.css'

const assetRoot = import.meta.env.BASE_URL + 'maps/local-model/'
const mapRoot = import.meta.env.BASE_URL + 'maps/'
const imageryBounds = { west: 115.405, east: 116.181, south: 39.798, north: 40.19 }
const districtBounds = { west: 115.416805, east: 116.169245, south: 39.810992, north: 40.177916 }
const surfaceLabels = { terrain: '地形', roads: '路网', water: '水系' }
type Surface = keyof typeof surfaceLabels
type Pick = { label: string; source: string; height?: number }
type View = '2d' | '3d'
type ModelPlace = { id: string; name: string; coordinates: readonly [number, number] }
type ModelMarker = { id: string; x: number; y: number; visible: boolean }
type DistrictModelProps = {
  area?: CockpitArea
  onSelectArea?: (areaId: string) => void
  onOpenTwin?: (id: TwinId) => void
  standaloneTwin?: TwinId
}

const displayedTowns = new Set(['qingshui', 'zhaitang', 'datai', 'junzhuang'])
const demoPopulation = new Intl.NumberFormat('zh-CN').format(392_000 / 10_000)
const initialPosition = new Vector3(5, 44, 63)
const topPosition = new Vector3(0, 76, 0)
const north = new Vector3(0, 0, -1)
const up = new Vector3(0, 1, 0)

async function readPlaces(signal: AbortSignal): Promise<ModelPlace[]> {
  const response = await fetch(mapRoot + 'mentougou.geojson', { signal })
  if (!response.ok) return []
  const collection = await response.json() as {
    features: Array<{ properties?: { id?: string; name?: string; kind?: string }; geometry?: { type?: string; coordinates?: unknown } }>
  }
  return collection.features.flatMap(({ properties, geometry }) => {
    const coordinates = geometry?.coordinates
    if (properties?.kind !== 'place' || !properties.id || !properties.name || geometry?.type !== 'Point'
      || !Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) return []
    return [{ id: properties.id, name: properties.name, coordinates: coordinates as [number, number] }]
  })
}

async function readModel(file: string, limit: number, signal: AbortSignal) {
  const response = await fetch(assetRoot + file, { signal })
  if (!response.ok || Number(response.headers.get('Content-Length')) > limit) throw new Error('Local model unavailable')
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength < 20 || bytes.byteLength > limit || new DataView(bytes).getUint32(0) !== 0x676c5446) {
    throw new Error('Invalid local model payload')
  }
  return (await new GLTFLoader().parseAsync(bytes, '')).scene
}

function releaseModel(object: Object3D) {
  object.traverse(child => {
    if (!(child instanceof Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) material.dispose()
  })
}

function applyModelStyle(object: Object3D) {
  const terrain = object.getObjectByName('terrain')
  const roads = object.getObjectByName('roads')
  const water = object.getObjectByName('water')
  if (!(terrain instanceof Mesh) || !(roads instanceof Mesh) || !(water instanceof Mesh)) {
    throw new Error('Invalid local district model')
  }
  const geometry = terrain.geometry
  geometry.computeBoundingBox()
  geometry.computeVertexNormals()
  const positions = geometry.getAttribute('position')
  const elevations = geometry.boundingBox
  if (!elevations) throw new Error('Local terrain has no elevation range')
  const lower = new Color('#476561')
  const higher = new Color('#90a087')
  const shade = new Color()
  const colors = new Float32Array(positions.count * 3)
  const min = elevations.min.y
  const relief = Math.max(1, elevations.max.y - min)
  for (let index = 0; index < positions.count; index++) {
    const height = (positions.getY(index) - min) / relief
    shade.copy(lower).lerp(higher, Math.pow(height, .72)).toArray(colors, index * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  for (const mesh of [terrain, roads, water]) mesh.material.dispose()
  terrain.material = new MeshStandardMaterial({ vertexColors: true, roughness: .93 })
  roads.material = new MeshBasicMaterial({ color: '#bcc3a1', transparent: true, opacity: .65, depthWrite: false })
  water.material = new MeshBasicMaterial({ color: '#3ea8de' })
  // The thin overlays need a small display offset to stay above the simplified terrain surface.
  roads.position.y += 18
  water.position.y += 12
  return terrain
}

function applyImagery(terrain: Mesh, texture: Texture) {
  const positions = terrain.geometry.getAttribute('position')
  const bounds = terrain.geometry.boundingBox
  if (!bounds || !(terrain.material instanceof MeshStandardMaterial)) return
  const uv = new Float32Array(positions.count * 2)
  const width = bounds.max.x - bounds.min.x
  const depth = bounds.max.z - bounds.min.z
  for (let index = 0; index < positions.count; index++) {
    const longitude = districtBounds.west + (positions.getX(index) - bounds.min.x) / width * (districtBounds.east - districtBounds.west)
    const latitude = districtBounds.north - (positions.getZ(index) - bounds.min.z) / depth * (districtBounds.north - districtBounds.south)
    uv[index * 2] = (longitude - imageryBounds.west) / (imageryBounds.east - imageryBounds.west)
    uv[index * 2 + 1] = (latitude - imageryBounds.south) / (imageryBounds.north - imageryBounds.south)
  }
  terrain.geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  texture.colorSpace = SRGBColorSpace
  terrain.material.map = texture
  terrain.material.color.set('#dbe6df')
  terrain.material.vertexColors = false
  terrain.material.needsUpdate = true
}

type ModelTools = { zoom: (amount: number) => void; reset: () => void; view: (mode: View) => void; focus: (areaId: string) => void }
type ModelPhase = 'loading' | 'ready' | 'unavailable'

export default function LocalDistrictModel({ area, onSelectArea, onOpenTwin, standaloneTwin }: DistrictModelProps) {
  const mount = useRef<HTMLDivElement>(null)
  const tools = useRef<ModelTools | undefined>(undefined)
  const [phase, setPhase] = useState<ModelPhase>('loading')
  const [picked, setPicked] = useState<Pick>()
  const [view, setView] = useState<View>('3d')
  const [markers, setMarkers] = useState<ModelMarker[]>([])
  const [places, setPlaces] = useState<ModelPlace[]>([])
  const [imagery, setImagery] = useState(false)
  const district = area?.level === 'district'
  const areaId = area?.id

  useEffect(() => {
    const element = mount.current
    if (!element) return
    const controller = new AbortController()
    let model: Object3D | undefined
    let renderer: WebGLRenderer | undefined
    let controls: OrbitControls | undefined
    let observer: ResizeObserver | undefined
    let unbindPicking: (() => void) | undefined
    let frame = 0
    let imageryTexture: Texture | undefined

    setPhase('loading')
    setView('3d')
    setPicked(undefined)
    setMarkers([])
    setImagery(false)

    async function initialize(host: HTMLDivElement) {
      const twin = standaloneTwin ? twinSites[standaloneTwin] : undefined
      const localModel = await readModel(twin?.file ?? 'mentougou.glb', twin ? 8_000_000 : 4_500_000, controller.signal)
      if (controller.signal.aborted) {
        releaseModel(localModel)
        return
      }
      model = localModel
      const terrain = twin ? undefined : applyModelStyle(localModel)
      if (twin) localModel.traverse(child => {
        if (!(child instanceof Mesh)) return
        child.geometry.computeVertexNormals()
        child.material.dispose()
        child.material = new MeshStandardMaterial({ color: '#92b6c9', roughness: .69 })
      })
      const bounds = new Box3().setFromObject(localModel)
      const rawSize = bounds.getSize(new Vector3())
      const scale = twin ? 52 / Math.max(rawSize.x, rawSize.z) : .001
      const size = rawSize.multiplyScalar(scale)
      localModel.scale.set(scale, twin ? scale : scale * 1.45, scale)
      localModel.position.copy(bounds.getCenter(new Vector3())).multiply(localModel.scale).negate()
      localModel.updateMatrixWorld()
      const scene = new Scene()
      scene.add(localModel, new AmbientLight('#eceffc', 1.55))
      const light = new DirectionalLight('#e4f5ff', 2.28)
      light.position.set(-24, 38, -19)
      scene.add(light)
      const camera = new OrthographicCamera(-1, 1, 1, -1, .1, 250)
      camera.position.copy(initialPosition)
      const surface = new WebGLRenderer({ alpha: true, antialias: true })
      renderer = surface
      surface.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      surface.domElement.setAttribute('role', 'img')
      surface.domElement.setAttribute('aria-label', twin ? twin.name + '建筑模型' : '门头沟区地形、路网和水系模型')
      host.append(surface.domElement)
      const orbit = new OrbitControls(camera, surface.domElement)
      controls = orbit
      orbit.enablePan = false
      orbit.enableZoom = false
      orbit.maxPolarAngle = Math.PI * .39
      orbit.minPolarAngle = .15
      orbit.update()
      surface.domElement.style.touchAction = 'pan-y'
      const ray = new Raycaster()
      const ground = new Raycaster()
      const pointer = new Vector2()
      let currentView: View = '3d'
      let positions: Array<{ id: string; point: Vector3 }> = []
      let focusArea = 'mentougou'
      const towardGround = new Vector3(0, -1, 0)
      const pointAt = (x: number, z: number) => {
        const world = localModel.localToWorld(new Vector3(x, bounds.max.y, z))
        world.y += 1
        if (terrain) {
          ground.set(world, towardGround)
          const hit = ground.intersectObject(terrain)[0]
          if (hit) world.y = hit.point.y + .13
        }
        return world
      }
      const pointFor = ([lon, lat]: ModelPlace['coordinates']) => pointAt(
        bounds.min.x + (lon - districtBounds.west) / (districtBounds.east - districtBounds.west) * size.x / scale,
        bounds.min.z + (districtBounds.north - lat) / (districtBounds.north - districtBounds.south) * size.z / scale,
      )
      let down: { x: number; y: number } | undefined
      const startPick = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY } }
      const endPick = (event: PointerEvent) => {
        const start = down
        down = undefined
        if (!start || event.button !== 0 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return
        const rect = surface.domElement.getBoundingClientRect()
        pointer.set((event.clientX - rect.left) * 2 / rect.width - 1, 1 - (event.clientY - rect.top) * 2 / rect.height)
        ray.setFromCamera(pointer, camera)
        const hit = ray.intersectObjects(localModel.children, true)[0]
        if (!hit) return
        if (twin) {
          setPicked({ label: twin.name, source: '项目本地三维模型' })
          return
        }
        const name = hit.object.name as Surface
        if (!Object.hasOwn(surfaceLabels, name)) return
        const offset = name === 'roads' ? 18 : name === 'water' ? 12 : 0
        setPicked({ ...surfaceDetail(name), height: Math.round(localModel.worldToLocal(hit.point).y - offset) })
      }
      surface.domElement.addEventListener('pointerdown', startPick)
      surface.domElement.addEventListener('pointerup', endPick)
      unbindPicking = () => {
        surface.domElement.removeEventListener('pointerdown', startPick)
        surface.domElement.removeEventListener('pointerup', endPick)
      }
      const draw = () => {
        if (frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          surface.render(scene, camera)
          if (positions.length > 0) {
            const point = new Vector3()
            setMarkers(positions.map(({ id, point: world }) => {
              point.copy(world).project(camera)
              return { id, x: (point.x + 1) * 50, y: (1 - point.y) * 50, visible: Math.abs(point.x) < .94 && Math.abs(point.y) < .90 }
            }))
          }
        })
      }
      const fit = () => {
        const { clientWidth: width, clientHeight: height } = host
        if (!width || !height) return
        const aspect = width / height
        const heightFactor = currentView === '2d' ? .58 : .39
        const halfHeight = Math.max(size.z * heightFactor + size.y * .64, size.x * .565 / aspect)
        camera.left = -halfHeight * aspect
        camera.right = halfHeight * aspect
        camera.top = halfHeight
        camera.bottom = -halfHeight
        camera.updateProjectionMatrix()
        surface.setSize(width, height, false)
        draw()
      }
      const positionCamera = (target: Vector3, zoom = 1) => {
        camera.up.copy(currentView === '2d' ? north : up)
        orbit.target.copy(target)
        camera.position.copy(target).add(currentView === '2d' ? topPosition : initialPosition)
        camera.zoom = zoom
        camera.lookAt(target)
        camera.updateMatrixWorld()
        camera.updateProjectionMatrix()
        draw()
      }
      const focus = (id: string) => {
        focusArea = id
        const town = positions.find(position => position.id === id)
        positionCamera(town?.point ?? new Vector3(), town ? 2.4 : 1)
      }
      tools.current = {
        zoom: amount => {
          camera.zoom = Math.max(.75, Math.min(10, camera.zoom * amount))
          camera.updateProjectionMatrix()
          draw()
        },
        reset: () => {
          focus(focusArea)
          setPicked(undefined)
        },
        view: mode => {
          currentView = mode
          orbit.enabled = mode === '3d'
          positionCamera(orbit.target, camera.zoom)
          fit()
        },
        focus,
      }
      orbit.addEventListener('change', draw)
      observer = new ResizeObserver(fit)
      observer.observe(host)
      fit()
      setPhase('ready')
      if (!terrain) return
      positions = [{ id: 'population', point: pointFor([115.85, 40.025]) }]
      const [tianjieX, tianjieZ] = twinSites.tianjie.modelPoint
      const [jingxiX, jingxiZ] = twinSites.jingxi.modelPoint
      positions.push({ id: 'twins', point: pointAt((tianjieX + jingxiX) / 2, (tianjieZ + jingxiZ) / 2) })
      void readPlaces(controller.signal).then(items => {
        if (controller.signal.aborted) return
        positions.push(...items.map(place => ({ id: place.id, point: pointFor(place.coordinates) })))
        setPlaces(items)
        focus(focusArea)
      }).catch(() => undefined)
      new TextureLoader().load(mapRoot + 'mentougou-sentinel-2-20261008.webp', texture => {
        if (controller.signal.aborted) {
          texture.dispose()
          return
        }
        imageryTexture = texture
        applyImagery(terrain, texture)
        setImagery(true)
        draw()
      }, undefined, () => undefined)
    }

    void initialize(element).catch(() => {
      if (!controller.signal.aborted) setPhase('unavailable')
    })
    return () => {
      controller.abort()
      cancelAnimationFrame(frame)
      observer?.disconnect()
      controls?.dispose()
      unbindPicking?.()
      imageryTexture?.dispose()
      if (model) releaseModel(model)
      renderer?.dispose()
      renderer?.forceContextLoss()
      renderer?.domElement.remove()
      tools.current = undefined
    }
  }, [standaloneTwin])

  const townScope = area?.breadcrumbs.find(crumb => crumb.id !== 'mentougou')?.id
  useEffect(() => {
    if (phase === 'ready') tools.current?.focus(townScope ?? 'mentougou')
  }, [phase, townScope])

  function changeView(mode: View) {
    if (mode === view) return
    setView(mode)
    tools.current?.view(mode)
  }

  const population = markers.find(marker => marker.id === 'population' && marker.visible)
  const twinGroup = markers.find(marker => marker.id === 'twins' && marker.visible)
  const currentTown = places.find(place => place.id === townScope)
  const currentTownMarker = markers.find(marker => marker.id === townScope && marker.visible)
  const pins = markers.flatMap(marker => {
    const place = places.find(item => item.id === marker.id)
    return marker.visible && place && displayedTowns.has(place.id) ? [{ ...marker, name: place.name }] : []
  })

  return (
    <section className="district-local-model" data-model-ready={phase} data-view={view}
      data-twin={Boolean(standaloneTwin)} aria-label={standaloneTwin ? twinSites[standaloneTwin].name + '模型' : '门头沟区本地模型'}>
      <div className="district-local-model-canvas" ref={mount}>
        {district && population && (
          <div className="model-population" style={{ left: population.x + '%', top: population.y + '%' }}>
            <span className="model-beacon" aria-hidden="true" />
            <Link className="model-callout" to="?topic=population" aria-label="查看全区人口专题">
              <span>门头沟区常住人口</span>
              <p><strong>{demoPopulation}</strong> 万人</p>
              <small>演示数据</small>
            </Link>
          </div>
        )}
        {district && onSelectArea && pins.map(pin => (
          <button key={pin.id} type="button" className="model-place" data-place={pin.id} style={{ left: pin.x + '%', top: pin.y + '%' }}
            aria-label={'查看' + pin.name} onClick={() => onSelectArea(pin.id)}>
            <span className="model-beacon" aria-hidden="true" /><span className="model-place-name">{pin.name}</span>
          </button>
        ))}
        {areaId && !district && currentTownMarker && (
          <div className="model-place model-place-current" style={{ left: currentTownMarker.x + '%', top: currentTownMarker.y + '%' }}>
            <span className="model-beacon" aria-hidden="true" /><span className="model-place-name">{currentTown?.name ?? area?.name}</span>
          </div>
        )}
        {district && twinGroup && onOpenTwin && (
          <div className="model-twin-point" style={{ left: twinGroup.x + '%', top: twinGroup.y + '%' }}>
            <span className="model-beacon" aria-hidden="true" />
            <div className="model-twin-label">
              <button type="button" onClick={() => onOpenTwin('tianjie')}>长安天街</button>
              <button type="button" onClick={() => onOpenTwin('jingxi')}>京西智谷</button>
            </div>
          </div>
        )}
      </div>
      {phase === 'loading' && <p className="district-model-state" role="status">正在加载本地三维模型</p>}
      {phase === 'unavailable' && <p className="district-model-state" role="status">本地三维模型暂不可用</p>}
      {phase === 'ready' && (
        <>
          {onOpenTwin && (!district || !twinGroup) && <nav className="district-local-landmarks" aria-label="重点地标">
            <button type="button" onClick={() => onOpenTwin('tianjie')}>长安天街</button>
            <button type="button" onClick={() => onOpenTwin('jingxi')}>京西智谷</button>
          </nav>}
          {picked && (
            <aside className="district-local-model-detail" aria-label="模型要素详情">
              <strong>{picked.label}</strong>
              <span>{picked.source}</span>
              {typeof picked.height === 'number' && <span>模型高程 {picked.height} 米</span>}
              <button type="button" onClick={() => setPicked(undefined)}>关闭详情</button>
            </aside>
          )}
          {!standaloneTwin && <ul className="district-local-model-key" aria-label="模型图例">
            {(Object.keys(surfaceLabels) as Surface[]).map(key => (
              <li key={key} data-surface={key}><button type="button" onClick={() => setPicked(surfaceDetail(key))}>{surfaceLabels[key]}</button></li>
            ))}
          </ul>}
          {imagery && <a href="https://ewds.climate.copernicus.eu/licences/ec-sentinel" target="_blank" rel="noreferrer"
            className="model-imagery-source">含经修改的 Copernicus Sentinel 2026 数据</a>}
          <div className="navigation-map-tools" role="group" aria-label="本地模型操作">
            <div className="navigation-map-mode" role="group" aria-label="模型视角">
              <button type="button" aria-pressed={view === '2d'} onClick={() => changeView('2d')}>2D</button>
              <button type="button" aria-pressed={view === '3d'} onClick={() => changeView('3d')}>3D</button>
            </div>
            <div className="navigation-map-zoom">
              <button type="button" aria-label="缩小模型" onClick={() => tools.current?.zoom(.8)}>−</button>
              <button type="button" aria-label="放大模型" onClick={() => tools.current?.zoom(1.25)}>+</button>
              <button type="button" onClick={() => tools.current?.reset()}>复位视角</button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function surfaceDetail(key: Surface): Pick {
  const source = key === 'terrain' ? '门头沟地形' : key === 'roads' ? '路网' : '水域'
  return { label: surfaceLabels[key], source: `${source}模型` }
}
