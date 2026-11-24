import { skipToken, useQuery } from '@tanstack/react-query'
import { Modal, Spin } from 'antd'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, dashboardApi, type ComponentData, type Manifest } from '../../api/client'
import { useMicrophone } from '../assistant/useMicrophone'
import { interpretCockpitIntent } from '../assistant/intent'
import { ScreenCanvas } from '../playback/ScreenCanvas'
import { analyzeTopic } from './topicInsight'
import { asksForInsight, matchTopics, topicFor, topics, type TopicId } from './topicCatalog'
import './topics.css'

const formatDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeZone: 'Asia/Shanghai' })
const activateByVoice = /^(?:请|帮我)?(?:打开|切换|看|查看|显示|进入)/
const closeByVoice = /^(?:请|帮我)?(?:返回|回到|关闭)(?:首页|总览|地图|专题|驾驶舱)[。！]?$/u

type TopicProps = {
  topicId: TopicId
  initialQuestion: string
  onClose: () => void
  onSelect: (id: TopicId, question?: string) => void
}

function topicTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间待更新' : formatDate.format(date)
}

function TopicConversation({ manifest, snapshot, initialQuestion, onClose, onSelect }: TopicProps & {
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
    if (closeByVoice.test(text)) return onClose()
    if (!locations.data) {
      setNotice(locations.isError ? '区域目录暂不可用，请关闭专题后重试。' : '区域目录加载中，请稍候。')
      return
    }
    const scope = interpretCockpitIntent(text, 'mentougou', locations.data, command => matchTopics(command).length > 0)
    if (scope.kind === 'clarify' && scope.reason !== 'missing-navigation-target') {
      setNotice(scope.message)
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
            <h3>专题分析</h3>
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
  const { topicId, onSelect } = props
  const manifestQuery = useQuery({
    queryKey: ['public-topic-manifest', topicId],
    queryFn: ({ signal }) => dashboardApi.topicManifest(topicId, signal),
    refetchInterval: 10_000,
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
      <div className="topic-nav">
        <nav aria-label="切换专题">
          {topics.map(topic => (
            <button key={topic.id} type="button" aria-current={topic.id === topicId ? 'page' : undefined}
              onClick={() => onSelect(topic.id)}>{topic.title}</button>
          ))}
        </nav>
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
          <ScreenCanvas manifest={manifest} snapshot={snapshot} />
          <TopicConversation key={topicId + ':' + props.initialQuestion} {...props} manifest={manifest} snapshot={snapshot} />
        </>
      ) : <div className="topic-state" aria-live="polite" aria-busy="true"><Spin /><span>正在读取专题</span></div>}
    </div>
  )
}

export default function TopicDialog(props: TopicProps) {
  const title = topicFor(props.topicId)?.title
  return (
    <Modal title={title} open centered onCancel={props.onClose} footer={null} width="min(96vw, 108rem)"
      destroyOnHidden className="topic-dialog" mask={{ closable: false }}>
      <TopicContent {...props} />
    </Modal>
  )
}
