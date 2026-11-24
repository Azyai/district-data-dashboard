import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import LocalDistrictModel from './LocalDistrictModel'
import { isTwinId, twinPath, twinSites } from './twinSites'
import './cockpit.css'
import './twin-scene.css'

export default function TwinScene({ identityControl }: { identityControl: ReactNode }) {
  const { twinId } = useParams()
  const location = useLocation()
  const heading = useRef<HTMLHeadingElement>(null)
  const backArea: unknown = location.state?.backArea
  const backPath = typeof backArea === 'string' && backArea !== 'mentougou'
    && /^[a-z0-9-]{1,100}$/.test(backArea) ? '/areas/' + backArea : '/'

  useEffect(() => {
    window.scrollTo(0, 0)
    heading.current?.focus({ preventScroll: true })
  }, [twinId])

  if (!isTwinId(twinId)) {
    return <main className="center-state"><h1>孪生场景不存在</h1><Link to={backPath} className="action-link">返回驾驶舱</Link></main>
  }

  const site = twinSites[twinId]
  const other = twinId === 'tianjie' ? 'jingxi' : 'tianjie'
  return (
    <div className="cockpit twin-page">
      <header className="twin-header">
        <nav aria-label="场景路径">
          <Link to={backPath} className="twin-back"><span aria-hidden="true">←</span> 返回驾驶舱</Link>
          <span className="twin-header-title">数字孪生</span>
        </nav>
        <div className="cockpit-actions">{identityControl}</div>
      </header>
      <main className="twin-body">
        <div className="twin-title">
          <div>
            <h1 ref={heading} tabIndex={-1}>{site.name}</h1>
            <p>{site.location}</p>
          </div>
          <Link to={twinPath(other)} state={location.state} className="twin-switch">查看{twinSites[other].name}<span aria-hidden="true">↗</span></Link>
        </div>
        <div className="twin-workspace">
          <section className="twin-model-stage" aria-label={site.name + '模型视图'}>
            <LocalDistrictModel key={twinId} standaloneTwin={twinId} />
          </section>
          <aside className="twin-context" aria-label="场景资料">
            <h2>场景资料</h2>
            <p className="twin-description">{site.description}</p>
            <dl>
              <div><dt>对象类型</dt><dd>{site.kind}</dd></div>
              <div><dt>位置</dt><dd>{site.location}</dd></div>
              <div><dt>模型来源</dt><dd>项目本地三维模型</dd></div>
              <div><dt>实时数据</dt><dd>待接入</dd></div>
            </dl>
            <a href={site.source} target="_blank" rel="noreferrer">查看区政府公开资料<span aria-hidden="true">↗</span></a>
          </aside>
        </div>
      </main>
    </div>
  )
}
