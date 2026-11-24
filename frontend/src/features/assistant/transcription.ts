type LocalSpeechEvent = Event & {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

export type LocalSpeech = {
  lang: string
  interimResults: boolean
  continuous: boolean
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

export async function prepareLocalSpeech(signal: AbortSignal): Promise<LocalSpeech | null> {
  const browser = window as Window & { SpeechRecognition?: LocalSpeechConstructor; webkitSpeechRecognition?: LocalSpeechConstructor }
  const Speech = browser.SpeechRecognition ?? browser.webkitSpeechRecognition
  if (!window.isSecureContext || !Speech) return null
  const engine = new Speech()
  if (!('processLocally' in engine)) return null
  engine.lang = 'zh-CN'
  engine.processLocally = true
  if (Speech.available) {
    const options = { langs: [engine.lang], processLocally: true as const }
    const status = await Speech.available(options)
    signal.throwIfAborted()
    const canInstall = status === 'downloadable' || status === 'downloading'
    if (status !== 'available' && !(canInstall && await Speech.install?.(options))) return null
  }
  signal.throwIfAborted()
  return engine
}
