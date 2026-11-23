export const recognitionConfiguration = {
  preferredProvider: 'doubao-streaming-asr-2.0',
  providerLabel: '豆包流式语音识别模型 2.0',
  activeMode: 'simulation',
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
