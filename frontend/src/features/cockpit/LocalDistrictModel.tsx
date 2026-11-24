import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight, Box3, BufferAttribute, Color, DirectionalLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer,
} from 'three'
import type { Object3D } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import './local-model.css'

const assetUrl = import.meta.env.BASE_URL + 'maps/local-model/mentougou.glb'
const maximumAssetBytes = 4_500_000

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

type ModelTools = { zoom: (amount: number) => void; reset: () => void }
type ModelPhase = 'loading' | 'ready' | 'unavailable'

export default function LocalDistrictModel() {
  const mount = useRef<HTMLDivElement>(null)
  const tools = useRef<ModelTools | undefined>(undefined)
  const [phase, setPhase] = useState<ModelPhase>('loading')

  useEffect(() => {
    const element = mount.current
    if (!element) return
    const controller = new AbortController()
    let model: Object3D | undefined
    let renderer: WebGLRenderer | undefined
    let controls: OrbitControls | undefined
    let observer: ResizeObserver | undefined
    let frame = 0

    async function initialize(host: HTMLDivElement) {
      const response = await fetch(assetUrl, { signal: controller.signal })
      if (!response.ok || Number(response.headers.get('Content-Length')) > maximumAssetBytes) {
        throw new Error('Local district model unavailable')
      }
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength < 20 || bytes.byteLength > maximumAssetBytes || new DataView(bytes).getUint32(0) !== 0x676c5446) {
        throw new Error('Invalid local district model payload')
      }
      const { scene: localModel } = await new GLTFLoader().parseAsync(bytes, '')
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
      tools.current = {
        zoom: amount => {
          camera.zoom = Math.max(.75, Math.min(5, camera.zoom * amount))
          camera.updateProjectionMatrix()
          draw()
        },
        reset: () => {
          orbit.reset()
          draw()
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
      if (model) releaseModel(model)
      renderer?.dispose()
      renderer?.forceContextLoss()
      renderer?.domElement.remove()
      tools.current = undefined
    }
  }, [])

  return (
    <section className="district-local-model" data-model-ready={phase} aria-label="门头沟区本地三维模型">
      <div className="district-local-model-canvas" ref={mount} />
      {phase === 'loading' && <p className="district-model-state" role="status">正在加载本地三维模型</p>}
      {phase === 'unavailable' && <p className="district-model-state" role="status">本地三维模型暂不可用</p>}
      {phase === 'ready' && (
        <>
          <ul className="district-local-model-key" aria-label="模型图例">
            <li data-surface="terrain">地形</li>
            <li data-surface="roads">路网</li>
            <li data-surface="water">水系</li>
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
