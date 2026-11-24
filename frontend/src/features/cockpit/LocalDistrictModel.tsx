import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight, Box3, BufferAttribute, Color, DirectionalLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OrthographicCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three'
import type { Object3D } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import './local-model.css'

const assetRoot = import.meta.env.BASE_URL + 'maps/local-model/'
const landmarkFiles = { tianjie: { label: '天街', file: 'tianjie.glb' }, jingxi: { label: '京西智谷', file: 'jingxi.glb' } }
const surfaceLabels = { terrain: '地形', roads: '路网', water: '水系' }
type Surface = keyof typeof surfaceLabels
type Landmark = keyof typeof landmarkFiles
type Pick = { label: string; source: string; height?: number }

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
  const lower = new Color('#17354a')
  const higher = new Color('#709cae')
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
  roads.material = new MeshBasicMaterial({ color: '#d9b376' })
  water.material = new MeshBasicMaterial({ color: '#46bef4' })
  // The thin overlays need a small display offset to stay above the simplified terrain surface.
  roads.position.y += 18
  water.position.y += 12
}

type ModelTools = { zoom: (amount: number) => void; reset: () => void; landmark: (id: Landmark) => Promise<void> }
type ModelPhase = 'loading' | 'ready' | 'unavailable'

export default function LocalDistrictModel() {
  const mount = useRef<HTMLDivElement>(null)
  const tools = useRef<ModelTools | undefined>(undefined)
  const [phase, setPhase] = useState<ModelPhase>('loading')
  const [picked, setPicked] = useState<Pick>()
  const [landmarkPending, setLandmarkPending] = useState<Landmark>()
  const [landmarkError, setLandmarkError] = useState(false)

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

    async function initialize(host: HTMLDivElement) {
      const localModel = await readModel('mentougou.glb', 4_500_000, controller.signal)
      if (controller.signal.aborted) {
        releaseModel(localModel)
        return
      }
      model = localModel
      applyModelStyle(localModel)
      const bounds = new Box3().setFromObject(localModel)
      const size = bounds.getSize(new Vector3()).multiplyScalar(.001)
      localModel.scale.set(.001, .00145, .001)
      localModel.position.copy(bounds.getCenter(new Vector3())).multiply(localModel.scale).negate()
      const scene = new Scene()
      scene.add(localModel, new AmbientLight('#d6eafa', 1.28))
      const light = new DirectionalLight('#ebf4ff', 2.35)
      light.position.set(-24, 38, -19)
      scene.add(light)
      const camera = new OrthographicCamera(-1, 1, 1, -1, .1, 250)
      camera.position.set(7, 48, 65)
      const surface = new WebGLRenderer({ alpha: true, antialias: true })
      renderer = surface
      surface.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      surface.domElement.setAttribute('role', 'img')
      surface.domElement.setAttribute('aria-label', '门头沟区实测地形、路网和水系三维模型')
      host.append(surface.domElement)
      const orbit = new OrbitControls(camera, surface.domElement)
      controls = orbit
      orbit.enablePan = false
      orbit.enableZoom = false
      orbit.maxPolarAngle = Math.PI * .39
      orbit.minPolarAngle = .15
      orbit.update()
      orbit.saveState()
      surface.domElement.style.touchAction = 'pan-y'
      const ray = new Raycaster()
      const pointer = new Vector2()
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
        const { landmarkLabel } = hit.object.userData
        if (typeof landmarkLabel === 'string') {
          setPicked({ label: landmarkLabel, source: '天街和京西智谷模型' })
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
        })
      }
      const fit = () => {
        const { clientWidth: width, clientHeight: height } = host
        if (!width || !height) return
        const aspect = width / height
        const halfHeight = Math.max(size.z * .42 + size.y * .8, size.x * .56 / aspect)
        camera.left = -halfHeight * aspect
        camera.right = halfHeight * aspect
        camera.top = halfHeight
        camera.bottom = -halfHeight
        camera.updateProjectionMatrix()
        surface.setSize(width, height, false)
        draw()
      }
      const loadedLandmarks = new Map<Landmark, Object3D>()
      tools.current = {
        zoom: amount => {
          camera.zoom = Math.max(.75, Math.min(200, camera.zoom * amount))
          camera.updateProjectionMatrix()
          draw()
        },
        reset: () => {
          orbit.reset()
          setPicked(undefined)
          draw()
        },
        landmark: async id => {
          const config = landmarkFiles[id]
          let object = loadedLandmarks.get(id)
          if (!object) {
            object = await readModel(config.file, 8_000_000, controller.signal)
            if (controller.signal.aborted) {
              releaseModel(object)
              return
            }
            object.traverse(child => {
              if (!(child instanceof Mesh)) return
              child.geometry.computeVertexNormals()
              child.material.dispose()
              child.material = new MeshStandardMaterial({ color: '#bfd8e5', roughness: .73 })
              child.userData.landmarkLabel = config.label
            })
            localModel.add(object)
            loadedLandmarks.set(id, object)
          }
          const detail = new Box3().setFromObject(object)
          const dimensions = detail.getSize(new Vector3())
          const offset = camera.position.clone().sub(orbit.target)
          orbit.target.copy(detail.getCenter(new Vector3()))
          camera.position.copy(orbit.target).add(offset)
          camera.zoom = Math.min(160, size.x * .58 / Math.max(.25, dimensions.x, dimensions.z))
          camera.updateProjectionMatrix()
          orbit.update()
          draw()
          setPicked({ label: config.label, source: '天街和京西智谷模型' })
        },
      }
      orbit.addEventListener('change', draw)
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
      cancelAnimationFrame(frame)
      observer?.disconnect()
      controls?.dispose()
      unbindPicking?.()
      if (model) releaseModel(model)
      renderer?.dispose()
      renderer?.forceContextLoss()
      renderer?.domElement.remove()
      tools.current = undefined
    }
  }, [])

  async function showLandmark(id: Landmark) {
    const current = tools.current
    if (!current || landmarkPending) return
    setLandmarkPending(id)
    setLandmarkError(false)
    try {
      await current.landmark(id)
    } catch {
      setLandmarkError(true)
    } finally {
      setLandmarkPending(undefined)
    }
  }

  return (
    <section className="district-local-model" data-model-ready={phase} aria-label="门头沟区本地三维模型">
      <div className="district-local-model-canvas" ref={mount} />
      {phase === 'loading' && <p className="district-model-state" role="status">正在加载本地三维模型</p>}
      {phase === 'unavailable' && <p className="district-model-state" role="status">本地三维模型暂不可用</p>}
      {phase === 'ready' && (
        <>
          <div className="district-local-landmarks" aria-label="重点地标">
            {(Object.keys(landmarkFiles) as Landmark[]).map(id => (
              <button key={id} type="button" disabled={Boolean(landmarkPending)} onClick={() => void showLandmark(id)}>
                {landmarkPending === id ? `加载${landmarkFiles[id].label}` : landmarkFiles[id].label}
              </button>
            ))}
            {landmarkError && <span role="status">地标模型暂不可用</span>}
          </div>
          {picked && (
            <aside className="district-local-model-detail" aria-label="模型要素详情">
              <strong>{picked.label}</strong>
              <span>{picked.source}</span>
              {typeof picked.height === 'number' && <span>模型高程 {picked.height} 米</span>}
              <button type="button" onClick={() => setPicked(undefined)}>关闭详情</button>
            </aside>
          )}
          <ul className="district-local-model-key" aria-label="模型图例">
            {(Object.keys(surfaceLabels) as Surface[]).map(key => (
              <li key={key} data-surface={key}><button type="button" onClick={() => setPicked(surfaceDetail(key))}>{surfaceLabels[key]}</button></li>
            ))}
          </ul>
          <div className="navigation-map-tools" role="group" aria-label="本地模型操作">
            <div className="navigation-map-zoom">
              <button type="button" aria-label="缩小模型" onClick={() => tools.current?.zoom(.8)}>−</button>
              <button type="button" aria-label="放大模型" onClick={() => tools.current?.zoom(1.25)}>+</button>
              <button type="button" onClick={() => tools.current?.reset()}>模型全域</button>
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
