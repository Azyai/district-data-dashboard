import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import './terrain.css'

type Place = { id: string; name: string; x: number; z: number }
type TerrainProps = {
  areaId: string
  areaName: string
  level: 'district' | 'town' | 'village'
  areas: readonly Place[]
  onSelectArea: (id: string) => void
}

const rim = [
  [-3.65, 0.32], [-3.66, -0.53], [-3.34, -1.32], [-2.68, -1.7],
  [-2.3, -2.05], [-1.56, -1.88], [-0.98, -2.09], [-0.45, -1.48],
  [0.33, -1.38], [0.94, -1.67], [1.65, -1.53], [2.0, -1.11],
  [2.34, -1.2], [2.63, -0.76], [3.09, -0.55], [3.48, -0.17],
  [3.37, 0.41], [3.61, 0.68], [3.23, 1.12], [2.59, 1.16],
  [2.22, 1.48], [1.44, 1.4], [1.11, 1.79], [0.42, 1.72],
  [-0.29, 2.03], [-0.88, 1.76], [-1.47, 1.9], [-1.94, 1.48],
  [-2.58, 1.42], [-2.81, 0.96], [-3.35, 0.92],
] as const

function inside(x: number, z: number) {
  let covered = false
  for (let i = 0, j = rim.length - 1; i < rim.length; j = i++) {
    const [ax, az] = rim[i]
    const [bx, bz] = rim[j]
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) {
      covered = !covered
    }
  }
  return covered
}

function elevation(x: number, z: number, phase: number) {
  const ridge = Math.exp(-((x + 1.8 + 0.32 * Math.sin(2 * z)) ** 2 / 2.9 + (z + 0.27) ** 2 / 1.75))
  const north = Math.exp(-((x - 0.38) ** 2 / 1.8 + (z + 0.81) ** 2 / 0.7))
  const hills = Math.exp(-((x - 1.88) ** 2 / 1.5 + (z - 0.04) ** 2 / 1.25))
  const gullies = 0.51 + 0.19 * Math.sin(x * 3.9 + z * 2.7 + phase) + 0.11 * Math.cos(z * 7.4 - x * 1.3)
    + 0.077 * Math.sin(x * 12.6 + z * 10.2 + phase) + 0.04 * Math.sin(z * 23.9 - x * 13.4)
  return 0.07 + (ridge * 1.7 + north * 1.25 + hills * 0.6) * gullies
}

const vertexShader = [
  'varying vec3 terrainPoint;',
  'varying vec3 terrainNormal;',
  'void main() {',
  '  terrainPoint = position;',
  '  terrainNormal = normalize(normalMatrix * normal);',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}',
].join('\n')

const fragmentShader = `
  varying vec3 terrainPoint;
  varying vec3 terrainNormal;

  float contour(float value, float width) {
    float distance = abs(fract(value + 0.5) - 0.5);
    return 1.0 - smoothstep(width, width + fwidth(value), distance);
  }

  void main() {
    float height = terrainPoint.y;
    float relief = smoothstep(0.045, 1.46, height);
    vec3 normal = normalize(terrainNormal);
    float key = max(0.0, dot(normal, normalize(vec3(-0.68, 0.67, 0.32))));
    float fill = max(0.0, dot(normal, normalize(vec3(0.78, 0.11, 0.61))));
    vec3 ground = mix(vec3(0.032, 0.087, 0.195), vec3(0.20, 0.37, 0.63), relief);
    vec3 ink = ground * (0.69 + key * 0.87);
    ink += vec3(0.13, 0.31, 0.42) * pow(key, 3.0) * (0.22 + relief * 0.56);
    ink += vec3(0.13, 0.07, 0.32) * fill * (0.3 + relief * 0.36);
    float minor = contour(height * 17.0, 0.038) * 0.30;
    float major = contour(height * 5.6667, 0.046) * 0.70;
    ink += vec3(0.23, 0.51, 0.71) * (minor + major) * (0.38 + key * 0.48);
    gl_FragColor = vec4(ink, 1.0);
  }
`

