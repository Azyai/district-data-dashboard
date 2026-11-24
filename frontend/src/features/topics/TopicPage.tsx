import { skipToken, useQuery } from '@tanstack/react-query'
import { Spin } from 'antd'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, dashboardApi, type ComponentData, type Manifest } from '../../api/client'
import { useMicrophone } from '../assistant/useMicrophone'
import { interpretCockpitIntent } from '../assistant/intent'
import { ScreenComponentContent } from '../playback/ScreenCanvas'
import { analyzeTopic } from './topicInsight'
import { asksForInsight, matchTopics, topicFor, topicPath, topics, type TopicId } from './topicCatalog'
import './topics.css'

const formatDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeZone: 'Asia/Shanghai' })
const activateByVoice = /^(?:请|帮我)?(?:打开|切换|看|查看|显示|进入)/
const closeByVoice = /^(?:请|帮我)?(?:返回|回到|关闭)(首页|总览|地图|专题|驾驶舱|工作台)[。！]?$/u

type TopicProps = {
  topicId: TopicId
  initialQuestion: string
  onNavigate: (path: string) => void
  onSelect: (id: TopicId, question?: string) => void
}

function topicTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间待更新' : formatDate.format(date)
}

function TopicConversation({ manifest, snapshot, initialQuestion, onNavigate, onSelect }: TopicProps & {
  manifest: Manifest
  snapshot: ComponentData
}) {
  const [input, setInput] = useState('')
  const [request, setRequest] = useState(initialQuestion)
  const [notice, setNotice] = useState('')
  const speech = useRef<SpeechSynthesisUtterance>(null)
  const microphone = useMicrophone()
  const locations = useQuery({
    queryKey: ['cockpit-locations'],
    queryFn: ({ signal }) => dashboardApi.locations(signal),
    staleTime: 300_000,
  })
  const topic = topicFor(manifest.projectId)
  const insight = request ? analyzeTopic(request, manifest, snapshot) : null
  useEffect(() => () => {
    if (speech.current) window.speechSynthesis.cancel()
  }, [])

  function stopReading() {
    if (!speech.current) return
    window.speechSynthesis.cancel()
    speech.current = null
  }

  function ask(question: string) {
    const text = question.trim()
    if (!text) return
    if (microphone.active) microphone.cancel()
    stopReading()
    const departure = closeByVoice.exec(text)?.[1]
    if (departure) return onNavigate(departure === '工作台' || departure === '专题' ? '/workbench' : '/')
    if (!locations.data) {
      setNotice(locations.isError ? '区域目录暂不可用，请稍后重试。' : '区域目录加载中，请稍候。')
      return
    }
    const scope = interpretCockpitIntent(text, 'mentougou', locations.data, command => matchTopics(command).length > 0)
    if (scope.kind === 'clarify' && scope.reason !== 'missing-navigation-target') {
      setNotice(scope.message)
      return
    }
    if (scope.kind === 'navigate' || scope.kind === 'problems') {
      onNavigate('/data/areas/' + encodeURIComponent(scope.areaId) + (scope.kind === 'problems' ? '#area-issues' : ''))
      return
    }
    if ('areaId' in scope && scope.areaId !== 'mentougou') {
      const region = locations.data.find(item => item.id === scope.areaId)?.name ?? '该区域'
      setNotice(region + '暂无专题快照。当前专题范围是门头沟区全区。')
      return
    }
    const matched = matchTopics(text)
    if (matched.length === 1 && matched[0].id !== manifest.projectId && (activateByVoice.test(text) || asksForInsight(text))) {
      onSelect(matched[0].id, asksForInsight(text) ? text : undefined)
      return
    }
    if (matched.length > 1) {
      setNotice('请先选择一个专题。可在上方切换专题。')
      return
    }
    setNotice('')
    setRequest(text)
    setInput('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    ask(input)
  }

  function readInsight() {
    if (!insight) return
    const voice = window.speechSynthesis?.getVoices().find(candidate => candidate.localService && /^zh\b/i.test(candidate.lang))
    if (!voice) {
      setNotice('设备暂未安装中文朗读语音。')
      return
    }
    const reading = new SpeechSynthesisUtterance(insight.text)
    reading.voice = voice
    reading.lang = voice.lang
    stopReading()
    speech.current = reading
    reading.onend = reading.onerror = () => { if (speech.current === reading) speech.current = null }
    window.speechSynthesis.speak(reading)
  }

  return (
    <div className="topic-composer">
      {insight && (
        <section className="topic-insight" aria-label="专题分析">
          <header>
            <h2>专题分析</h2>
            <button type="button" onClick={() => { setRequest(''); setNotice(''); stopReading() }}>收起分析</button>
          </header>
          <p role="status">{insight.text}</p>
          <footer>
            <span>依据 {insight.evidence.length ? insight.evidence.join('、') + ' · ' : ''}
              {manifest.releaseId} · <time dateTime={snapshot.updatedAt}>{topicTimestamp(snapshot.updatedAt)}</time>
            </span>
            <button type="button" onClick={readInsight}>朗读</button>
          </footer>
        </section>
      )}
      <form className="topic-input" onSubmit={submit}>
        <input aria-label="追问当前专题" placeholder={topic?.samples[0] ?? '输入想了解的问题'}
          value={input} maxLength={160} onChange={event => setInput(event.target.value)} />
        <button type="button" className="topic-microphone" aria-pressed={microphone.active}
          onClick={() => microphone.listen(ask)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11v1a6.5 6.5 0 0 0 13 0v-1M12 19v3" />
          </svg>
          {microphone.active ? '取消录音' : '语音追问'}
        </button>
        <button type="submit" className="topic-submit" disabled={!input.trim()}>分析</button>
      </form>
      <div className="topic-query-status" role="status">{notice || microphone.status}</div>
    </div>
  )
}

function TopicContent(props: TopicProps) {
  const { topicId } = props
  const manifestQuery = useQuery({
    queryKey: ['public-topic-manifest', topicId],
    queryFn: ({ signal }) => dashboardApi.topicManifest(topicId, signal),
    staleTime: 60_000,
  })
  const manifest = manifestQuery.data
  const releaseId = manifest?.releaseId
  const snapshotQuery = useQuery({
    queryKey: ['public-topic-snapshot', topicId, releaseId],
    queryFn: releaseId ? ({ signal }) => dashboardApi.topicSnapshot(topicId, releaseId, signal) : skipToken,
  })
  const snapshot = snapshotQuery.data
  const error = manifestQuery.error ?? snapshotQuery.error
  return (
    <div className="topic-stage" data-topic={topicId}>
      <div className="topic-section-heading">
        <h1 id="topic-title" tabIndex={-1}>{topicFor(topicId)?.title}</h1>
        <p>门头沟区全区 <span>模拟数据</span>{snapshot && <time dateTime={snapshot.updatedAt}>{topicTimestamp(snapshot.updatedAt)}</time>}</p>
      </div>
      {error ? (
        <div className="topic-state" role="alert">
          <p>{error.message}</p>
          <button type="button" onClick={() => {
            if (manifestQuery.isError || (error instanceof ApiError && error.code === 'RELEASE_CONFLICT')) void manifestQuery.refetch()
            else void snapshotQuery.refetch()
          }}>重试</button>
        </div>
      ) : manifest && snapshot ? (
        <>
          <TopicReadings manifest={manifest} snapshot={snapshot} />
          <TopicConversation key={topicId + ':' + props.initialQuestion} {...props} manifest={manifest} snapshot={snapshot} />
        </>
      ) : <div className="topic-state" aria-live="polite" aria-busy="true"><Spin /><span>正在读取专题</span></div>}
    </div>
  )
}

function TopicReadings({ manifest, snapshot }: { manifest: Manifest; snapshot: ComponentData }) {
  const values = new Map(snapshot.results.map(result => [result.componentId, result]))
  const summaries = manifest.components.filter(component => component.type === 'kpi')
  const charts = manifest.components.filter(component => component.type !== 'kpi')
  return <>
    <section className="topic-summaries" aria-label="核心指标">
      {summaries.map(component => (
        <article className="screen-component" key={component.id} data-kind="kpi">
          <ScreenComponentContent component={component} data={values.get(component.id)} />
        </article>
      ))}
    </section>
    <section className="topic-charts" aria-label="趋势和结构">
      {charts.map((component, index) => (
        <article className="screen-component" key={component.id} data-kind={component.type}>
          <ScreenComponentContent component={component} data={values.get(component.id)} prominent={index === 0} />
        </article>
      ))}
    </section>
  </>
}

export default function TopicPage() {
  const topic = topicFor(useParams().topicId ?? null)
  const location = useLocation()
  const navigate = useNavigate()
  const question: unknown = location.state?.topicQuestion

  useEffect(() => {
    document.getElementById('topic-title')?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [topic])

  if (!topic) return <main className="center-state">
    <h1>专题不存在</h1><Link to="/workbench" className="action-link">返回工作台</Link>
  </main>

  return (
    <main className="topic-page" aria-labelledby="topic-title">
      <header className="topic-header">
        <Link className="topic-back" to="/workbench">‹ 工作台</Link>
        <nav className="topic-nav" aria-label="切换专题">
          {topics.map(entry => <NavLink key={entry.id} to={topicPath(entry.id)}>{entry.title}</NavLink>)}
        </nav>
        <Link className="topic-map-link" to="/">返回地图</Link>
      </header>
      <TopicContent key={topic.id} topicId={topic.id} initialQuestion={typeof question === 'string' ? question.slice(0, 160) : ''}
        onNavigate={path => { void navigate(path) }}
        onSelect={(id, nextQuestion) => { void navigate(topicPath(id), { state: { topicQuestion: nextQuestion } }) }} />
    </main>
  )
}
