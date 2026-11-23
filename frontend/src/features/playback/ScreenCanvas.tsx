import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentData, Manifest } from '../../api/client'

const DataChart = lazy(() => import('./DataChart'))
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })

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
            const data = byComponent.get(component.id)
            const plot = data?.points ?? []
            return (
              <article key={component.id} className="screen-component" data-kind={component.type}
                style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height, zIndex: geometry.z }}>
                <header className="component-heading">
                  <h2>{component.title}</h2>
                  {component.type !== 'kpi' && <span>单位 {data?.unit ?? component.unit}</span>}
                </header>
                {component.type === 'kpi' ? (
                  <p className="metric tabular-nums">
                    {typeof data?.value === 'number' ? <>{numberFormat.format(data.value)}<small>{data.unit}</small></> : '暂无数据'}
                  </p>
                ) : plot.length ? (
                  <Suspense fallback={<p className="chart-fallback" aria-busy="true">正在加载图表</p>}>
                    <DataChart kind={component.type} label={component.title} points={plot} unit={data?.unit ?? component.unit} />
                  </Suspense>
                ) : <p className="chart-fallback">暂无数据</p>}
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