function meshSurface(phase: number) {
  const columns = 144
  const rows = 90
  const points: number[] = []
  const indices: number[] = []
  const active: boolean[] = []
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= columns; col += 1) {
      const x = -3.75 + col / columns * 7.5
      const z = -2.2 + row / rows * 4.4
      points.push(x, elevation(x, z, phase), z)
      active.push(inside(x, z))
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const a = row * (columns + 1) + col
      const b = a + 1
      const c = a + columns + 1
      const d = c + 1
      if (active[a] && active[b] && active[c]) indices.push(a, c, b)
      if (active[b] && active[c] && active[d]) indices.push(b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

const perimeter = rim.flatMap(([x, z], index) => {
  const [nextX, nextZ] = rim[(index + 1) % rim.length]
  return Array.from({ length: 8 }, (_, step) => [
    x + (nextX - x) * step / 8,
    z + (nextZ - z) * step / 8,
  ] as const)
})

function edge(phase: number, layer: number | undefined, color: number, opacity: number) {
  const points = perimeter.map(([x, z]) => new THREE.Vector3(x, layer ?? elevation(x, z, phase) + 0.015, z))
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  )
}

function strata(phase: number, top: number | undefined, bottom: number, topColor: number, bottomColor: number) {
  const positions: number[] = []
  const colors: number[] = []
  const crown = new THREE.Color(topColor)
  const base = new THREE.Color(bottomColor)
  perimeter.forEach(([x, z], index) => {
    const [nextX, nextZ] = perimeter[(index + 1) % perimeter.length]
    const y = top ?? elevation(x, z, phase)
    const nextY = top ?? elevation(nextX, nextZ, phase)
    positions.push(x, y, z, x, bottom, z, nextX, nextY, nextZ,
      nextX, nextY, nextZ, x, bottom, z, nextX, bottom, nextZ)
    for (const color of [crown, base, crown, crown, base, base]) colors.push(color.r, color.g, color.b)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))
}

function fitCamera(camera: THREE.OrthographicCamera, width: number, height: number, samples: THREE.Vector3[]) {
  const narrow = width < 520
  camera.position.set(1.45, narrow ? 10.4 : 7.65, 11.1)
  camera.lookAt(0, 0.25, 0)
  camera.updateMatrixWorld()

  const bounds = new THREE.Box2()
  const projected = new THREE.Vector3()
  const point = new THREE.Vector2()
  samples.forEach(sample => {
    projected.copy(sample).applyMatrix4(camera.matrixWorldInverse)
    bounds.expandByPoint(point.set(projected.x, projected.y))
  })
  const size = bounds.getSize(new THREE.Vector2())
  const center = bounds.getCenter(new THREE.Vector2())
  const sides = Math.min(width * .12, Math.max(13, width * .045))
  const top = Math.max(12, height * .052)
  const bottom = 50
  const pixelsPerUnit = Math.min((width - 2 * sides) / size.x, (height - top - bottom) / size.y)
  const halfWidth = width / pixelsPerUnit / 2
  const halfHeight = height / pixelsPerUnit / 2
  const middleY = center.y + (top - bottom) / (2 * pixelsPerUnit)
  camera.left = center.x - halfWidth
  camera.right = center.x + halfWidth
  camera.top = middleY + halfHeight
  camera.bottom = middleY - halfHeight
  camera.updateProjectionMatrix()
}

function terrainBounds(phase: number) {
  const points = perimeter.flatMap(([x, z]) => [
    new THREE.Vector3(x, -0.51, z),
    new THREE.Vector3(x, elevation(x, z, phase) + .015, z),
  ])
  for (let z = -2; z < 2.1; z += .18) {
    for (let x = -3.6; x < 3.6; x += .18) {
      if (inside(x, z)) points.push(new THREE.Vector3(x, elevation(x, z, phase), z))
    }
  }
  return points
}

type Point = { x: number; y: number }

function project(camera: THREE.OrthographicCamera, x: number, y: number, z: number, width: number, height: number): Point {
  const point = new THREE.Vector3(x, y, z).project(camera)
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 }
}

