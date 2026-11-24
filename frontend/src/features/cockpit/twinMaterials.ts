import { Color, Mesh, MeshStandardMaterial, type Object3D } from 'three'
import type { TwinId } from './twinSites'

const finishes = {
  tianjie: {
    glass: '#548da9',
    stone: '#d5b590',
    metal: '#8f9da5',
    dark: '#455767',
    neutral: '#b4a291',
  },
  jingxi: {
    glass: '#418ea2',
    stone: '#a1babc',
    metal: '#87aab7',
    dark: '#526f80',
    neutral: '#98aeb8',
  },
} as const

export function applyTwinMaterials(model: Object3D, site: TwinId) {
  const palette = finishes[site]
  const styled = new Set<MeshStandardMaterial>()
  const tint = new Color()
  model.traverse(child => {
    if (!(child instanceof Mesh)) return
    if (!child.geometry.hasAttribute('normal')) child.geometry.computeVertexNormals()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial) || styled.has(material)) continue
      styled.add(material)
      const name = material.name.toLowerCase()
      if (/glass|glaz/.test(name)) {
        material.color.lerp(tint.set(palette.glass), .76)
        material.roughness = .29
        material.metalness = .16
        material.emissive.copy(tint)
        material.emissiveIntensity = .09
      } else if (/granite|asphalt|roof|dark.gr[ae]y/.test(name)) {
        material.color.lerp(tint.set(palette.dark), material.map ? .72 : .43)
        material.roughness = .84
      } else if (/stone|concrete|quartz|stucco|tile|cinder|masonry/.test(name)) {
        material.color.lerp(tint.set(palette.stone), .62)
        material.roughness = .82
      } else if (/metal|steel|alumin[ui]m|silver/.test(name)) {
        material.color.lerp(tint.set(palette.metal), .62)
        material.roughness = .49
        material.metalness = .12
      } else {
        // Tint the generic neutral finishes while preserving coloured signage and other accents.
        const { r, g, b } = material.color
        const neutral = Math.max(r, g, b) - Math.min(r, g, b) < .09
        if (neutral && Math.max(r, g, b) > .36) {
          material.color.lerp(tint.set(palette.neutral), material.map ? .31 : .57)
        }
      }
    }
  })
}
