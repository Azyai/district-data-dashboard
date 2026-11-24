import { prepareLocalSpeech, type LocalSpeech } from './transcription'

export const wakeWord = import.meta.env.VITE_VOICE_WAKE_WORD?.trim() || '小门小门'
export type VoicePhase = 'off' | 'connecting' | 'standby' | 'listening' | 'thinking' | 'speaking' | 'error'
export type VoiceState = { phase: VoicePhase; message?: string }
const commandWindow = 10_000

function recognitionMessage(error: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') return '请在浏览器中允许使用麦克风，再点击语音助手。'
  if (error === 'audio-capture') return '未检测到可用的麦克风，请检查设备后重试。'
  if (error === 'language-not-supported') return '请安装浏览器的本机中文识别语言包。'
  return '语音识别中断，点击语音助手可重新连接。'
}

// Capture is stopped before playback. The signal owns every microphone, timer and utterance for this session.
export function listenForCommands(
  signal: AbortSignal,
  answer: (question: string, signal: AbortSignal) => Promise<string>,
  publish: (state: VoiceState) => void,
) {
  let engine: LocalSpeech | null = null
  let restartTimer: number | undefined
  let commandTimer: number | undefined
  let playbackTimer: number | undefined
  let captionTimer: number | undefined
  let caption: string | undefined
  let utterance: SpeechSynthesisUtterance | null = null
  let awaitingCommand = false
  let paused = false
  let quickEnds = 0
  let partialWake = ''
  let partialTime = 0
  const phrase = compact(wakeWord) || '小门小门'

  function compact(text: string) {
    return text.normalize('NFKC').replace(/[\s，。？！、,.!?；;：:“”「」]/gu, '')
  }

  function releaseEngine() {
    if (!engine) return
    engine.onresult = engine.onend = engine.onerror = null
    engine.abort()
    engine = null
  }

  function resetWake() {
    awaitingCommand = false
    partialWake = ''
    window.clearTimeout(commandTimer)
  }

  function schedule(delay: number) {
    window.clearTimeout(restartTimer)
    if (!signal.aborted && !paused) restartTimer = window.setTimeout(() => void listen(), delay)
  }

  function stop() {
    paused = true
    resetWake()
    window.clearTimeout(restartTimer)
    window.clearTimeout(playbackTimer)
    window.clearTimeout(captionTimer)
    releaseEngine()
    if (utterance) {
      utterance.onend = utterance.onerror = null
      window.speechSynthesis.cancel()
      utterance = null
    }
  }

  function fail(message: string) {
    stop()
    if (!signal.aborted) publish({ phase: 'error', message })
  }

  function play(text: string) {
    if (signal.aborted) return
    const synth = window.speechSynthesis
    const voice = synth?.getVoices().find(item => item.localService && /^zh(?:[-_]|$)/i.test(item.lang))
    function finish(spoken: boolean) {
      window.clearTimeout(playbackTimer)
      if (utterance) utterance.onend = utterance.onerror = null
      utterance = null
      if (signal.aborted) return
      paused = false
      caption = spoken ? undefined : text + '（设备暂时无法朗读）'
      publish({ phase: 'standby', message: caption })
      if (caption) captionTimer = window.setTimeout(() => {
        caption = undefined
        if (!paused && !awaitingCommand && !signal.aborted) publish({ phase: 'standby' })
      }, 15_000)
      schedule(280)
    }
    if (!voice || typeof SpeechSynthesisUtterance === 'undefined') {
      finish(false)
      return
    }
    utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = voice.lang
    utterance.voice = voice
    utterance.onend = () => finish(true)
    utterance.onerror = () => finish(false)
    publish({ phase: 'speaking' })
    playbackTimer = window.setTimeout(() => {
      if (utterance) utterance.onend = utterance.onerror = null
      synth.cancel()
      finish(false)
    }, Math.min(120_000, 6000 + 480 * text.length))
    try { synth.speak(utterance) } catch { finish(false) }
  }

  async function execute(question: string) {
    paused = true
    window.clearTimeout(captionTimer)
    caption = undefined
    resetWake()
    releaseEngine()
    publish({ phase: 'thinking' })
    const query = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    let onAbort: (() => void) | undefined
    try {
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(query.reason)
        query.addEventListener('abort', onAbort, { once: true })
      })
      const text = await Promise.race([answer(question.slice(0, 160), query), aborted])
      query.throwIfAborted()
      play(text)
    } catch {
      if (!signal.aborted) play(query.aborted ? '查询超时，请稍后再问。' : '暂时无法读取当前区域的数据，请稍后再问。')
    } finally {
      if (onAbort) query.removeEventListener('abort', onAbort)
    }
  }

  function hear(raw: string) {
    const text = compact(raw)
    if (!text) return
    const combined = (Date.now() - partialTime < 1600 ? partialWake : '') + text
    partialWake = ''
    const index = combined.lastIndexOf(phrase)
    if (index >= 0) {
      const instruction = combined.slice(index + phrase.length)
      if (instruction) { void execute(instruction); return }
      awaitingCommand = true
      publish({ phase: 'listening' })
      window.clearTimeout(commandTimer)
      commandTimer = window.setTimeout(() => {
        resetWake()
        if (!signal.aborted) publish({ phase: 'standby' })
      }, commandWindow)
    } else if (awaitingCommand) {
      void execute(text)
    } else {
      for (let length = Math.min(phrase.length - 1, combined.length); length > 0; length--) {
        const fragment = combined.slice(-length)
        if (phrase.startsWith(fragment)) { partialWake = fragment; partialTime = Date.now(); break }
      }
    }
  }

  async function listen() {
    if (signal.aborted || paused) return
    try {
      const recognition = await prepareLocalSpeech(signal)
      if (signal.aborted || paused) return
      if (!recognition) { fail('此浏览器缺少本机中文语音识别，请使用支持本机识别的浏览器并安装中文语言包。'); return }
      engine = recognition
      recognition.continuous = true
      recognition.interimResults = false
      const started = Date.now()
      recognition.onresult = event => {
        if (engine !== recognition || paused || signal.aborted) return
        const words: string[] = []
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i]
          if (item?.isFinal && item[0]?.transcript) words.push(item[0].transcript)
        }
        if (words.length) { quickEnds = 0; hear(words.join('')) }
      }
      recognition.onend = () => {
        if (engine !== recognition || paused || signal.aborted) return
        engine = null
        quickEnds = Date.now() - started < 500 ? quickEnds + 1 : 0
        if (quickEnds >= 6) { fail('本机识别连续中断，请检查麦克风后重试。'); return }
        schedule(200 + quickEnds * 250)
      }
      recognition.onerror = event => {
        if (engine !== recognition || paused || signal.aborted) return
        if (event.error === 'no-speech') return // Native onend will reopen the microphone after silence.
        fail(recognitionMessage(event.error))
      }
      recognition.start()
      if (!paused && !signal.aborted) publish({ phase: awaitingCommand ? 'listening' : 'standby', message: awaitingCommand ? undefined : caption })
    } catch {
      if (!signal.aborted) fail('无法启动本机语音识别，请检查麦克风和中文语言包。')
    }
  }

  signal.addEventListener('abort', stop, { once: true })
  window.speechSynthesis?.getVoices()
  publish({ phase: 'connecting' })
  void listen()
}
