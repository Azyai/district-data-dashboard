import { Drawer } from 'antd'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ApiError, type CockpitArea } from '../../api/client'
import type { ScreenId } from '../screens/screenCatalog'
import { type SnapshotAnswer } from './answer'
import { demoTranscription, type TranscriptionState } from './transcription'
import { useMicrophone } from './useMicrophone'
import './assistant.css'

export type AssistantReply = {
  answer: SnapshotAnswer
  scope?: Pick<CockpitArea, 'id' | 'name' | 'updatedAt'>
  returnTo?: { name: string; path: string }
}

type AssistantContentProps = {
  area: CockpitArea
  examples?: readonly string[]
  onQuestion: (question: string, previousMetricId: string | undefined, signal: AbortSignal) => Promise<AssistantReply | null>
}

type Turn = AssistantReply & { id: number; question: string }

const defaultExamples = [
  '打开人口专题',
  '哪类诉求最多？',
  '看水务数据',
  '看大台街道的数据',
]

const dateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function transcriptionStatus(state: TranscriptionState) {
  if (state.phase === 'connecting') return '正在启动模拟转写'
  if (state.phase === 'transcribing') return '正在模拟转写：' + state.text
  if (state.phase === 'completed') return '示例已填入，确认后发送。'
  if (state.phase === 'failed' || state.phase === 'unavailable') return state.message
  return ''
}

function formatTimestamp(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? dateTime.format(parsed) : value
}