function drawPlan(canvas: HTMLCanvasElement, camera: THREE.OrthographicCamera, width: number, height: number, phase: number) {
  const density = Math.min(window.devicePixelRatio, 1.5)
  canvas.width = Math.round(width * density)
  canvas.height = Math.round(height * density)
  const context = canvas.getContext('2d')
  if (!context) return
  context.scale(density, density)
  const point = (x: number, z: number) => project(camera, x, elevation(x, z, phase), z, width, height)
  const base = (layer: number) => perimeter.map(([x, z]) => project(camera, x, layer, z, width, height))
  const path = (positions: Point[]) => {
    context.beginPath()
    positions.forEach(({ x, y }, index) => {
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.closePath()
  }
  const crown = perimeter.map(([x, z]) => point(x, z))
  const foot = base(-.51)
  const bench = base(-.29)
  for (const [index, upper] of crown.entries()) {
    const next = (index + 1) % crown.length
    path([upper, crown[next], bench[next], bench[index]])
    context.fillStyle = '#1d365c'
    context.fill()
    path([bench[index], bench[next], foot[next], foot[index]])
    context.fillStyle = '#101936'
    context.fill()
  }

  const step = 0.084
  for (let z = -2.18; z < 2.11; z += step) {
    for (let x = -3.75; x < 3.68; x += step) {
      if (!inside(x + step / 2, z + step / 2)) continue
      const altitude = elevation(x, z, phase)
      const grade = (elevation(x + step, z, phase) - altitude) / step
      const tone = Math.max(0, Math.min(1, altitude * 0.62 + 0.12 - grade * 0.19))
      const contour = altitude * 17 % 1 < .21 ? 10 : 0
      context.fillStyle = 'rgb(' + (9 + tone * 63 + contour) + ' ' +
        (26 + tone * 110 + contour) + ' ' + (57 + tone * 143 + contour) + ')'
      path([point(x, z), point(x + step, z), point(x + step, z + step), point(x, z + step)])
      context.fill()
      context.strokeStyle = context.fillStyle
      context.lineWidth = .3
      context.stroke()
    }
  }
  path(foot)
  context.strokeStyle = '#586dad'
  context.lineWidth = .6
  context.stroke()
  path(crown)
  context.strokeStyle = '#9ce8fe'
  context.lineWidth = .9
  context.stroke()
}

function addScene(phase: number) {
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(meshSurface(phase), new THREE.ShaderMaterial({ vertexShader, fragmentShader })))
  scene.add(
    strata(phase, undefined, -.29, 0x315989, 0x16284b),
    strata(phase, -.29, -.51, 0x282f62, 0x090d24),
    edge(phase, undefined, 0x9adffa, .9),
    edge(phase, -.292, 0x7498eb, .69),
    edge(phase, -.51, 0x696ab4, .73),
  )
  return scene
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Line) {
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material: THREE.Material) => material.dispose())
    }
  })
}

function markerWorld(place: Place) {
  let x = (Number.isFinite(place.x) ? Math.max(-1, Math.min(1, place.x)) : 0) * 3.22
  let z = (Number.isFinite(place.z) ? Math.max(-1, Math.min(1, place.z)) : 0) * 1.63
  while (!inside(x, z)) {
    x *= 0.9
    z *= 0.9
  }
  return { x, z }
}

type LabelSide = 'east' | 'west' | 'north' | 'south'
type Rect = { left: number; top: number; right: number; bottom: number }
type Marker = { place: Place; left: number; top: number; side: LabelSide; compact: boolean }

