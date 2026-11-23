import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Modal, Spin } from 'antd'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, KeyboardEvent, PointerEvent } from 'react'
import { useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import { AdminError, AdminIcon, Field } from '../admin/AdminParts'
import { ScreenCanvas, ScreenComponentContent } from '../playback/ScreenCanvas'
import { designerApi } from './designerApi'
import type { DraftWorkspace } from './designerApi'
import {
  cloneMaterial, maxComponents, moveGeometry, previewDraft, resizeGeometry, setLayer,
} from './draftLayout'
import type { Geometry, ScreenComponent } from './draftLayout'
import './designer.css'

const projects = [
  { id: 'city-operations', name: '城市运行' },
  { id: 'public-services', name: '政务服务' },
]

const kindNames = { kpi: '关键指标', trend: '趋势', ranking: '排行' }
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
  return (
    <label className="designer-project">
      <span>专题</span>
      <select value={projectId} disabled={disabled} onChange={event => onChange(event.currentTarget.value)}>
        {projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}
      </select>
    </label>
  )
}

export default function DraftEditor() {
  const [search, setSearch] = useSearchParams()
  const projectId = projects.find(project => project.id === search.get('project'))?.id ?? projects[0].id
  const setProject = (id: string) => setSearch({ project: id }, { replace: true })
  const query = useQuery({
    queryKey: projectKey(projectId),
    queryFn: ({ signal }) => designerApi.draft(projectId, signal),
    staleTime: Infinity,
  })

  return (
    <div className="designer-page">
      <header className="designer-heading">
        <h1>大屏编排</h1>
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
  const [selection, setSelection] = useState<string | undefined>(workspace.components[0]?.id)
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
  const selected = components.find(component => component.id === selection)
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

  function addMaterial(material: ScreenComponent, point?: { x: number; y: number }) {
    if (editingDisabled || components.length >= maxComponents) return
    const copy = cloneMaterial(material, components, canvas)
    const added = point ? {
      ...copy,
      geometry: moveGeometry(copy.geometry, point.x - copy.geometry.x, point.y - copy.geometry.y, canvas),
    } : copy
    revise(current => [...current, added])
    setSelection(added.id)
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
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelection(component.id)
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
        setSelection(result.components[0]?.id)
        queryClient.setQueryData(projectKey(projectId), result)
        save.reset()
        setConfirmation(undefined)
      },
    })
  }

  function canvasKeys(event: KeyboardEvent<HTMLElement>) {
    if (editingDisabled || !event.ctrlKey && !event.metaKey) return
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
          <Button onClick={() => setPreview(true)} disabled={busy} aria-haspopup="dialog">预览草稿</Button>
          <Button type="primary" aria-label="保存草稿" aria-busy={save.isPending}
            loading={save.isPending} disabled={(!dirty && !conflict) || reload.isPending}
            onClick={saveDraft}>保存草稿</Button>
        </div>
      </div>
      <div className="designer-workspace">
        <section className="designer-stage" aria-label="画布" onKeyDown={canvasKeys}>
          <header className="designer-stage-bar">
            <span className="designer-screen-size">{canvas.width} × {canvas.height}</span>
            <div className="designer-stage-controls">
              <Button size="small" autoInsertSpace={false} onClick={undo} disabled={busy || !history.past.length}>撤销</Button>
              <Button size="small" autoInsertSpace={false} onClick={redo} disabled={busy || !history.future.length}>重做</Button>
              <select aria-label="画布缩放" value={zoom} disabled={busy} onChange={event => setZoom(event.currentTarget.value)}>
                <option value="fit">适合窗口</option>
                <option value="0.5">50%</option>
                <option value="1">100%</option>
                <option value="1.5">150%</option>
              </select>
            </div>
          </header>
          <div ref={viewport} className="designer-viewport" data-fit={zoom === 'fit'}>
            <div className="designer-canvas-size" style={{ width: canvas.width * scale, height: canvas.height * scale }}>
              <div className="designer-canvas" data-theme={base.template.theme}
                style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale})` }}
                onDragOver={event => {
                  if (!editingDisabled && components.length < maxComponents && event.dataTransfer.types.includes(materialTransfer)) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                  }
                }}
                onDrop={dropMaterial}>
                {components.map(component => {
                  const geometry = transient?.componentId === component.id ? transient.geometry : component.geometry
                  const isSelected = selection === component.id
                  return (
                    <article key={component.id} className="designer-widget" data-selected={isSelected}
                      data-component-id={component.id} data-kind={component.type}
                      style={{
                        left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height,
                        zIndex: isSelected ? 1001 : geometry.z,
                        '--designer-handle-size': `${Math.round(34 / scale)}px`,
                      } as CSSProperties}>
                      <div className="designer-widget-content screen-component" data-kind={component.type} aria-hidden="true">
                        <ScreenComponentContent component={component} data={values.get(component.metricId)} />
                      </div>
                      <button type="button" className="designer-widget-move" disabled={busy}
                        aria-label={'移动 ' + component.title} aria-pressed={isSelected}
                        onFocus={() => setSelection(component.id)} onClick={() => setSelection(component.id)}
                        {...pointerControls(component, 'move')} />
                      {isSelected && <button type="button" disabled={busy} className="designer-widget-resize"
                        aria-label={'调整大小 ' + component.title} {...pointerControls(component, 'resize')} />}
                    </article>
                  )
                })}
              </div>
            </div>
            {!components.length && <p className="designer-canvas-empty">画布为空。从组件库添加组件。</p>}
          </div>
        </section>
        <aside className="designer-materials" aria-label="组件库和图层">
          <div className="designer-panel-title"><h2>组件库</h2><span>{components.length} / {maxComponents}</span></div>
          <ul className="designer-list">
            {materials.map(material => (
              <li key={material.id}>
                <button type="button" className="designer-material" aria-label={'添加 ' + material.title}
                  disabled={busy || components.length >= maxComponents} onClick={() => addMaterial(material)}
                  draggable={!busy && components.length < maxComponents}
                  onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'copy'
                    event.dataTransfer.setData(materialTransfer, material.id)
                  }}>
                  <AdminIcon name="add" /><span>{material.title}<small>{kindNames[material.type]}</small></span>
                </button>
              </li>
            ))}
          </ul>
          <div className="designer-panel-title designer-layer-title"><h2>图层</h2></div>
          {layers.length ? (
            <ul className="designer-list designer-layers">
              {layers.map(component => (
                <li key={component.id}>
                  <button type="button" className="designer-layer" aria-label={'组件 ' + component.title}
                    aria-pressed={selection === component.id} disabled={busy} onClick={() => setSelection(component.id)}>
                    <AdminIcon name="chart" /><span>{component.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="designer-empty">暂无组件</p>}
        </aside>
        <aside className="designer-inspector" aria-label="组件属性">
          <div className="designer-panel-title"><h2>组件属性</h2>{selected && <span>{kindNames[selected.type]}</span>}</div>
          {selected ? (
            <Properties component={selected} materials={materials} disabled={busy} canvas={canvas}
              update={update => updateComponent(selected.id, update)}
              layer={placement => revise(current => setLayer(current, selected.id, placement))}
              canLayer={components.length > 1}
              remove={() => {
                revise(current => current.filter(component => component.id !== selected.id))
                setSelection(undefined)
              }} />
          ) : <p className="designer-empty">选择画布或图层中的组件。</p>}
        </aside>
      </div>
      <Modal
        title={base.template.title + ' · 草稿预览'}
        open={preview}
        centered
        width={1152}
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

  function submitValue(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  return (
    <div className="designer-properties">
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
      <div className="designer-property-actions">
        <Button size="small" autoInsertSpace={false} onClick={() => layer('front')} disabled={disabled || !canLayer}>置顶</Button>
        <Button size="small" autoInsertSpace={false} onClick={() => layer('back')} disabled={disabled || !canLayer}>置底</Button>
        <Button size="small" autoInsertSpace={false} danger onClick={remove} disabled={disabled}>移除</Button>
      </div>
    </div>
  )
}
