import { useEffect, useMemo, useRef, useState } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import {
  ACESFilmicToneMapping, AmbientLight, Box3, BufferAttribute, Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OrthographicCamera, Raycaster, Scene, Texture, Vector2, Vector3, WebGLRenderer,
} from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import { Link } from 'react-router'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { CockpitArea } from '../../api/client'
import MapGlobeControl from './MapGlobeControl'
import { loadTerrainDetail, terrainUvProjection } from './detailTerrainTexture'
import {
  boundaryCenter, boundaryContains, boundaryFor, clearBoundaryMask, geoCoordinates,
  maskToBoundary, modelCoordinates, readBoundaries, terrainSurfaceIndex,
} from './localModelGeography'
import type { GeoBoundary } from './localModelGeography'
import { applyTwinMaterials } from './twinMaterials'
import { createTwinSurroundings } from './twinSurroundings'
import { twinSites, type TwinId } from './twinSites'
import './local-model.css'

const assetRoot = import.meta.env.BASE_URL + 'maps/local-model/'
const districtModelLimit = 26_000_000
const twinModelLimit = 26_000_000
const renderPixelLimit = 8_300_000
const surfaceLabels = { terrain: '地形', roads: '路网', water: '水系' }
type Surface = keyof typeof surfaceLabels
type Pick = { label: string; source: string; height?: number }
type View = '2d' | '3d'
type ModelPlace = { id: string; name: string; boundary: GeoBoundary }
type ModelMarker = { id: string; x: number; y: number; visible: boolean }
type DistrictModelProps = {
  area?: CockpitArea
  onSelectArea?: (areaId: string) => void
  onOpenTwin?: (id: TwinId) => void
  standaloneTwin?: TwinId
  viewMode?: View
  onViewModeChange?: (mode: View) => void
}

const displayedTowns = new Set(['qingshui', 'zhaitang', 'datai', 'junzhuang'])
const demoPopulation = new Intl.NumberFormat('zh-CN').format(392_000 / 10_000)
const initialPosition = new Vector3(5, 44, 63)
const twinPosition = new Vector3(38, 52, 73)
const topPosition = new Vector3(0, 76, 0)
const north = new Vector3(0, 0, -1)
const up = new Vector3(0, 1, 0)

async function readModel(file: string, limit: number, signal: AbortSignal) {
  const response = await fetch(assetRoot + file, { signal })
  if (!response.ok || Number(response.headers.get('Content-Length')) > limit) throw new Error('Local model unavailable')
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength < 20 || bytes.byteLength > limit || new DataView(bytes).getUint32(0) !== 0x676c5446) {
    throw new Error('Invalid local model payload')
  }
  return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, assetRoot)).scene
}

async function readDetailedModel(file: string, twin: boolean, signal: AbortSignal) {
  if (twin) {
    try {
      return await readModel(file.replace(/\.glb$/, '-detail.glb'), 36_000_000, signal)
    } catch {
      signal.throwIfAborted()
    }
  }
  try {
    return await readModel(file.replace(/\.glb$/, '-hd.glb'), twin ? twinModelLimit : districtModelLimit, signal)
  } catch {
    signal.throwIfAborted()
    return readModel(file, twin ? 8_000_000 : 4_500_000, signal)
  }
}

function modelResources(object: Object3D) {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  object.traverse(child => {
    if (!(child instanceof Mesh)) return
    geometries.add(child.geometry)
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (materials.has(material)) continue
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value)
      }
    }
  })
  return { geometries, materials, textures }
}

function releaseModel(object: Object3D) {
  const { geometries, materials, textures } = modelResources(object)
  const bitmaps = new Set<ImageBitmap>()
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) bitmaps.add(texture.image)
    texture.dispose()
  }
  for (const bitmap of bitmaps) bitmap.close()
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
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
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals()
  const positions = geometry.getAttribute('position')
  const elevations = geometry.boundingBox
  if (!elevations) throw new Error('Local terrain has no elevation range')
  const nativeTexture = terrain.material instanceof MeshStandardMaterial && Boolean(terrain.material.map)
  if (!nativeTexture) {
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
    terrain.material.dispose()
    terrain.material = new MeshStandardMaterial({ vertexColors: true, roughness: .93 })
  }
  roads.material.dispose()
  water.material.dispose()
  roads.material = new MeshBasicMaterial({ color: '#d9c6a3', transparent: true, opacity: .65, depthWrite: false })
  water.material = new MeshBasicMaterial({ color: '#6dcef4' })
  // The thin overlays need a small display offset to stay above the simplified terrain surface.
  roads.position.y += 18
  water.position.y += 12
  return { terrain, nativeTexture }
}

