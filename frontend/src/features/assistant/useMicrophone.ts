import { useEffect, useRef, useState } from 'react'
import { microphoneTranscription, type TranscriptionState } from './transcription'

export function useMicrophone() {
  const [state, setState] = useState<TranscriptionState>({ phase: 'idle' })
  const pending = useRef<AbortController>(null)

  useEffect(() => () => pending.current?.abort(), [])

  function cancel() {
    pending.current?.abort()
    pending.current = null
    setState({ phase: 'idle' })
  }

  function listen(onText: (text: string) => void) {
    if (pending.current) return cancel()
    const controller = new AbortController()
    pending.current = controller
    void microphoneTranscription.transcribe({ source: 'microphone' }, controller.signal, next => {
      if (controller.signal.aborted) return
      setState(next)
      if (next.phase === 'completed') {
        pending.current = null
        onText(next.text)
      }
    }).catch(() => {
      if (!controller.signal.aborted) setState({ phase: 'failed', message: '本机语音识别暂不可用，请输入文字。' })
    }).finally(() => {
      if (pending.current === controller) pending.current = null
    })
  }

  const active = state.phase === 'connecting' || state.phase === 'transcribing'
  const status = state.phase === 'connecting' ? '准备本机麦克风，请说出指令。'
    : state.phase === 'transcribing' ? state.text
      : state.phase === 'failed' || state.phase === 'unavailable' ? state.message : ''
  return { active, status, listen, cancel }
}
