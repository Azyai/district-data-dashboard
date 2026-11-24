import { useLayoutEffect, useRef, useState } from 'react'
import { ticketStatusNames, type HotlineTicket } from './hotlineApi'

const svgNamespace = 'http://www.w3.org/2000/svg'
const strands = 9

export function FlowThreads() {
  const drawing = useRef<SVGSVGElement>(null)
  useLayoutEffect(() => {
    const svg = drawing.current!
    const doc = svg.ownerDocument
    const win = doc.defaultView!
    const tree = svg.parentElement!.querySelector<HTMLElement>('.hotline-tree')!
    const groups = new Map<HTMLElement, SVGGElement>()
    let frame = 0

    function draw() {
      frame = 0
      const bounds = svg.getBoundingClientRect()
      const clips = new Map(Array.from(tree.querySelectorAll('[data-link-clip]'), clip => [clip, clip.getBoundingClientRect()]))
      const visible = new Set<HTMLElement>()
      function center(element: HTMLElement) {
        const rect = element.getBoundingClientRect()
        const y = rect.top + rect.height / 2
        const window = element.closest('[data-link-clip]')
        const clip = window && clips.get(window)
        return clip && (y < clip.top || y > clip.bottom) ? null : { rect, y: y - bounds.top }
      }
      for (const end of tree.querySelectorAll<HTMLElement>('[data-link-from]')) {
        const source = doc.getElementById(end.dataset.linkFrom!)
        if (!source) continue
        const start = center(source)
        const target = center(end)
        if (!start || !target) continue
        const x1 = start.rect.right - bounds.left
        const x2 = target.rect.left - bounds.left
        const bend = (x2 - x1) * .44
        let group = groups.get(end)
        if (!group) {
          group = doc.createElementNS(svgNamespace, 'g')
          group.style.setProperty('--delay', (-visible.size * .49 % 4) + 's')
          group.classList.add('governance-branch')
          for (let i = 0; i <= strands; i++) {
            const path = doc.createElementNS(svgNamespace, 'path')
            if (i === strands) {
              path.setAttribute('class', 'travel')
              path.setAttribute('pathLength', '100')
            } else path.setAttribute('opacity', String(.14 + i % 5 * .055))
            group.append(path)
          }
          svg.append(group)
          groups.set(end, group)
        }
        visible.add(end)
        group.classList.toggle('is-active', end.getAttribute('aria-pressed') === 'true')
        for (let i = 0; i <= strands; i++) {
          const offset = i === strands ? 0 : i - (strands - 1) / 2
          group.children[i].setAttribute('d', `M${x1} ${start.y + offset * .34} C${x1 + bend} ${start.y + offset * 3.1} ${x2 - bend} ${target.y + offset * 3.1} ${x2} ${target.y + offset * .45}`)
        }
      }
      for (const [end, group] of groups) {
        if (!visible.has(end)) { group.remove(); groups.delete(end) }
      }
    }
    function queue() { if (!frame) frame = win.requestAnimationFrame(draw) }
    const resize = new win.ResizeObserver(queue)
    const mutation = new win.MutationObserver(queue)
    resize.observe(tree)
    mutation.observe(tree, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'data-link-from'] })
    tree.addEventListener('scroll', queue, true)
    draw()
    return () => {
      tree.removeEventListener('scroll', queue, true)
      resize.disconnect()
      mutation.disconnect()
      win.cancelAnimationFrame(frame)
      for (const group of groups.values()) group.remove()
    }
  }, [])
  return <svg ref={drawing} className="drawing hotline-drawing" aria-hidden="true"><defs>
    <linearGradient id="hotline-thread"><stop stopColor="#3e999e"/><stop offset=".55" stopColor="#80d0ca"/><stop offset="1" stopColor="#a2ebe0"/></linearGradient>
    <linearGradient id="hotline-thread-active"><stop stopColor="#9c8359"/><stop offset=".55" stopColor="#dbb77e"/><stop offset="1" stopColor="#ffe3a8"/></linearGradient>
  </defs></svg>
}

type TicketFeedProps = {
  scopeKey: string
  linkFrom: string
  items: HotlineTicket[]
  total: number
  selected?: HotlineTicket
  choose: (id: string) => void
  loadMore: () => void
  hasMore: boolean
  pending: boolean
  error: Error | null
  retry: () => void
}

export function TicketFeed({ scopeKey, linkFrom, items, total, selected, choose, loadMore, hasMore, pending, error, retry }: TicketFeedProps) {
  const window = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ first: 0, count: 20, rowHeight: 52 })
  const count = items.length
  useLayoutEffect(() => {
    const node = window.current!
    node.scrollTop = 0
  }, [scopeKey])
  useLayoutEffect(() => {
    const node = window.current!
    const win = node.ownerDocument.defaultView!
    let frame = 0
    function measure() {
      frame = 0
      const height = node.querySelector<HTMLElement>('li')?.getBoundingClientRect().height
      if (!height) return
      const first = Math.max(0, Math.floor(node.scrollTop / height) - 5)
      const visible = Math.ceil(node.clientHeight / height) + 11
      setViewport(old => first === old.first && visible === old.count && height === old.rowHeight
        ? old : { first, count: visible, rowHeight: height })
    }
    function queue() { if (!frame) frame = win.requestAnimationFrame(measure) }
    const resize = new win.ResizeObserver(queue)
    resize.observe(node)
    node.addEventListener('scroll', queue, { passive: true })
    measure()
    return () => { resize.disconnect(); node.removeEventListener('scroll', queue); win.cancelAnimationFrame(frame) }
  }, [count, scopeKey])

  useLayoutEffect(() => {
    const node = window.current!
    if (!hasMore || pending || error) return
    const observer = new node.ownerDocument.defaultView!.IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore()
    }, { root: node, rootMargin: '0px 0px 48px' })
    observer.observe(end.current!)
    return () => observer.disconnect()
  }, [scopeKey, count, hasMore, pending, error, loadMore])

  const first = Math.min(viewport.first, Math.max(0, count - viewport.count))
  const last = Math.min(count, first + viewport.count)
  return <div ref={window} className="governance-branch-window" role="region" aria-label="工单列表" tabIndex={0} data-link-clip>
    <ul className="governance-branch-list" style={{ paddingTop: first * viewport.rowHeight, paddingBottom: (count - last) * viewport.rowHeight }}>
      {items.slice(first, last).map((item, index) => <li key={item.id} aria-posinset={first + index + 1} aria-setsize={total}>
        <button className="governance-record" data-link-from={linkFrom} aria-pressed={item.id === selected?.id}
          onClick={() => choose(item.id)}><i/><span><b title={item.title}>{item.title}</b><small>{item.category} · {ticketStatusNames[item.status]}</small></span>
          <i className="record-chevron" aria-hidden="true"/></button>
      </li>)}
    </ul>
    <div ref={end} className="hotline-feed-end" role="status">
      {error ? <button onClick={retry}>读取失败，重试</button> : pending ? '正在读取工单…' : !count ? '暂无匹配工单' : null}
    </div>
  </div>
}