type ModelTools = {
  reset: () => void
  view: (mode: View) => void
  scope: (boundary: GeoBoundary | undefined, places: ModelPlace[]) => void
}
type ModelPhase = 'loading' | 'ready' | 'unavailable'

export default function LocalDistrictModel({ area, onSelectArea, onOpenTwin, standaloneTwin, viewMode, onViewModeChange }: DistrictModelProps) {
  const mount = useRef<HTMLDivElement>(null)
  const tools = useRef<ModelTools | undefined>(undefined)
  const [phase, setPhase] = useState<ModelPhase>('loading')
  const [appliedScope, setAppliedScope] = useState<{ id: string; boundary?: GeoBoundary }>()
  const [scopeError, setScopeError] = useState<string>()
  const [picked, setPicked] = useState<Pick>()
  const [localView, setLocalView] = useState<View>('3d')
  const view = viewMode ?? localView
  const [markers, setMarkers] = useState<ModelMarker[]>([])
  const district = area?.level === 'district'
  const areaId = area?.id
  const selectArea = useRef(onSelectArea)
  useEffect(() => { selectArea.current = onSelectArea }, [onSelectArea])
  const town = area?.breadcrumbs[1]
  const towns = useQuery({
    queryKey: ['local-model-boundaries'],
    queryFn: standaloneTwin ? skipToken : ({ signal }) => readBoundaries(signal),
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const townBoundary = town && boundaryFor(town, towns.data)
  const villages = useQuery({
    queryKey: ['local-model-boundaries', townBoundary?.code],
    queryFn: townBoundary ? ({ signal }) => readBoundaries(signal, townBoundary.code) : skipToken,
    staleTime: Infinity,
  })
  const village = area?.level === 'village'
  const villageBoundary = village ? boundaryFor(area, villages.data) : undefined
  const boundary = villageBoundary ?? townBoundary
  const boundaryLoading = !district && !standaloneTwin && (towns.isPending || (village && townBoundary && villages.isPending))
  const childGeography = district ? towns.data : villages.data
  const children = area?.children
  const places = useMemo(() => {
    if (!children || !childGeography) return []
    return children.flatMap(item => {
      const place = boundaryFor(item, childGeography)
      return place ? [{ id: item.id, name: item.name, boundary: place }] : []
    })
  }, [children, childGeography])

  useEffect(() => {
    const element = mount.current
    if (!element) return
    const controller = new AbortController()
    let model: Object3D | undefined
    let surroundings: Object3D | undefined
    let renderer: WebGLRenderer | undefined
    let controls: OrbitControls | undefined
    let observer: ResizeObserver | undefined
    let unbindInput: (() => void) | undefined
    let frame = 0
    let boundaryTexture: Texture | undefined
    let terrainDetail: Texture | undefined
    let detailRequest: AbortController | undefined
    let resetTerrainTexture: (() => void) | undefined

    setPhase('loading')
    setLocalView('3d')
    setPicked(undefined)
    setMarkers([])
    setAppliedScope(undefined)

    async function initialize(host: HTMLDivElement) {
      const twin = standaloneTwin ? twinSites[standaloneTwin] : undefined
      const localModel = await readDetailedModel(twin?.file ?? 'mentougou.glb', Boolean(twin), controller.signal)
      if (controller.signal.aborted) {
        releaseModel(localModel)
        return
      }
      model = localModel
      const districtStyle = twin ? undefined : applyModelStyle(localModel)
      const terrain = districtStyle?.terrain
      const terrainMaterial = terrain?.material instanceof MeshStandardMaterial ? terrain.material : undefined
      const overviewTexture = districtStyle?.nativeTexture ? terrainMaterial?.map : undefined
      const projectUv = terrain && overviewTexture ? terrainUvProjection(terrain.geometry) : undefined
      if (standaloneTwin) applyTwinMaterials(localModel, standaloneTwin)
      const bounds = new Box3().setFromObject(localModel)
      const geographyBounds = terrain ? new Box3().setFromObject(terrain) : bounds
      const rawSize = bounds.getSize(new Vector3())
      const scale = twin ? 52 / Math.max(rawSize.x, rawSize.z) : .001
      const size = rawSize.multiplyScalar(scale)
      localModel.scale.set(scale, twin ? scale : scale * 1.45, scale)
      localModel.position.copy(bounds.getCenter(new Vector3())).multiply(localModel.scale).negate()
      localModel.updateMatrixWorld()
      const scene = new Scene()
      scene.add(localModel)
      const setting = standaloneTwin ? await createTwinSurroundings(standaloneTwin, bounds, scale, controller.signal) : undefined
      if (controller.signal.aborted) {
        if (setting) releaseModel(setting.object)
        return
      }
      if (setting) {
        surroundings = setting.object
        scene.add(surroundings)
      }
      if (twin) {
        scene.add(new HemisphereLight('#d9ecff', '#465361', 1.08))
        const keyLight = new DirectionalLight('#fff0da', 2.12)
        keyLight.position.set(-28, 45, 35)
        const skyLight = new DirectionalLight('#8ec9ef', .85)
        skyLight.position.set(31, 25, -30)
        scene.add(keyLight, skyLight)
      } else {
        const light = new DirectionalLight('#e4f5ff', 2.28)
        light.position.set(-24, 38, -19)
        scene.add(light, new AmbientLight('#eaf5ff', 1.75))
      }
      const camera = new OrthographicCamera(-1, 1, 1, -1, .1, 250)
      camera.position.copy(twin ? twinPosition : initialPosition)
      const surface = new WebGLRenderer({ alpha: true, antialias: true })
      renderer = surface
      if (twin) {
        surface.toneMapping = ACESFilmicToneMapping
        surface.toneMappingExposure = 1.04
      }
      const anisotropy = Math.min(8, surface.capabilities.getMaxAnisotropy())
      for (const texture of modelResources(localModel).textures) texture.anisotropy = anisotropy
      surface.domElement.setAttribute('role', 'img')
      surface.domElement.setAttribute('aria-label', twin ? twin.name + '建筑模型' : '门头沟区地形、路网和水系模型')
      surface.domElement.setAttribute('aria-description', '使用滚轮或加减键缩放')
      surface.domElement.tabIndex = 0
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
      let activeBoundary: GeoBoundary | undefined
      let scopeInitialized = false
      const districtTerrainIndex = terrain?.geometry.index ?? null
      let regionTerrainIndex: BufferAttribute | null | undefined
      let childPlaces: ModelPlace[] = []
      let viewSize = setting?.size ?? size
      let viewTarget = new Vector3()
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
      const pointFor = (coordinates: [number, number]) => pointAt(...modelCoordinates(coordinates, geographyBounds))
      let down: { x: number; y: number } | undefined
      const startPick = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY } }
      const endPick = (event: PointerEvent) => {
        const start = down
        down = undefined
        if (!start || event.button !== 0 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return
        const rect = surface.domElement.getBoundingClientRect()
        pointer.set((event.clientX - rect.left) * 2 / rect.width - 1, 1 - (event.clientY - rect.top) * 2 / rect.height)
        ray.setFromCamera(pointer, camera)
        const hits = ray.intersectObjects(localModel.children, true)
        const geographicPoint = (point: Vector3) => {
          const local = localModel.worldToLocal(point.clone())
          return geoCoordinates(local.x, local.z, geographyBounds)
        }
        const scope = activeBoundary
        const hit = scope
          ? hits.find(item => boundaryContains(scope, geographicPoint(item.point)))
          : hits[0]
        if (!hit) return
        if (twin) {
          setPicked({ label: twin.name, source: '项目本地三维模型' })
          return
        }
        const name = hit.object.name as Surface
        if (!Object.hasOwn(surfaceLabels, name)) return
        if (name === 'terrain' && childPlaces.length) {
          const coordinates = geographicPoint(hit.point)
          const child = childPlaces.find(place => boundaryContains(place.boundary, coordinates))
          if (child && selectArea.current) {
            selectArea.current(child.id)
            return
          }
        }
        const offset = name === 'roads' ? 18 : name === 'water' ? 12 : 0
        setPicked({ ...surfaceDetail(name), height: Math.round(localModel.worldToLocal(hit.point).y - offset) })
      }
      const draw = () => {
        if (frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          surface.render(scene, camera)
          if (twin) return
          const point = new Vector3()
          setMarkers(positions.map(({ id, point: world }) => {
            point.copy(world).project(camera)
            return { id, x: (point.x + 1) * 50, y: (1 - point.y) * 50, visible: Math.abs(point.x) < .94 && Math.abs(point.y) < .90 }
          }))
        })
      }
      resetTerrainTexture = () => {
        detailRequest?.abort()
        if (!terrainMaterial || !overviewTexture || !projectUv) return
        terrainMaterial.map = overviewTexture
        terrainDetail?.dispose()
        terrainDetail = undefined
        surface.domElement.dataset.terrainTexture = 'overview'
      }
      const refineTerrain = (boundary?: GeoBoundary) => {
        resetTerrainTexture?.()
        if (!boundary || !terrainMaterial || !projectUv) return
        const { west, east, south, north: top } = boundary.bounds
        const scope = [[west, south], [west, top], [east, south], [east, top]].map(([longitude, latitude]) =>
          projectUv(modelCoordinates([longitude, latitude], geographyBounds)))
        const request = new AbortController()
        detailRequest = request
        void loadTerrainDetail(scope, surface.capabilities.maxTextureSize, request.signal).then(texture => {
          if (controller.signal.aborted || request.signal.aborted) {
            texture.dispose()
            return
          }
          terrainDetail = texture
          texture.anisotropy = anisotropy
          terrainMaterial.map = texture
          surface.domElement.dataset.terrainTexture = 'detail'
          draw()
        }).catch(() => request.abort())
      }
      const anchor = new Vector3()
      const movement = new Vector3()
      const zoomAt = (factor: number, x = 0, y = 0) => {
        const next = Math.max(.6, Math.min(12, camera.zoom * factor))
        if (next === camera.zoom) return
        anchor.set(x, y, 0).unproject(camera)
        camera.zoom = next
        camera.updateProjectionMatrix()
        movement.set(x, y, 0).unproject(camera)
        movement.subVectors(anchor, movement)
        camera.position.add(movement)
        orbit.target.add(movement)
        camera.updateMatrixWorld()
        draw()
      }
      const wheelZoom = (event: WheelEvent) => {
        if (event.ctrlKey || event.metaKey || !event.deltaY) return
        const rect = surface.domElement.getBoundingClientRect()
        if (!(rect.width && rect.height)) return
        event.preventDefault()
        const units = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? rect.height : 1
        const delta = Math.max(-300, Math.min(300, event.deltaY * units))
        zoomAt(Math.exp(-delta * .002),
          (event.clientX - rect.left) * 2 / rect.width - 1,
          1 - (event.clientY - rect.top) * 2 / rect.height)
      }
      const keyZoom = (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey || event.altKey || !['+', '=', '-'].includes(event.key)) return
        event.preventDefault()
        zoomAt(event.key === '-' ? .8 : 1.25)
      }
      surface.domElement.addEventListener('pointerdown', startPick)
      surface.domElement.addEventListener('pointerup', endPick)
      surface.domElement.addEventListener('keydown', keyZoom)
      host.addEventListener('wheel', wheelZoom, { passive: false })
      unbindInput = () => {
        surface.domElement.removeEventListener('pointerdown', startPick)
        surface.domElement.removeEventListener('pointerup', endPick)
        surface.domElement.removeEventListener('keydown', keyZoom)
        host.removeEventListener('wheel', wheelZoom)
      }
      const adjustProjection = () => {
        const { clientWidth: width, clientHeight: height } = host
        if (!width || !height) return
        const aspect = width / height
        camera.updateMatrixWorld()
        const axes = camera.matrixWorld.elements
        const span = (axis: number) => .5 * (
          Math.abs(axes[axis]) * viewSize.x + Math.abs(axes[axis + 1]) * viewSize.y + Math.abs(axes[axis + 2]) * viewSize.z
        )
        const halfHeight = Math.max(span(4), span(0) / aspect) * 1.12
        camera.left = -halfHeight * aspect
        camera.right = halfHeight * aspect
        camera.top = halfHeight
        camera.bottom = -halfHeight
        camera.updateProjectionMatrix()
      }
      const fit = () => {
        const { clientWidth: width, clientHeight: height } = host
        if (!width || !height) return
        adjustProjection()
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(renderPixelLimit / (width * height)))
        if (ratio !== surface.getPixelRatio()) surface.setPixelRatio(ratio)
        surface.setSize(width, height, false)
        draw()
      }
      const positionCamera = (target: Vector3, zoom = 1) => {
        camera.up.copy(currentView === '2d' ? north : up)
        orbit.target.copy(target)
        camera.position.copy(target).add(currentView === '2d' ? topPosition : twin ? twinPosition : initialPosition)
        camera.zoom = zoom
        camera.lookAt(target)
        camera.updateMatrixWorld()
        adjustProjection()
        draw()
      }
      tools.current = {
        reset: () => {
          positionCamera(viewTarget)
          setPicked(undefined)
        },
        view: mode => {
          if (mode === currentView) return
          currentView = mode
          orbit.enabled = mode === '3d'
          positionCamera(orbit.target, camera.zoom)
          fit()
        },
        scope: (nextBoundary, nextPlaces) => {
          if (!terrain) return
          childPlaces = nextPlaces
          const refit = !scopeInitialized || nextBoundary !== activeBoundary
          if (refit && nextBoundary) {
            regionTerrainIndex ??= terrainSurfaceIndex(terrain)
            terrain.geometry.setIndex(regionTerrainIndex)
            const clipped = maskToBoundary(localModel, nextBoundary, geographyBounds)
            boundaryTexture?.dispose()
            boundaryTexture = clipped.texture
            const { west, east, south, north: top } = nextBoundary.bounds
            const [left, front] = modelCoordinates([west, south], geographyBounds)
            const [right, back] = modelCoordinates([east, top], geographyBounds)
            const sample = pointFor(boundaryCenter(nextBoundary))
            viewTarget = localModel.localToWorld(new Vector3((left + right) / 2, 0, (front + back) / 2))
            const hasRange = clipped.topY > clipped.bottomY
            viewTarget.y = hasRange ? localModel.localToWorld(new Vector3(0, (clipped.bottomY + clipped.topY) / 2, 0)).y : sample.y
            viewSize = new Vector3((right - left) * scale,
              hasRange ? (clipped.topY - clipped.bottomY) * localModel.scale.y : Math.max(.03, Math.min(.5, (right - left) * scale / 4)),
              (front - back) * scale)
          } else if (refit) {
            if (boundaryTexture) {
              clearBoundaryMask(localModel)
              boundaryTexture.dispose()
              terrain.geometry.setIndex(districtTerrainIndex)
            }
            boundaryTexture = undefined
            viewSize = size
            viewTarget = new Vector3()
          }
          activeBoundary = nextBoundary
          scopeInitialized = true
          positions = []
          if (!nextBoundary) {
            const [tianjieX, tianjieZ] = twinSites.tianjie.modelPoint
            const [jingxiX, jingxiZ] = twinSites.jingxi.modelPoint
            positions = [
              { id: 'population', point: pointFor([115.85, 40.025]) },
              { id: 'twins', point: pointAt((tianjieX + jingxiX) / 2, (tianjieZ + jingxiZ) / 2) },
            ]
          }
          positions.push(...nextPlaces.map(place => ({ id: place.id, point: pointFor(boundaryCenter(place.boundary)) })))
          if (refit) {
            refineTerrain(nextBoundary)
            setPicked(undefined)
            positionCamera(viewTarget)
            fit()
          } else {
            draw()
          }
        },
      }
      orbit.addEventListener('change', () => {
        adjustProjection()
        draw()
      })
      observer = new ResizeObserver(fit)
      observer.observe(host)
      fit()
      setPhase('ready')
    }

    void initialize(element).catch(() => {
      if (!controller.signal.aborted) setPhase('unavailable')
    })
    return () => {
      controller.abort()
      resetTerrainTexture?.()
      cancelAnimationFrame(frame)
      observer?.disconnect()
      controls?.dispose()
      unbindInput?.()
      if (model) releaseModel(model)
      if (surroundings) releaseModel(surroundings)
      renderer?.dispose()
      renderer?.forceContextLoss()
      renderer?.domElement.remove()
      tools.current = undefined
    }
  }, [standaloneTwin])

  useEffect(() => {
    if (phase !== 'ready' || !areaId || boundaryLoading || !(district || boundary)) return
    try {
      tools.current?.scope(boundary, places)
      setAppliedScope({ id: areaId, boundary })
      setScopeError(undefined)
    } catch {
      setScopeError(areaId)
    }
  }, [areaId, boundary, boundaryLoading, district, phase, places])

  useEffect(() => {
    if (phase === 'ready') tools.current?.view(view)
  }, [phase, view])

  function changeView(mode: View) {
    if (mode === view) return
    if (onViewModeChange) onViewModeChange(mode)
    else setLocalView(mode)
  }

  const population = markers.find(marker => marker.id === 'population' && marker.visible)
  const twinGroup = markers.find(marker => marker.id === 'twins' && marker.visible)
  const pins = markers.flatMap(marker => {
    const place = places.find(item => item.id === marker.id)
    return marker.visible && place ? [{ ...marker, name: place.name }] : []
  })
  const ready = phase === 'ready' && (standaloneTwin || (appliedScope?.id === areaId && appliedScope?.boundary === boundary))
  const failed = phase === 'unavailable' || (areaId !== undefined && scopeError === areaId)
    || (!district && !standaloneTwin && !boundaryLoading && !boundary)
  const modelPhase = failed ? 'unavailable' : ready ? 'ready' : 'loading'
  const scopeId = standaloneTwin ?? (village && !villageBoundary ? town?.id : areaId)
  const modelName = standaloneTwin ? twinSites[standaloneTwin].name : area?.name ?? '门头沟区'

  useEffect(() => {
    mount.current?.querySelector('canvas')?.setAttribute('aria-label', modelName + '本地模型画布')
  }, [modelName, phase])

  return (
    <section className="district-local-model" data-model-ready={modelPhase} data-view={view}
      data-model-scope={modelPhase === 'ready' ? scopeId : undefined}
      data-twin={Boolean(standaloneTwin)} aria-label={modelName + '本地模型'}>
      <div className="district-local-model-canvas" ref={mount}>
        {district && population && (
          <div className="model-population" style={{ left: population.x + '%', top: population.y + '%' }}>
            <span className="model-beacon" aria-hidden="true" />
            <Link className="model-callout" to="/topics/population" target="_blank" rel="noopener noreferrer" aria-label="查看全区人口专题">
              <span>门头沟区常住人口</span>
              <p><strong>{demoPopulation}</strong> 万人</p>
              <small>演示数据</small>
            </Link>
          </div>
        )}
        {onSelectArea && pins.map(pin => (
          <button key={pin.id} type="button" className="model-place" data-place={pin.id}
            data-featured={!district || displayedTowns.has(pin.id)} style={{ left: pin.x + '%', top: pin.y + '%' }}
            aria-label={'查看' + pin.name} onClick={() => onSelectArea(pin.id)}>
            <span className="model-beacon" aria-hidden="true" /><span className="model-place-name">{pin.name}</span>
          </button>
        ))}
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
      {modelPhase === 'loading' && <p className="district-model-state" role="status">正在加载{modelName}模型</p>}
      {modelPhase === 'unavailable' && <p className="district-model-state" role="status">{modelName}模型暂不可用</p>}
      {modelPhase === 'ready' && (
        <>
          {district && onOpenTwin && !twinGroup && <nav className="district-local-landmarks" aria-label="重点地标">
            <button type="button" onClick={() => onOpenTwin('tianjie')}>长安天街</button>
            <button type="button" onClick={() => onOpenTwin('jingxi')}>京西智谷</button>
          </nav>}
          {village && !villageBoundary && <p className="model-region-note" role="status">本地村社边界暂不可用，当前显示{town?.name}模型。</p>}
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
          <MapGlobeControl view={view} onViewChange={changeView} onReset={() => tools.current?.reset()} />
        </>
      )}
    </section>
  )
}

function surfaceDetail(key: Surface): Pick {
  const source = key === 'terrain' ? '门头沟地形' : key === 'roads' ? '路网' : '水域'
  return { label: surfaceLabels[key], source: `${source}模型` }
}
