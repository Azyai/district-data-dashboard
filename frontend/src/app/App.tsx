import { StyleProvider } from '@ant-design/cssinjs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Button, ConfigProvider, Modal, Spin, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import type { CockpitArea } from '../api/client'
import { Session } from '../features/session/Session'
import { asksForInsight, matchTopics, topicFor, topics, type TopicId } from '../features/topics/topicCatalog'

const Cockpit = lazy(() => import('../features/cockpit/Cockpit'))
const TwinScene = lazy(() => import('../features/cockpit/TwinScene'))
const TopicDialog = lazy(() => import('../features/topics/TopicDialog'))
const Playback = lazy(() => import('../features/playback/Playback'))
const Administration = lazy(() => import('../features/admin/Administration'))
const DashboardReviewPage = lazy(() => import('../features/designer/DashboardReleases').then(module => ({ default: module.DashboardReviewPage })))

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 20_000 },
    mutations: { retry: false },
  },
})

const districtTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#4a63de',
    colorPrimaryHover: '#596feb',
    colorPrimaryActive: '#3a4fc1',
    colorLink: '#8cddff',
    colorLinkHover: '#b1eaff',
    colorInfo: '#70dfff',
    colorSuccess: '#62d9ae',
    colorWarning: '#ffd78f',
    colorError: '#ffaaa4',
    colorText: '#eff6ff',
    colorTextSecondary: '#aabbcf',
    colorTextPlaceholder: '#859ab6',
    colorBgBase: '#080f1c',
    colorBgContainer: '#101e33',
    colorBgElevated: '#101d31',
    colorBorder: '#385475',
    colorBorderSecondary: '#253954',
    colorBgMask: 'rgba(3, 8, 17, .74)',
    controlHeight: 40,
    controlHeightLG: 46,
    borderRadius: 9,
    borderRadiusLG: 14,
    fontFamily: 'system-ui, "Microsoft YaHei UI", "PingFang SC", sans-serif',
  },
  components: {
    Button: {
      defaultBg: '#15243b',
      defaultHoverBg: '#1a304f',
      defaultHoverBorderColor: '#73b7fe',
      defaultHoverColor: '#eff6ff',
      primaryShadow: '0 5px 16px rgba(20, 32, 93, .42)',
    },
  },
}

function Loading() {
  return <main className="center-state" aria-busy="true"><Spin /><span>正在加载页面</span></main>
}

function CockpitWithTopics({ identityControl }: { identityControl: ReactNode }) {
  const [picking, setPicking] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const selected = topicFor(params.get('topic'))
  const initialQuestion: unknown = location.state?.topicQuestion

  function select(id: TopicId, question?: string) {
    setPicking(false)
    params.set('topic', id)
    void navigate({ pathname: location.pathname, search: params.toString() },
      { replace: Boolean(selected), state: { topicQuestion: question }, preventScrollReset: true })
  }

  function close() {
    params.delete('topic')
    void navigate({ pathname: location.pathname, search: params.toString() }, { replace: true, preventScrollReset: true })
  }

  async function topicQuestion(question: string, area: CockpitArea, signal: AbortSignal) {
    signal.throwIfAborted()
    const matched = matchTopics(question)
    if (!matched.length) return undefined
    const reply = (text: string) => ({ answer: { text, evidence: '' }, scope: area })
    if (matched.length > 1) return reply('请先指定一个专题，可选择人口、接诉即办或水务。')
    if (area.level !== 'district') {
      return reply(area.name + '暂无可用的' + matched[0].title + '快照。可说「打开全区' + matched[0].title + '」。')
    }
    if (area.id !== 'mentougou') return undefined
    setPicking(false)
    params.set('topic', matched[0].id)
    void navigate({ pathname: '/', search: params.toString() },
      { state: { topicQuestion: asksForInsight(question) ? question : undefined }, preventScrollReset: true })
    return null
  }

  const topicControl = <button type="button" className="cockpit-topic-link" aria-haspopup="dialog"
    onClick={() => setPicking(true)}>专题</button>

  return (
    <>
      <Cockpit identityControl={identityControl} topicControl={topicControl} onTopicQuestion={topicQuestion} />
      <Modal title="全区专题" open={picking} onCancel={() => setPicking(false)}
        centered width="min(26rem, calc(100vw - 1.5rem))" footer={null} destroyOnHidden>
        <div className="topic-picker-choices">{topics.map(topic => (
          <Button block key={topic.id} onClick={() => select(topic.id)}>{topic.title}</Button>
        ))}</div>
      </Modal>
      {selected && <Suspense fallback={null}>
        <TopicDialog topicId={selected.id} initialQuestion={typeof initialQuestion === 'string' ? initialQuestion.slice(0, 160) : ''}
          onClose={close} onSelect={select} />
      </Suspense>}
    </>
  )
}

export function App() {
  return (
    <StyleProvider layer>
      <ConfigProvider locale={zhCN} theme={districtTheme}>
        <QueryClientProvider client={client}>
          <BrowserRouter>
            <Session>
              {(session) => (
                <Suspense fallback={<Loading />}>
                  <Routes>
                    <Route element={<CockpitWithTopics identityControl={session.control} />}>
                      <Route index />
                      <Route path="/areas/:areaId" />
                    </Route>
                    <Route path="/twins/:twinId" element={<TwinScene identityControl={session.control} />} />
                    <Route path="/play/:projectId" element={
                      session.checking ? <Loading /> : session.identity
                        ? <Playback identity={session.identity} identityControl={session.control} />
                        : <Navigate to="/" replace />
                    } />
                    <Route path="/admin/*" element={<Administration session={session} />} />
                    <Route path="/review" element={<DashboardReviewPage session={session} />} />
                    <Route path="/workbench" element={<Navigate to="/" replace />} />
                    <Route path="*" element={<main className="center-state"><h1>页面不存在</h1><Link to="/" className="action-link">返回驾驶舱</Link></main>} />
                  </Routes>
                </Suspense>
              )}
            </Session>
          </BrowserRouter>
        </QueryClientProvider>
      </ConfigProvider>
    </StyleProvider>
  )
}