function AssistantContent({ area, onQuestion, onClose, examples = defaultExamples }: AssistantContentProps & { onClose: () => void }) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [transcription, setTranscription] = useState<TranscriptionState>({ phase: 'idle' })
  const [systemVoice, setSystemVoice] = useState<SpeechSynthesisVoice>()
  const [speaking, setSpeaking] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const microphone = useMicrophone()
  const nextTurn = useRef(0)
  const pendingTranscript = useRef<AbortController>(null)
  const pendingQuestion = useRef<AbortController>(null)
  const utterance = useRef<SpeechSynthesisUtterance>(null)
  const transcriptLog = useRef<HTMLOListElement>(null)
  const inputId = useId()
  const latest = turns.at(-1)
  const transcribing = transcription.phase === 'connecting' || transcription.phase === 'transcribing'

  useEffect(() => {
    const synth = window.speechSynthesis
    if (!synth) return
    const chooseVoice = () => setSystemVoice(
      synth.getVoices().find(voice => voice.localService && /^zh\b/i.test(voice.lang)),
    )
    chooseVoice()
    synth.addEventListener('voiceschanged', chooseVoice)
    return () => {
      synth.removeEventListener('voiceschanged', chooseVoice)
      if (utterance.current) synth.cancel()
    }
  }, [])

  useEffect(() => () => {
    pendingTranscript.current?.abort()
    pendingQuestion.current?.abort()
  }, [])

  useEffect(() => {
    const log = transcriptLog.current
    if (log) log.scrollTop = log.scrollHeight
  }, [turns])

  function stopTranscription() {
    pendingTranscript.current?.abort()
    pendingTranscript.current = null
    setTranscription({ phase: 'idle' })
  }

  function stopReading() {
    if (!utterance.current) return
    utterance.current = null
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  async function ask(text: string) {
    const normalized = text.trim()
    if (!normalized || pendingQuestion.current) return
    stopReading()
    stopTranscription()
    if (microphone.active) microphone.cancel()
    setError('')
    setQuestion(normalized)
    setWorking(true)
    const controller = new AbortController()
    pendingQuestion.current = controller
    const previousMetric = latest?.scope?.id === area.id ? latest.answer.metricId : undefined
    try {
      const reply = await onQuestion(normalized, previousMetric, controller.signal)
      if (controller.signal.aborted) return
      if (reply) {
        const turn = { ...reply, id: nextTurn.current++, question: normalized }
        setTurns(current => [...current.slice(-5), turn])
      }
      setQuestion('')
    } catch (failure) {
      if (controller.signal.aborted || (failure instanceof DOMException && failure.name === 'AbortError')) return
      setError(failure instanceof ApiError ? failure.message : '暂时无法处理这条请求，请重试。')
    } finally {
      if (pendingQuestion.current === controller) pendingQuestion.current = null
      if (!controller.signal.aborted) setWorking(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void ask(question)
  }

  function simulateVoice() {
    if (pendingTranscript.current) return
    const controller = new AbortController()
    pendingTranscript.current = controller
    void demoTranscription.transcribe(
      { source: 'demo', text: examples[0] ?? defaultExamples[0] },
      controller.signal,
      state => {
        if (controller.signal.aborted) return
        setTranscription(state)
        if (state.phase === 'completed') setQuestion(state.text)
      },
    ).catch(() => {
      if (!controller.signal.aborted) {
        setTranscription({ phase: 'failed', message: '示例转写中断，请重试或直接输入文字。' })
      }
    }).finally(() => {
      if (pendingTranscript.current === controller) pendingTranscript.current = null
    })
  }

  function readAnswer() {
    if (!systemVoice || !latest) return
    if (speaking) {
      stopReading()
      return
    }

    const speech = new SpeechSynthesisUtterance(latest.answer.text)
    speech.voice = systemVoice
    speech.lang = systemVoice.lang
    speech.onend = speech.onerror = () => {
      if (utterance.current !== speech) return
      utterance.current = null
      setSpeaking(false)
    }
    utterance.current = speech
    setSpeaking(true)
    window.speechSynthesis.speak(speech)
  }

  return (
    <div className="voice-assistant-body">
      <div className="voice-assistant-context">
        <p className="voice-assistant-scope">{area.name}</p>
        <p>打开专题、查询指标或切换区域。</p>
      </div>
      <ol ref={transcriptLog} className="voice-assistant-log" role="log" aria-label="问数记录">
        {turns.map(turn => (
          <li key={turn.id} className="voice-assistant-turn">
            <p className="voice-assistant-question">{turn.question}</p>
            <p>{turn.answer.text}</p>
            {turn.scope && (
              <p className="voice-assistant-evidence">
                依据 {turn.scope.name} · {turn.answer.evidence} · <time dateTime={turn.scope.updatedAt}>{formatTimestamp(turn.scope.updatedAt)}</time>
              </p>
            )}
            {turn.returnTo && turn.scope?.id === area.id && (
              <Link className="voice-assistant-return" to={turn.returnTo.path} onClick={onClose}>
                返回{turn.returnTo.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {turns.length === 0 && examples.length > 0 && (
        <div className="voice-assistant-examples" aria-label="示例指令">
          {examples.map(example => (
            <button type="button" key={example} disabled={working} onClick={() => void ask(example)}>{example}</button>
          ))}
        </div>
      )}
      <div className="voice-assistant-composer">
        <form className="voice-assistant-form" onSubmit={submit}>
          <label htmlFor={inputId}>输入问题或指令</label>
          <div className="voice-assistant-input-row">
            <input
              id={inputId}
              value={question}
              placeholder={examples[0] ? '例如：' + examples[0] : '输入问题'}
              maxLength={160}
              disabled={working}
              onChange={event => {
                if (transcribing) stopTranscription()
                if (microphone.active) microphone.cancel()
                setQuestion(event.target.value)
              }}
            />
            <button type="submit" disabled={working || !question.trim()}>{working ? '处理中' : '发送'}</button>
          </div>
        </form>
        <div className="voice-assistant-actions">
          <button type="button" disabled={working || transcribing} onClick={() => microphone.listen(text => void ask(text))}>
            {microphone.active ? '取消录音' : '语音提问'}
          </button>
          <button type="button" disabled={working || microphone.active} onClick={transcribing ? stopTranscription : simulateVoice}>
            {transcribing ? '取消模拟转写' : '模拟语音转写'}
          </button>
          {latest && systemVoice && (
            <button type="button" onClick={readAnswer}>{speaking ? '停止朗读' : '朗读回复'}</button>
          )}
        </div>
        <p className="voice-assistant-status" role="status">{transcriptionStatus(transcription) || microphone.status}</p>
        {error && <p className="voice-assistant-error" role="alert">{error}</p>}
      </div>
    </div>
  )
}

export function VoiceAssistant({ open, onClose, screen, ...content }: AssistantContentProps & {
  open: boolean
  onClose: () => void
  screen?: ScreenId
}) {
  return (
    <Drawer
      title="AI 问数"
      size="min(100vw, 31rem)"
      open={open}
      onClose={onClose}
      destroyOnHidden
      rootClassName={screen ? 'screen-assistant-overlay screen-assistant-' + screen : undefined}
      className="voice-assistant-drawer"
    >
      {open && <AssistantContent {...content} onClose={onClose} />}
    </Drawer>
  )
}
