import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { dashboardApi, type CockpitArea, type CockpitDirectory } from '../../api/client'
import { screenPath, type ScreenId } from '../screens/screenCatalog'
import { answerFromSnapshot } from './answer'
import { queryHotlineAnswer } from './hotlineAnswer'
import { interpretScreenIntent } from './intent'
import { answerFromScreen, screenSnapshotTime } from './screenAnswer'
import { VoiceAssistant, type AssistantReply } from './VoiceAssistant'

type Props = {
  area: CockpitArea
  locations: CockpitDirectory
  screen?: ScreenId
  month?: string
}

const examplesByScreen: Record<ScreenId, readonly string[]> = {
  overview: ['看一下政务的', '看镇街人口', '看大台街道的经济数据', '哪类诉求最多？'],
  population: ['常住人口有多少？', '60 岁及以上人口占比是多少？', '切换到大台街道', '看全域'],
  governance: ['哪类诉求最多？', '这里的接诉即办有哪些问题？', '切换到大台街道', '看全域'],
  economy: ['投资累计多少？', '哪些项目需要关注？', '看一下政务的', '看全域'],
}

export default function ScreenAgent({ area, locations, screen = 'overview', month }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [openLocation, setOpenLocation] = useState<string | null>(null)
  const open = openLocation === location.key

  function go(path: string) {
    setOpenLocation(null)
    void navigate(path)
  }

  async function onQuestion(question: string, previousMetricId: string | undefined, signal: AbortSignal): Promise<AssistantReply | null> {
    const intent = interpretScreenIntent(question, area.id, locations, screen)
    if (intent.kind === 'clarify') return { answer: { text: intent.message, evidence: '' } }
    if (intent.kind === 'home') {
      go('/')
      return null
    }
    if (intent.kind === 'screen') {
      go(screenPath(intent.screen, intent.areaId, screen === 'governance' ? month : undefined))
      return null
    }
    if (intent.kind === 'navigate') {
      go(intent.areaId === 'mentougou' ? '/' : '/areas/' + encodeURIComponent(intent.areaId))
      return null
    }
    if (intent.kind === 'hotline') return queryHotlineAnswer(queryClient, intent.question, intent.areaId, signal, month)

    const sameArea = intent.areaId === area.id
    const snapshot = sameArea ? area : await dashboardApi.area(intent.areaId, signal)
    signal.throwIfAborted()
    const screenAnswer = answerFromScreen(intent.question, snapshot, screen)
    if (screenAnswer) return { answer: screenAnswer, scope: { ...snapshot, updatedAt: screenSnapshotTime } }
    if (screen === 'overview' && (intent.kind === 'problems' || /分析|概况|态势/.test(intent.question))) {
      const hotline = await queryHotlineAnswer(queryClient, intent.question, snapshot.id, signal, month)
      const economy = answerFromScreen('项目进度有哪些问题', snapshot, 'economy')
      return { ...hotline, answer: { text: [hotline.answer.text, economy?.text].filter(Boolean).join(' '), evidence: '接诉即办模拟统计 · 经济发展模拟快照' } }
    }
    return { answer: answerFromSnapshot(intent.question, snapshot, sameArea ? previousMetricId : undefined), scope: snapshot }
  }

  return <>
    <button type="button" className="screen-agent-trigger" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpenLocation(location.key)}>
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10 2.5a7.5 7.5 0 0 0 7.5 7.5 7.5 7.5 0 0 0-7.5 7.5A7.5 7.5 0 0 0 2.5 10 7.5 7.5 0 0 0 10 2.5Z"
          strokeLinejoin="round" />
      </svg>
      AI 问数
    </button>
    {open && <VoiceAssistant area={area} open screen={screen} examples={examplesByScreen[screen]}
      onQuestion={onQuestion} onClose={() => setOpenLocation(null)} />}
  </>
}
