import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Modal, Spin } from 'antd'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, KeyboardEvent, PointerEvent } from 'react'
import { useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import { AdminError, AdminIcon, Field } from '../admin/AdminParts'
import { ScreenCanvas, ScreenComponentContent } from '../playback/ScreenCanvas'
import { TopicNetwork, topicFocusId, topicModeFor } from '../playback/TopicNetwork'
import { chartStyleFor, chartStyleLabel, chartStyleOptions } from '../playback/chartStyles'
import DashboardReleases from './DashboardReleases'
import { dashboardProjects } from './dashboardProjects'
import { designerApi } from './designerApi'
import type { DraftWorkspace } from './designerApi'
import {
  alignComponents, alignmentGuide, cloneMaterial, componentBounds, maxComponents, moveGeometry, previewDraft, resizeGeometry, setLayer,
} from './draftLayout'
import type { Alignment, Geometry, ScreenComponent } from './draftLayout'
import './designer.css'

const glyphs = {
  kpi: 'M4.5 5.5h11v9h-11zm3 3v3m2.5-3v3m2.5-3v3',
  line: 'M3 4v12h14M5.5 12l3.4-4.1 3.1 2.4L16.8 6',
  bar: 'M3 4v12h14M6.5 12.5V9m3.5 3.5V6m3.5 6.5V7.5',
  radar: 'm10 2 7.6 5.5-2.8 9H5.2L2.4 7.5 10 2zm0 0v8m7.6-2.5L10 10m4.8 6.5L10 10m-4.8 6.5L10 10M2.4 7.5 10 10',
  network: 'm10 8-5-3m5 3 5-3m-5 3v7m0 0-5 1m5-1 5 1M3 5a2 2 0 1 0 4 0 2 2 0 1 0-4 0zm10 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0z',
  ring: 'M16.7 7.5a7.1 7.1 0 1 1-4.2-4.2m0 0v4.2h4.2',
  layers: 'm10 3 7 4-7 4-7-4 7-4zm-7 7 7 4 7-4m-14 4 7 4 7-4',
  undo: 'M6.5 4 3 7.5l3.5 3.5M3 7.5h8.5a5 5 0 0 1 0 10H9',
  redo: 'M13.5 4 17 7.5 13.5 11M17 7.5H8.5a5 5 0 0 0 0 10H11',
  preview: 'M3.5 4.5h13v11h-13zM8.5 8l3.5 2-3.5 2z',
  save: 'M4 3.5h10.5L16 5v11.5H4zm3 0v4h6v-4m-6 13v-5h6v5',
  multi: 'M3 3h8v8H3zm8 4h6v10H7v-6',
  chevron: 'm6 8 4 4 4-4',
  left: 'M4 3v14m3-11h8v3H7zm0 6h5v3H7z',
  center: 'M10 3v14m-5-11h10v3H5zm2 6h6v3H7z',
  right: 'M16 3v14M5 6h8v3H5zm3 6h5v3H8z',
  top: 'M3 4h14M6 7h3v8H6zm6 0h3v5h-3z',
  middle: 'M3 10h14M6 5h3v10H6zm6 2h3v6h-3z',
  bottom: 'M3 16h14M6 5h3v8H6zm6 3h3v5h-3z',
} as const

const alignmentTools: { id: Alignment; label: string }[] = [
  { id: 'left', label: '左对齐' }, { id: 'center', label: '水平居中' }, { id: 'right', label: '右对齐' },
  { id: 'top', label: '顶部对齐' }, { id: 'middle', label: '垂直居中' }, { id: 'bottom', label: '底部对齐' },
]

function DesignerGlyph({ name }: { name: keyof typeof glyphs }) {
  return <svg className="designer-glyph" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.45"
    strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true"><path d={glyphs[name]} /></svg>
}

function ComponentGlyph({ component }: { component: ScreenComponent }) {
  return <DesignerGlyph name={chartStyleFor(component) ?? 'kpi'} />
}

const maxHistory = 50
const materialTransfer = 'application/x-district-material'
const projectKey = (projectId: string) => ['designer', 'draft', projectId] as const

type History = { past: ScreenComponent[][]; present: ScreenComponent[]; future: ScreenComponent[][] }
type Confirmation = { kind: 'switch'; projectId: string } | { kind: 'reload' }
type PointerEdit = {
  id: number
  componentId: string
  geometry: Geometry
  x: number
  y: number
  action: 'move' | 'resize'
  scale: number
}

function initialHistory(components: ScreenComponent[]): History {
  return { past: [], present: components, future: [] }
}

function ProjectChoice({ projectId, disabled, onChange }: {
  projectId: string
  disabled?: boolean
  onChange: (projectId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = dashboardProjects.find(project => project.id === projectId) ?? dashboardProjects[0]
  return (
    <div className="designer-project">
      <span>专题模板</span>
      <Button className="designer-template-trigger" aria-label={'选择专题模板（当前：' + current.name + '）'}
        aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
        <span className="designer-theme-swatch" data-theme={current.theme} aria-hidden="true" />
        {current.name}<DesignerGlyph name="chevron" />
      </Button>
      <Modal title="选择专题模板" open={open} onCancel={() => setOpen(false)} footer={null}
        width="min(54rem, calc(100vw - 1.5rem))" centered destroyOnHidden
        className="designer-dialog designer-template-dialog">
        <ul className="designer-template-grid">
          {dashboardProjects.map(project => (
            <li key={project.id}>
              <button type="button" className="designer-template-card" data-theme={project.theme}
                aria-pressed={projectId === project.id} onClick={() => {
                  setOpen(false)
                  onChange(project.id)
                }}>
                <span className="designer-template-art" aria-hidden="true">
                  <span className="designer-template-left"><i /><i /><i /></span>
                  <span className="designer-template-core"><i /><i /><i /><i /><i /></span>
                  <span className="designer-template-right"><i /><i /><i /></span>
                </span>
                <span className="designer-template-name"><strong>{project.name}</strong>
                  {projectId === project.id && <span>正在编辑</span>}</span>
                <span className="designer-template-description">{project.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  )
}

export default function DraftEditor() {
  const [search, setSearch] = useSearchParams()
  const project = dashboardProjects.find(item => item.id === search.get('project')) ?? dashboardProjects[0]
  const projectId = project.id
  const setProject = (id: string) => setSearch({ project: id }, { replace: true })
  const query = useQuery({
    queryKey: projectKey(projectId),
    queryFn: ({ signal }) => designerApi.draft(projectId, signal),
    staleTime: Infinity,
  })

  return (
    <div className="designer-page" data-template-theme={project.theme}>
      <header className="designer-heading">
        <div className="designer-page-title">
          <span className="designer-title-mark"><AdminIcon name="layout" /></span>
          <h1>大屏编排</h1>
        </div>
        {!query.data && <ProjectChoice projectId={projectId} onChange={setProject} />}
      </header>
      {query.data ? <DraftBoard key={projectId} projectId={projectId} workspace={query.data} setProject={setProject} /> :
        query.isPending ? <div className="designer-state" aria-busy="true"><Spin size="small" /> 正在加载草稿</div> : (
          <AdminError
            error={query.error instanceof ApiError && query.error.status === 404 && query.error.code !== 'PROJECT_NOT_FOUND'
              ? new Error('当前后端还未提供看板草稿接口，请切换新版服务后重试。') : query.error}
            retry={() => void query.refetch()}
          />
        )}
    </div>
  )
}

function DraftBoard({ projectId, workspace, setProject }: {
  projectId: string
  workspace: DraftWorkspace
  setProject: (projectId: string) => void
}) {
  const queryClient = useQueryClient()
  const [base, setBase] = useState(workspace)
  const [history, setHistory] = useState(() => initialHistory(workspace.components))
  const [selection, setSelection] = useState<string[]>(() => workspace.components.slice(0, 1).map(component => component.id))
  const [multiSelect, setMultiSelect] = useState(false)
  const [alignment, setAlignment] = useState<Alignment>()
  const [preview, setPreview] = useState(false)
  const [showSaveError, setShowSaveError] = useState(false)
  const [zoom, setZoom] = useState('fit')
  const [fitted, setFitted] = useState(0.5)
  const [transient, setTransient] = useState<{ componentId: string; geometry: Geometry }>()
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const pointer = useRef<PointerEdit>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = base.template.canvas
  const materials = base.template.components
  const components = history.present
  const topicMode = topicModeFor(base.template.theme)
  const visibleComponents = topicMode && transient ? components.map(component => component.id === transient.componentId
    ? { ...component, geometry: transient.geometry } : component) : components
  const focusId = topicMode ? topicFocusId(visibleComponents) : undefined
  const selectedIds = new Set(selection)
  const selectedComponents = components.filter(component => selectedIds.has(component.id))
  const selectedCount = selectedComponents.length
  const selected = selectedCount === 1 ? selectedComponents[0] : undefined
  const groupBounds = selectedCount > 1 ? componentBounds(selectedComponents) : null
  const alignmentReference = selectedCount === 1 ? 'canvas' : 'selection'
  const guide = alignment && !transient ? alignmentGuide(selectedComponents, alignment, canvas, alignmentReference) : null
  const dirty = JSON.stringify(components) !== JSON.stringify(base.components)
  const scale = zoom === 'fit' ? fitted : Number(zoom)
  const save = useMutation({
    mutationFn: () => designerApi.save(projectId, base.revision, components),
  })
  const reload = useMutation({ mutationFn: () => designerApi.draft(projectId) })
  const busy = save.isPending || reload.isPending
  const conflict = save.error instanceof ApiError && save.error.code === 'VERSION_CONFLICT'
  const editingDisabled = busy || preview
  const values = new Map(base.snapshot.results.map(result => [result.metricId, result]))

  useEffect(() => {
    if (!dirty) return
    const preserve = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', preserve)
    return () => window.removeEventListener('beforeunload', preserve)
  }, [dirty])

  useLayoutEffect(() => {
    const stage = viewport.current
    if (!stage) return
    const measure = () => {
      const fit = Math.min(
        Math.max(1, stage.clientWidth - 32) / canvas.width,
        Math.max(1, stage.clientHeight - 32) / canvas.height,
        1,
      )
      setFitted(fit)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [canvas.height, canvas.width])

  function revise(update: (current: ScreenComponent[]) => ScreenComponent[]) {
    setHistory(current => {
      const next = update(current.present)
      if (JSON.stringify(next) === JSON.stringify(current.present)) return current
      return {
        past: [...current.past.slice(1 - maxHistory), current.present],
        present: next,
        future: [],
      }
    })
  }

  function undo() {
    setHistory(current => {
      const previous = current.past.at(-1)
      return previous ? {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      } : current
    })
  }

  function redo() {
    setHistory(current => {
      const next = current.future[0]
      return next ? {
        past: [...current.past, current.present],
        present: next,
        future: current.future.slice(1),
      } : current
    })
  }

  function updateComponent(id: string, update: (current: ScreenComponent) => ScreenComponent) {
    revise(current => current.map(component => component.id === id ? update(component) : component))
  }

  function setGeometry(id: string, geometry: Geometry) {
    updateComponent(id, component => ({ ...component, geometry }))
  }

  function selectComponent(id: string, extend: boolean) {
    setSelection(current => {
      if (!extend) return [id]
      return current.includes(id) ? current.filter(value => value !== id) : [...current, id]
    })
  }

  function clearSelection() {
    setSelection([])
    setMultiSelect(false)
  }

  function addMaterial(material: ScreenComponent, point?: { x: number; y: number }) {
    if (editingDisabled || components.length >= maxComponents) return
    const copy = cloneMaterial(material, components, canvas)
    const added = point ? {
      ...copy,
      geometry: moveGeometry(copy.geometry, point.x - copy.geometry.x, point.y - copy.geometry.y, canvas),
    } : copy
    revise(current => [...current, added])
    selectComponent(added.id, false)
  }

  function dropMaterial(event: DragEvent<HTMLDivElement>) {
    const material = materials.find(item => item.id === event.dataTransfer.getData(materialTransfer))
    if (!material || editingDisabled || components.length >= maxComponents) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    addMaterial(material, { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale })
  }

  function adjust(edit: PointerEdit, x: number, y: number) {
    const transform = edit.action === 'move' ? moveGeometry : resizeGeometry
    return transform(edit.geometry, x - edit.x, y - edit.y, canvas, edit.scale)
  }

  function beginPointer(event: PointerEvent<HTMLButtonElement>, component: ScreenComponent, action: PointerEdit['action']) {
    if (editingDisabled || event.button !== 0 || pointer.current) return
    if (action === 'move' && (multiSelect || event.shiftKey)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    selectComponent(component.id, false)
    pointer.current = {
      id: event.pointerId,
      componentId: component.id,
      geometry: component.geometry,
      x: event.clientX,
      y: event.clientY,
      action,
      scale,
    }
  }

  function dragPointer(event: PointerEvent<HTMLButtonElement>) {
    const edit = pointer.current
    if (edit?.id !== event.pointerId) return
    setTransient({ componentId: edit.componentId, geometry: adjust(edit, event.clientX, event.clientY) })
  }

  function finishPointer(event: PointerEvent<HTMLButtonElement>, apply: boolean) {
    const edit = pointer.current
    if (edit?.id !== event.pointerId) return
    pointer.current = null
    setTransient(undefined)
    if (apply) setGeometry(edit.componentId, adjust(edit, event.clientX, event.clientY))
  }

  function pointerControls(component: ScreenComponent, action: PointerEdit['action']) {
    return {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => beginPointer(event, component, action),
      onPointerMove: dragPointer,
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finishPointer(event, true),
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => finishPointer(event, false),
      onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => finishPointer(event, false),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (editingDisabled) return
        const step = event.shiftKey ? 10 : 1
        const deltas = {
          ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
        }
        const delta = deltas[event.key as keyof typeof deltas]
        if (!delta) return
        event.preventDefault()
        if (!selectedIds.has(component.id)) selectComponent(component.id, false)
        const transform = action === 'move' ? moveGeometry : resizeGeometry
        setGeometry(component.id, transform(component.geometry, delta[0], delta[1], canvas))
      },
    }
  }

  function chooseProject(next: string) {
    if (next === projectId) return
    if (dirty) setConfirmation({ kind: 'switch', projectId: next })
    else setProject(next)
  }

  function saveDraft() {
    if (busy) return
    if (conflict) {
      setShowSaveError(true)
      return
    }
    if (!dirty) return
    save.mutate(undefined, {
      onSuccess: result => {
        const next = { ...base, ...result }
        setBase(next)
        queryClient.setQueryData(projectKey(projectId), next)
      },
      onError: () => setShowSaveError(true),
    })
  }

  function confirmChange() {
    if (confirmation?.kind === 'switch') {
      setProject(confirmation.projectId)
      return
    }
    reload.mutate(undefined, {
      onSuccess: result => {
        setBase(result)
        setHistory(initialHistory(result.components))
        setSelection(result.components.slice(0, 1).map(component => component.id))
        setMultiSelect(false)
        queryClient.setQueryData(projectKey(projectId), result)
        save.reset()
        setConfirmation(undefined)
      },
    })
  }

  function canvasKeys(event: KeyboardEvent<HTMLElement>) {
    if (editingDisabled) return
    if (event.key === 'Escape') {
      clearSelection()
      return
    }
    if (!event.ctrlKey && !event.metaKey) return
    const key = event.key.toLowerCase()
    if (key === 'z' || key === 'y') {
      event.preventDefault()
      if (key === 'y' || event.shiftKey) redo()
      else undo()
    }
  }

  const previewResult = preview ? previewDraft(base.template, base.snapshot, components) : null
  const layers = [...components].reverse().sort((first, second) => second.geometry.z - first.geometry.z)

  return (
    <>
      <div className="designer-command">
        <ProjectChoice projectId={projectId} disabled={busy} onChange={chooseProject} />
        <p className="designer-revision" role="status">
          <strong>草稿 v{base.revision}</strong>
          <span data-dirty={dirty}>{dirty ? '有未保存的更改' : base.revision === 0 ? '模板布局' : '已保存'}</span>
        </p>
        <div className="designer-actions">
          <Button icon={<DesignerGlyph name="preview" />} onClick={() => setPreview(true)} disabled={busy}
            aria-haspopup="dialog">预览草稿</Button>
          <DashboardReleases projectId={projectId} revision={base.revision} disabled={dirty || busy || conflict} />
          <Button type="primary" aria-label="保存草稿" aria-busy={save.isPending}
            icon={<DesignerGlyph name="save" />} loading={save.isPending} disabled={(!dirty && !conflict) || reload.isPending}
            onClick={saveDraft}>保存草稿</Button>
        </div>
      </div>
      <div className="designer-workspace">
        <section className="designer-stage" aria-label="画布" onKeyDown={canvasKeys}>
          <header className="designer-stage-bar">
            <div className="designer-stage-label">
              <h2><AdminIcon name="layout" />画布</h2>
              <span className="designer-screen-size">{canvas.width} × {canvas.height}</span>
            </div>
            <div className="designer-stage-controls">
              <div className="designer-history" role="group" aria-label="编辑记录">
                <Button type="text" size="small" autoInsertSpace={false} icon={<DesignerGlyph name="undo" />}
                  onClick={undo} disabled={busy || !history.past.length}>撤销</Button>
                <Button type="text" size="small" autoInsertSpace={false} icon={<DesignerGlyph name="redo" />}
                  onClick={redo} disabled={busy || !history.future.length}>重做</Button>
              </div>
              <select aria-label="画布缩放" value={zoom} disabled={busy} onChange={event => setZoom(event.currentTarget.value)}>
                <option value="fit">适合窗口</option>
                <option value="0.5">50%</option>
                <option value="1">100%</option>
                <option value="1.5">150%</option>
              </select>
            </div>
          </header>
          <div className="designer-alignment">
            <div className="designer-selection">
              <Button size="small" autoInsertSpace={false} icon={<DesignerGlyph name="multi" />}
                aria-pressed={multiSelect} title="开启后点击画布或图层逐个选择，也可按住 Shift 点击"
                disabled={editingDisabled || !components.length} onClick={() => setMultiSelect(current => !current)}>
                多选组件
              </Button>
              <span className="designer-selection-status" role="status">
                {selectedCount ? '已选 ' + selectedCount + ' 个' : '未选择'}
              </span>
            </div>
            <div className="designer-arrange">
              <span className="designer-arrange-label">组件对齐</span>
              <div className="designer-alignment-buttons" role="group" aria-label="组件对齐">
                {alignmentTools.map(tool => (
                  <Button size="small" className="designer-align-button" key={tool.id} icon={<DesignerGlyph name={tool.id} />}
                    aria-label={tool.label} title={tool.label} disabled={editingDisabled || !selectedCount}
                    onFocus={() => setAlignment(tool.id)} onBlur={() => setAlignment(undefined)}
                    onPointerEnter={() => setAlignment(tool.id)} onPointerLeave={event => {
                      if (!event.currentTarget.matches(':focus-visible')) setAlignment(undefined)
                    }}
                    onClick={() => revise(current => alignComponents(current, selectedIds, tool.id, canvas, alignmentReference))}>
                    <span className="designer-align-label">{tool.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <div ref={viewport} className="designer-viewport" data-fit={zoom === 'fit'}>
            <div className="designer-canvas-size" style={{ width: canvas.width * scale, height: canvas.height * scale }}>
              <div className="designer-canvas" data-theme={base.template.theme} data-topic-mode={topicMode}
                style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale})` }}
                onDragOver={event => {
                  if (!editingDisabled && components.length < maxComponents && event.dataTransfer.types.includes(materialTransfer)) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                  }
                }}
                onDrop={dropMaterial}
                onClick={event => {
                  if (event.target === event.currentTarget && !editingDisabled) clearSelection()
                }}>
                {topicMode && <TopicNetwork theme={base.template.theme} size={canvas} components={visibleComponents} />}
                {visibleComponents.map(component => {
                  const geometry = transient?.componentId === component.id ? transient.geometry : component.geometry
                  const isSelected = selectedIds.has(component.id)
                  return (
                    <article key={component.id} className="designer-widget" data-selected={isSelected}
                      data-component-id={component.id} data-kind={component.type}
                      style={{
                        left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height,
                        zIndex: selected?.id === component.id ? 1001 : geometry.z,
                        '--designer-handle-size': `${Math.round(34 / scale)}px`,
                        '--designer-outline-width': `${1.5 / scale}px`,
                        '--designer-handle-mark': `${8 / scale}px`,
                      } as CSSProperties}>
                      <div className="designer-widget-content screen-component" data-kind={component.type}
                        data-topic-focus={component.id === focusId || undefined} aria-hidden="true">
                        <ScreenComponentContent component={component} data={values.get(component.metricId)}
                          prominent={component.id === focusId} />
                      </div>
                      <button type="button" className="designer-widget-move" disabled={editingDisabled}
                        aria-label={'移动 ' + component.title} aria-pressed={isSelected}
                        onClick={event => selectComponent(component.id, multiSelect || event.shiftKey)}
                        {...pointerControls(component, 'move')} />
                      {selected?.id === component.id && <button type="button" disabled={editingDisabled} className="designer-widget-resize"
                        aria-label={'调整大小 ' + component.title} {...pointerControls(component, 'resize')} />}
                    </article>
                  )
                })}
                {groupBounds && (
                  <div className="designer-group-outline" aria-hidden="true" style={{
                    left: groupBounds.x, top: groupBounds.y, width: groupBounds.width, height: groupBounds.height,
                    borderWidth: 1 / scale,
                  }} />
                )}
                {guide && !editingDisabled && (
                  <div className="designer-alignment-guide" data-axis={guide.axis} aria-hidden="true" style={{
                    [guide.axis === 'x' ? 'left' : 'top']: Math.min(guide.offset, (guide.axis === 'x' ? canvas.width : canvas.height) - 1 / scale),
                    '--guide-pixel': String(1 / scale) + 'px',
                  } as CSSProperties} />
                )}
              </div>
            </div>
            {!components.length && <p className="designer-canvas-empty">画布为空。从组件库添加组件。</p>}
          </div>
          <footer className="designer-stage-status">
            <span>{selectedCount > 1 ? '对齐基准为选区外框'
              : selected ? '对齐基准为画布'
                : components.length ? '选中画布或图层中的组件即可对齐' : '从组件库添加或拖入组件'}</span>
            <output aria-label="实际缩放比例">{Math.round(scale * 100)}%</output>
          </footer>
        </section>
        <aside className="designer-materials" aria-label="组件库和图层">
          <div className="designer-panel-title">
            <h2><AdminIcon name="add" />组件库</h2>
            <span className="designer-count" title="画布已用组件数与上限">{components.length} / {maxComponents}</span>
          </div>
          <ul className="designer-list designer-material-list">
            {materials.map(material => (
              <li key={material.id}>
                <button type="button" className="designer-material" aria-label={'添加 ' + material.title}
                  disabled={busy || components.length >= maxComponents} onClick={() => addMaterial(material)}
                  draggable={!busy && components.length < maxComponents}
                  onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'copy'
                    event.dataTransfer.setData(materialTransfer, material.id)
                  }}>
                  <span className="designer-material-mark" data-kind={material.type}><ComponentGlyph component={material} /></span>
                  <span className="designer-item-text">{material.title}<small>{chartStyleLabel(material)}</small></span>
                  <span className="designer-item-add"><AdminIcon name="add" /></span>
                </button>
              </li>
            ))}
          </ul>
          <div className="designer-panel-title designer-layer-title"><h2><DesignerGlyph name="layers" />图层</h2></div>
          {layers.length ? (
            <ul className="designer-list designer-layers">
              {layers.map(component => (
                <li key={component.id}>
                  <button type="button" className="designer-layer" aria-label={'组件 ' + component.title}
                    title={chartStyleLabel(component)} aria-pressed={selectedIds.has(component.id)} disabled={editingDisabled}
                    onClick={event => selectComponent(component.id, multiSelect || event.shiftKey)}>
                    <ComponentGlyph component={component} /><span className="designer-item-text">{component.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="designer-empty">暂无组件</p>}
        </aside>
        <aside className="designer-inspector" aria-label="组件属性">
          <div className="designer-panel-title">
            <h2><AdminIcon name="settings" />组件属性</h2>
            {selected && <span className="designer-kind" data-kind={selected.type}>{chartStyleLabel(selected)}</span>}
            {selectedCount > 1 && <span className="designer-kind">已选 {selectedCount} 个</span>}
          </div>
          {selected ? (
            <Properties component={selected} materials={materials} disabled={busy} canvas={canvas}
              update={update => updateComponent(selected.id, update)}
              layer={placement => revise(current => setLayer(current, selected.id, placement))}
              canLayer={components.length > 1}
              remove={() => {
                revise(current => current.filter(component => component.id !== selected.id))
                clearSelection()
              }} />
          ) : selectedCount ? (
            <div className="designer-group-details">
              <p>可同时对齐选区中的 {selectedCount} 个组件。</p>
              <Button size="small" autoInsertSpace={false} onClick={clearSelection} disabled={editingDisabled}>清空选择</Button>
            </div>
          ) : <p className="designer-empty">选择画布或图层中的组件。</p>}
        </aside>
      </div>
      <Modal
        title={base.template.title + ' · 草稿预览'}
        open={preview}
        centered
        width={1152}
        className="designer-dialog designer-preview-dialog"
        destroyOnHidden
        onCancel={() => setPreview(false)}
        footer={<Button onClick={() => setPreview(false)}>返回编辑</Button>}
      >
        {previewResult && (
          <section className="designer-preview" aria-label="草稿预览">
            {components.length ? <ScreenCanvas manifest={previewResult.manifest} snapshot={previewResult.snapshot} /> :
              <p>画布为空。返回编辑添加组件。</p>}
          </section>
        )}
      </Modal>
      <Modal
        title="保存草稿失败"
        open={showSaveError && !!save.error}
        className="designer-dialog"
        centered
        onCancel={() => setShowSaveError(false)}
        footer={(
          <>
            <Button onClick={() => setShowSaveError(false)}>继续编辑</Button>
            {conflict && <Button type="primary" onClick={() => {
              setShowSaveError(false)
              setConfirmation({ kind: 'reload' })
            }}>加载服务器草稿</Button>}
          </>
        )}
      >
        {conflict ? (
          <p role="alert"><strong>草稿版本有更新。</strong> 当前编辑已保留。加载服务器草稿前可继续预览。</p>
        ) : <AdminError error={save.error} />}
      </Modal>
      <Modal
        title={confirmation?.kind === 'reload' ? '加载服务器草稿' : '切换专题'}
        open={!!confirmation}
        className="designer-dialog"
        okText={confirmation?.kind === 'reload' ? '放弃更改并加载' : '放弃更改并切换'}
        cancelText="继续编辑"
        okButtonProps={{ danger: true }}
        confirmLoading={reload.isPending}
        onOk={confirmChange}
        onCancel={() => {
          if (!reload.isPending) {
            reload.reset()
            setConfirmation(undefined)
          }
        }}
      >
        <p>当前草稿有未保存的更改。继续后，这些更改将被丢弃。</p>
        <AdminError error={reload.error} />
      </Modal>
    </>
  )
}

function Properties({ component, materials, disabled, canvas, update, layer, canLayer, remove }: {
  component: ScreenComponent
  materials: ScreenComponent[]
  disabled: boolean
  canvas: DraftWorkspace['template']['canvas']
  update: (update: (current: ScreenComponent) => ScreenComponent) => void
  layer: (placement: 'front' | 'back') => void
  canLayer: boolean
  remove: () => void
}) {
  const fields = [
    ['x', 'X 坐标'], ['y', 'Y 坐标'], ['width', '宽度'], ['height', '高度'],
  ] as const
  const chartOptions = chartStyleOptions(component.type)

  function submitValue(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  return (
    <div className="designer-properties">
      <section className="designer-property-group" aria-label="组件内容与指标">
        <Field label="组件标题">
          <Input key={component.id + component.title} defaultValue={component.title} disabled={disabled} maxLength={100}
            onKeyDown={submitValue} onBlur={event => {
              const title = event.currentTarget.value.trim() || component.title
              event.currentTarget.value = title
              if (title !== component.title) update(current => ({ ...current, title }))
            }} />
        </Field>
        <Field label="绑定指标">
          <select value={component.metricId} disabled={disabled} onChange={event => {
            const material = materials.find(item => item.metricId === event.currentTarget.value && item.type === component.type)
            if (!material) return
            const previous = materials.find(item => item.metricId === component.metricId)
            update(current => ({
              ...current,
              title: previous?.title === current.title ? material.title : current.title,
              metricId: material.metricId,
              unit: material.unit,
            }))
          }}>
            {materials.filter(item => item.type === component.type)
              .map(item => <option key={item.metricId} value={item.metricId}>{item.title}</option>)}
          </select>
        </Field>
        {chartOptions.length > 0 && (
          <Field label="图表类型">
            <select value={chartStyleFor(component)} disabled={disabled} onChange={event => {
              const chartStyle = chartOptions.find(option => option.value === event.currentTarget.value)?.value
              if (chartStyle) update(current => ({ ...current, chartStyle }))
            }}>
              {chartOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </Field>
        )}
      </section>
      <section className="designer-property-group designer-placement" aria-labelledby="designer-placement-title">
        <div className="designer-group-heading">
          <h3 id="designer-placement-title">位置与大小</h3>
          <span>px</span>
        </div>
        <div className="designer-geometry">
          {fields.map(([key, label]) => (
            <Field label={label} key={key}>
              <input type="number" step={1} key={component.id + component.geometry[key]} disabled={disabled}
                defaultValue={component.geometry[key]} onKeyDown={submitValue} onBlur={event => {
                  const value = event.currentTarget.valueAsNumber
                  const original = component.geometry
                  const offset = Number.isFinite(value) ? value - original[key] : 0
                  const geometry = key === 'x' ? moveGeometry(original, offset, 0, canvas)
                    : key === 'y' ? moveGeometry(original, 0, offset, canvas)
                      : resizeGeometry(original, key === 'width' ? offset : 0, key === 'height' ? offset : 0, canvas)
                  event.currentTarget.value = String(geometry[key])
                  if (geometry[key] !== original[key]) update(current => ({ ...current, geometry }))
                }} />
            </Field>
          ))}
        </div>
      </section>
      <div className="designer-property-actions">
        <Button size="small" autoInsertSpace={false} onClick={() => layer('front')} disabled={disabled || !canLayer}>置顶</Button>
        <Button size="small" autoInsertSpace={false} onClick={() => layer('back')} disabled={disabled || !canLayer}>置底</Button>
        <Button size="small" autoInsertSpace={false} danger onClick={remove} disabled={disabled}>移除</Button>
      </div>
    </div>
  )
}
