export const recognitionConfiguration = {
  preferredProvider: 'doubao-streaming-asr-2.0',
  providerLabel: '豆包流式语音识别模型 2.0',
  activeMode: 'browser-local',
} as const

type TranscriptionInput =
  | { source: 'demo'; text: string }
  | { source: 'microphone' }

export type TranscriptionState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'transcribing'; text: string }
  | { phase: 'completed'; text: string }
  | { phase: 'unavailable' | 'failed'; message: string }

export interface TranscriptionProvider {
  transcribe(
    input: TranscriptionInput,
    signal: AbortSignal,
    publish: (state: TranscriptionState) => void,
  ): Promise<void>
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    function abort() {
      window.clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export const demoTranscription: TranscriptionProvider = {
  async transcribe(input, signal, publish) {
    if (input.source !== 'demo') {
      publish({ phase: 'unavailable', message: '麦克风转写需要接通语音网关。' })
      return
    }

    publish({ phase: 'connecting' })
    await wait(180, signal)
    publish({ phase: 'transcribing', text: input.text.slice(0, 7) })
    await wait(280, signal)
    signal.throwIfAborted()
    publish({ phase: 'completed', text: input.text })
  },
}

type LocalSpeechEvent = Event & {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

type LocalSpeech = {
  lang: string
  interimResults: boolean
  processLocally?: boolean
  onresult?: ((event: LocalSpeechEvent) => void) | null
  onerror?: ((event: Event & { error: string }) => void) | null
  onend?: (() => void) | null
  start: () => void
  abort: () => void
}

type LocalSpeechConstructor = {
  new (): LocalSpeech
  available?: (options: { langs: string[]; processLocally: true }) => Promise<string>
  install?: (options: { langs: string[]; processLocally: true }) => Promise<boolean>
}

const unavailable = { phase: 'unavailable', message: '此浏览器无法使用本机中文语音识别，请输入文字。' } as const

export const microphoneTranscription: TranscriptionProvider = {
  async transcribe(input, signal, publish) {
    if (input.source !== 'microphone') return
    const browser = window as Window & { SpeechRecognition?: LocalSpeechConstructor; webkitSpeechRecognition?: LocalSpeechConstructor }
    const Speech = browser.SpeechRecognition ?? browser.webkitSpeechRecognition
    const speech = Speech ? new Speech() : null
    if (!window.isSecureContext || !Speech || !speech || !('processLocally' in speech)) {
      publish(unavailable)
      return
    }
    publish({ phase: 'connecting' })
    speech.lang = 'zh-CN'
    speech.processLocally = true
    speech.interimResults = true
    if (Speech.available) {
      const options = { langs: [speech.lang], processLocally: true as const }
      const status = await Speech.available(options)
      signal.throwIfAborted()
      const canInstall = status === 'downloadable' || status === 'downloading'
      if (status !== 'available' && !(canInstall && await Speech.install?.(options))) {
        publish(unavailable)
        return
      }
    }
    signal.throwIfAborted()

    const engine = speech
    await new Promise<void>(resolve => {
      function finish(state?: TranscriptionState) {
        window.clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        engine.onresult = engine.onend = engine.onerror = null
        if (state && !signal.aborted) publish(state)
        resolve()
      }
      function abort() {
        finish()
        engine.abort()
      }
      const timer = window.setTimeout(() => {
        finish({ phase: 'failed', message: '暂未听到指令，请再试一次或输入文字。' })
        speech.abort()
      }, 16_000)
      signal.addEventListener('abort', abort, { once: true })
      speech.onresult = event => {
        const result = event.results[event.resultIndex]
        const text = result?.[0].transcript.trim()
        if (!text) return
        if (result.isFinal) finish({ phase: 'completed', text: text.slice(0, 160) })
        else publish({ phase: 'transcribing', text })
      }
      speech.onend = () => finish({ phase: 'failed', message: '暂未识别到指令，请重试。' })
      speech.onerror = event => finish(event.error === 'not-allowed'
        ? { phase: 'failed', message: '请允许浏览器使用麦克风，或输入文字。' }
        : event.error === 'language-not-supported' ? unavailable
          : { phase: 'failed', message: '麦克风识别中断，请重试或输入文字。' })
      try {
        speech.start()
      } catch {
        finish(unavailable)
      }
    })
  },
}
