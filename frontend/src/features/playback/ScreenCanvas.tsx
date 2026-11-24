import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentData, Manifest } from '../../api/client'
import { chartStyleFor, chartStyleLabel } from './chartStyles'
import './playback.css'

const DataChart = lazy(() => import('./DataChart'))
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })

export function ScreenComponentContent({ component, data }: {
  component: Manifest['components'][number]
  data?: ComponentData['results'][number]
}) {
  const unit = data?.unit ?? component.unit
  const plot = data?.points
  const chartStyle = chartStyleFor(component)
  return (
    <div className="screen-component-body" data-chart-style={chartStyle ?? 'kpi'}>
      <header className="screen-component-heading">
        <h2>{component.title}</h2>
        <div className="screen-chart-meta">
          <span className="screen-chart-type">{chartStyleLabel(component)}</span>
          {component.type !== 'kpi' && unit && <span>{unit}</span>}
        </div>
      </header>
      {component.type === 'kpi' ? (
        <p className="screen-metric" data-empty={typeof data?.value !== 'number'}>
          {typeof data?.value === 'number' ? <><strong>{numberFormat.format(data.value)}</strong><small>{unit}</small></> : '暂无数据'}
        </p>
      ) : plot?.length ? (
        <Suspense fallback={<p className="chart-fallback" aria-busy="true">正在加载图表</p>}>
          <DataChart kind={component.type} variant={chartStyle} label={component.title} points={plot} unit={unit}
            additive={component.type === 'ranking' && unit === '件'} />
        </Suspense>
      ) : <p className="chart-fallback">暂无数据</p>}
    </div>
  )
}

export function ScreenCanvas({ manifest, snapshot }: { manifest: Manifest; snapshot: ComponentData }) {
  const area = useRef<HTMLDivElement>(null)
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 })
  const { width, height } = manifest.canvas
  const scale = areaSize.width > 0 && areaSize.height > 0
    ? Math.min(areaSize.width / width, areaSize.height / height)
    : 1
  const byComponent = new Map(snapshot.results.map(result => [result.componentId, result]))

  useLayoutEffect(() => {
    const element = area.current
    if (!element) return
    const measure = () => setAreaSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={area} className="screen-area" data-theme={manifest.theme}>
      <div className="screen-size" style={{ width: width * scale, height: height * scale }}>
        <div className="screen-canvas" style={{ width, height, transform: 'scale(' + scale + ')' }}>
          {manifest.components.map(component => {
            const geometry = component.geometry
            return (
              <article key={component.id} className="screen-component" data-kind={component.type}
                style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height, zIndex: geometry.z }}>
                <ScreenComponentContent component={component} data={byComponent.get(component.id)} />
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
