import { useEffect, useRef } from 'react'
import { Link, NavLink, useLocation, useParams } from 'react-router'
import LocalDistrictModel from './LocalDistrictModel'
import { isTwinId, twinPath, twinSites } from './twinSites'
import './cockpit.css'
import './twin-scene.css'

const landmarks = [
  { id: 'tianjie', label: '长安天街' },
  { id: 'jingxi', label: '京西智谷' },
] as const

export default function TwinScene() {
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
  return (
    <div className="cockpit twin-page" data-landmark={twinId}>
      <header className="twin-header">
        <Link to={backPath} className="twin-back">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M16 10H4m5-5-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          返回驾驶舱
        </Link>
        <nav className="twin-switcher" aria-label="地标切换">
          {landmarks.map(({ id, label }) => (
            <NavLink key={id} to={twinPath(id)} state={location.state} className="twin-switch">{label}</NavLink>
          ))}
        </nav>
      </header>
      <main className="twin-body">
        <div className="twin-title">
          <div>
            <h1 ref={heading} tabIndex={-1}>{site.name}</h1>
            <p><span>{site.kind}</span><span>{site.location}</span></p>
          </div>
          <a className="twin-source" href={site.source} target="_blank" rel="noopener noreferrer">
            区政府公开资料
            <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <path d="M8 4h6v6m0-6-7 7m7 1v2H4V4h2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
        <figure className="twin-workspace">
          <section className="twin-model-stage" aria-label={site.name + '模型视图'}>
            <LocalDistrictModel key={twinId} standaloneTwin={twinId} />
          </section>
          <figcaption className="twin-caption">
            <ul aria-label="场景图例">
              <li data-feature="landmark">主体建筑</li>
              <li data-feature="road">周边道路</li>
              <li data-feature="green">绿地</li>
            </ul>
            <p>周边街区为示意</p>
          </figcaption>
        </figure>
      </main>
    </div>
  )
}