function overlaps(a: Rect, b: Rect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function labelBox(side: LabelSide, point: Point, width: number, height: number): Rect {
  const gap = 12
  const left = side === 'east' ? point.x + gap : side === 'west' ? point.x - gap - width : point.x - width / 2
  const top = side === 'south' ? point.y + gap : side === 'north' ? point.y - gap - height : point.y - height / 2
  return { left, top, right: left + width, bottom: top + height }
}

function layoutMarkers(
  places: readonly Place[],
  camera: THREE.OrthographicCamera,
  width: number,
  height: number,
  phase: number,
  measure: CanvasRenderingContext2D | null,
) {
  const points = places.map(place => {
    const { x, z } = markerWorld(place)
    return project(camera, x, elevation(x, z, phase) + .052, z, width, height)
  })
  const pinAreas = points.map(({ x, y }) => ({ left: x - 8, right: x + 8, top: y - 8, bottom: y + 8 }))
  const labels: Rect[] = []
  const fontSize = width >= 1600 ? 19 : width >= 1200 ? 16 : width >= 900 ? 14 : width >= 520 ? 12 : 11
  if (measure) measure.font = '650 ' + fontSize + 'px system-ui, "Microsoft YaHei", sans-serif'

  return places.map((place, index): Marker => {
    const point = points[index]
    const estimatedWidth = Array.from(place.name).length * fontSize
    const labelWidth = Math.ceil(measure?.measureText(place.name).width ?? estimatedWidth) + 16
    const sides: LabelSide[] = point.x < width / 2
      ? ['east', 'west', 'north', 'south']
      : ['west', 'east', 'north', 'south']
    const selected = sides.find(side => {
      const box = labelBox(side, point, labelWidth, fontSize + 9)
      const fits = box.left >= 8 && box.right <= width - 8 && box.top >= 8 && box.bottom <= height - 43
      if (!fits || labels.some(label => overlaps(label, box))) return false
      if (pinAreas.some((pin, other) => index !== other && overlaps(pin, box))) return false
      labels.push(box)
      return true
    })
    return {
      left: point.x / width * 100,
      top: point.y / height * 100,
      place,
      compact: selected === undefined,
      side: selected ?? sides[0],
    }
  })
}

export default function TerrainView({ areaId, areaName, level, areas, onSelectArea }: TerrainProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [mode, setMode] = useState({ planar: false })
  const [isWebGL, setIsWebGL] = useState(false)

  useEffect(() => {
    const mount = host.current
    if (!mount) return
    const seed = [...areaId].reduce((sum, character) => sum + character.charCodeAt(0), 0)
    const phase = seed % 19 / 8
    const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.05, 90)
    const samples = terrainBounds(phase)
    const measure = document.createElement('canvas').getContext('2d')
    const items = areas.length ? areas : [{ id: areaId, name: areaName, x: 0.17, z: 0.24 }]
    let renderer: THREE.WebGLRenderer | null = null
    let scene: THREE.Scene | null = null
    let drawWidth = 0
    let drawHeight = 0
    const backup = document.createElement('canvas')
    backup.setAttribute('aria-hidden', 'true')

    const draw = () => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      if (!width || !height || (width === drawWidth && height === drawHeight)) return
      drawWidth = width
      drawHeight = height
      fitCamera(camera, width, height, samples)
      if (renderer && scene) {
        renderer.setSize(width, height, false)
        renderer.render(scene, camera)
      } else {
        drawPlan(backup, camera, width, height, phase)
      }
      setMarkers(layoutMarkers(items, camera, width, height, phase, measure))
    }

    const release = () => {
      if (renderer) {
        renderer.domElement.removeEventListener('webglcontextlost', fallback)
        renderer.dispose()
        renderer = null
      }
      if (scene) {
        disposeScene(scene)
        scene = null
      }
    }

    function fallback(event?: Event) {
      event?.preventDefault()
      release()
      drawWidth = 0
      mount?.replaceChildren(backup)
      setIsWebGL(false)
      draw()
    }

    if (!mode.planar) {
      try {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('webgl2', { antialias: true, alpha: true })
        if (context) {
          renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: true })
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65))
          canvas.setAttribute('aria-hidden', 'true')
          canvas.addEventListener('webglcontextlost', fallback)
          mount.replaceChildren(canvas)
          scene = addScene(phase)
        }
      } catch {
        fallback()
      }
    }

    if (!renderer) mount.replaceChildren(backup)
    setIsWebGL(Boolean(renderer))
    draw()
    const resize = new ResizeObserver(draw)
    resize.observe(mount)
    return () => {
      resize.disconnect()
      release()
      mount.replaceChildren()
    }
  }, [areaId, areaName, areas, mode])

  return (
    <div className="district-terrain" data-renderer={isWebGL ? 'webgl' : 'canvas'}>
      <div className="terrain-surface" ref={host} aria-hidden="true" />
      <div className="terrain-locators">
        {markers.map(({ place, left, top, side, compact }) => {
          const point = <><i className="terrain-pin" aria-hidden="true" /><span className="terrain-label">{place.name}</span></>
          const style = { left: left + '%', top: top + '%' }
          return areas.length ? (
            <button key={place.id} type="button" data-side={side} data-compact={compact} aria-label={'下钻至' + place.name}
              className="terrain-location" style={style} onClick={() => onSelectArea(place.id)}>
              {point}
            </button>
          ) : <div key={place.id} className="terrain-location is-current" data-side={side} style={style}>{point}</div>
        })}
      </div>
      <div className="terrain-legend">
        <span><i aria-hidden="true" />{areas.length ? level === 'district' ? '镇街点位' : '村社点位' : '当前区域'}</span>
        <small>地形与区划示意</small>
      </div>
      <button type="button" className="terrain-mode" aria-label={isWebGL ? '切换至二维地形' : '尝试三维地形'}
        onClick={() => setMode({ planar: isWebGL })}>
        {isWebGL ? '三维地形' : '二维地形'}
      </button>
    </div>
  )
}
