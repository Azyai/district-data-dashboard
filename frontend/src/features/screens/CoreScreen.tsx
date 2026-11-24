import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router'
import type { CockpitArea } from '../../api/client'
import { economyFor, populationFor, townIdOf, towns } from './screenData'
import { screens, type ScreenId } from './screenCatalog'
import referenceCss from './reference/reference.css?inline'
import './core-screens.css'

export type CoreScreenProps = {
  screen: Exclude<ScreenId, 'overview'>
  area: CockpitArea
  onAreaChange: (id: string) => void
}

type ReferenceView = {
  markup: () => string
  effect?: () => () => void
  onButton?: (target: HTMLButtonElement, render: (focus?: string) => void) => void
  onField?: (key: string) => void
  onProject?: (index: number) => void
  insights?: Record<string, () => void>
}

type SceneFactory = (context: ReturnType<typeof sceneContext>) => ReferenceView
type SceneProps = Pick<CoreScreenProps, 'area' | 'onAreaChange'> & { doc: Document }
const loadViews = import.meta.glob<{ default: SceneFactory }>('./reference/*.view.js')

function FrameMessage({ failed = false }: { failed?: boolean }) {
  return <p className="reference-feedback" role={failed ? 'alert' : 'status'}>{failed ? <>
    专题画面暂时无法加载。 <button type="button" onClick={() => window.location.reload()}>重新加载</button>
  </> : '正在加载专题画面…'}</p>
}

function unavailable() { return { default: () => <FrameMessage failed /> } }

function loadScene(id: 'population' | 'economy') {
  return lazy(() => loadViews['./reference/' + id + '.view.js']()
    .then(({ default: createView }) => ({ default: (props: SceneProps) => <Scene {...props} createView={createView} /> }))
    .catch(unavailable))
}

const pages = {
  population: loadScene('population'),
  economy: loadScene('economy'),
  governance: lazy(() => import('./GovernanceScreen').catch(unavailable)),
}
const frameDocument = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>专题数据</title><style>' + referenceCss + '</style></head><body><div class="screen"><main id="screen-content"></main></div><dialog id="details" aria-labelledby="detail-title"><header class="dialog-head"><span class="demo-mark">演示数据</span><form method="dialog"><button class="icon-button" aria-label="关闭详情">×</button></form></header><div id="detail-content"></div></dialog></body></html>'

// Only route metadata enters HTML templates. Database strings are rendered by React in GovernanceScreen.
function textForHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function sceneContext(doc: Document, area: CockpitArea, onAreaChange: CoreScreenProps['onAreaChange'], section: string | null) {
  const economy = economyFor(area)
  const population = populationFor(area)
  const scopeLabel = textForHtml(area.name)
  const select = (selector: string) => doc.querySelector(selector)
  const dialog = doc.querySelector<HTMLDialogElement>('#details')!
  function showDetail(title: string, subtitle: string, body: string, wide?: boolean) {
    dialog.classList.toggle('insight-dialog', Boolean(wide))
    doc.getElementById('detail-content')!.innerHTML = '<h2 id="detail-title" tabindex="-1"></h2><p class="detail-sub"></p>' + body
    doc.getElementById('detail-title')!.textContent = title
    doc.querySelector('.detail-sub')!.textContent = subtitle
    dialog.scrollTop = 0
    if (!dialog.open) dialog.showModal()
    doc.getElementById('detail-title')!.focus({ preventScroll: true })
  }
  return {
    $: select, document: doc, window: doc.defaultView!, onAreaChange, showDetail, towns, section,
    area: { id: area.id, level: area.level }, scopeLabel, parentId: townIdOf(area),
    population: population && { ...population, name: textForHtml(population.name) },
    economy: { ...economy, enterpriseCases: economy.serviceCount, enterpriseDone: economy.serviceDone,
      serviceTypes: economy.services.map(s => [s.label, s.count, s.done]),
      industries: economy.industries.map(i => [i.label, i.value]),
      projects: economy.projects.map(p => ({ ...p, area: towns.find(t => t.id === p.townId)?.name })),
    },
  }
}

function Scene({ doc, createView, area, onAreaChange }: SceneProps & { createView: SceneFactory }) {
  const mount = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const { search, hash } = useLocation()
  const section = new URLSearchParams(search).get('section') ?? hash.substring(1)
  const changeArea = useRef(onAreaChange)
  useLayoutEffect(() => { changeArea.current = onAreaChange }, [onAreaChange])
  useLayoutEffect(() => {
    const content = mount.current!
    const dialog = doc.querySelector<HTMLDialogElement>('#details')!
    const context = sceneContext(doc, area, id => changeArea.current(id), section)
    let stopEffect: (() => void) | undefined
    let view: ReferenceView
    function render(focus?: string) {
      stopEffect?.()
      content.innerHTML = view.markup()
      stopEffect = view.effect?.()
      if (focus) doc.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true })
    }
    function onClick(event: MouseEvent) {
      const target = (event.target as Element).closest<HTMLButtonElement>('button')
      if (!target) return
      if (target.dataset.analysis) view.insights?.[target.dataset.analysis]?.()
      else if (target.dataset.project !== undefined) view.onProject?.(Number(target.dataset.project))
      else if (content.contains(target)) view.onButton?.(target, render)
    }
    function onChange(event: Event) {
      const field = (event.target as HTMLElement).dataset.insightField
      if (field) view.onField?.(field)
    }
    try {
      view = createView(context)
      render()
    } catch {
      setFailed(true)
      return
    }
    doc.addEventListener('click', onClick)
    doc.addEventListener('change', onChange)
    return () => {
      stopEffect?.()
      dialog.close()
      doc.removeEventListener('click', onClick)
      doc.removeEventListener('change', onChange)
      content.replaceChildren()
    }
  }, [area, createView, doc, section])
  return failed ? <FrameMessage failed /> : <div className="reference-artwork" ref={mount} />
}

function ReferenceFrame({ screen, area, onAreaChange }: CoreScreenProps) {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [doc, setDoc] = useState<Document>()
  const [size, setSize] = useState({ width: 1280, height: 720, scale: 1 })
  useLayoutEffect(() => {
    const node = host.current!
    const measure = () => {
      const width = node.clientWidth
      const height = node.clientHeight
      if (!width || !height) return
      const portrait = width < 730 && height > width
      const scale = Math.min(1, width / (portrait ? 650 : 1080), height / (portrait ? 820 : 690))
      setSize({ width: width / scale, height: height / scale, scale })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (doc) doc.body.dataset.page = screen
  }, [doc, screen])
  const Page = pages[screen]
  const title = screens.find(s => s.id === screen)?.title ?? ''
  return <div className="reference-frame-host" ref={host} data-screen={screen}>
    <iframe srcDoc={frameDocument} title={title} ref={frame}
      onLoad={() => { if (frame.current?.contentDocument) setDoc(frame.current.contentDocument) }}
      style={{ width: size.width, height: size.height, transform: 'scale(' + size.scale + ')' }} />
    {doc && createPortal(<Suspense fallback={<FrameMessage />}>
      <Page doc={doc} area={area} onAreaChange={onAreaChange} />
    </Suspense>, doc.getElementById('screen-content')!)}
  </div>
}

export default function CoreScreen(props: CoreScreenProps) {
  return <ReferenceFrame key={props.screen} {...props} />
}
