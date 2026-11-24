import { StyleProvider } from '@ant-design/cssinjs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, Spin, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useMatch, useNavigate } from 'react-router'
import type { CockpitArea } from '../api/client'
import { Session } from '../features/session/Session'
import { screenPath } from '../features/screens/screenCatalog'
import { asksForInsight, matchTopics, topicFor, topicPath, topics } from '../features/topics/topicCatalog'

const Cockpit = lazy(() => import('../features/cockpit/Cockpit'))
const DisplayShell = lazy(() => import('../features/screens/DisplayShell'))
const TwinScene = lazy(() => import('../features/cockpit/TwinScene'))
const TopicPage = lazy(() => import('../features/topics/TopicPage'))
const Playback = lazy(() => import('../features/playback/Playback'))
const AreaWorkbench = lazy(() => import('../features/workbench/AreaWorkbench'))
const Administration = lazy(() => import('../features/admin/Administration'))

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

function DataWorkspace({ identityControl }: { identityControl: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const selected = topicFor(params.get('topic'))
  const area = params.get('area')
  const activeArea = useMatch('/data/areas/:areaId')?.params.areaId ?? area ?? undefined

  async function topicQuestion(question: string, area: CockpitArea, signal: AbortSignal) {
    signal.throwIfAborted()
    const matched = matchTopics(question)
    if (!matched.length) return undefined
    const reply = (text: string) => ({ answer: { text, evidence: '' }, scope: area })
    if (matched.length > 1) return reply('请先指定一个专题，可选择人口、接诉即办或水务。')
    if (matched[0].id !== 'water') {
      void navigate(topicPath(matched[0].id, area.id))
      return null
    }
    if (area.level !== 'district') {
      return reply(area.name + '暂无可用的' + matched[0].title + '快照。可说「打开全区' + matched[0].title + '」。')
    }
    if (area.id !== 'mentougou') return undefined
    void navigate(topicPath(matched[0].id),
      { state: { topicQuestion: asksForInsight(question) ? question : undefined } })
    return null
  }

  if (selected) return <Navigate to={topicPath(selected.id, activeArea)} replace state={location.state} />
  if (area && location.pathname.toLowerCase().replace(/\/$/, '') === '/workbench') {
    return <Navigate to={'/data/areas/' + encodeURIComponent(area) + location.hash} replace />
  }
  const topicControl = <nav className="workbench-topic-links" aria-label="数据专题">
    {topics.map(topic => <Link key={topic.id} to={topicPath(topic.id, activeArea)} className="workbench-action">{topic.title}</Link>)}
    <Link to={screenPath('economy', activeArea)} className="workbench-action">经济发展</Link>
  </nav>

  return <AreaWorkbench identityControl={identityControl} topicControl={topicControl} onTopicQuestion={topicQuestion} />
}

function DisplayCockpit() {
  const { search, hash } = useLocation()
  const area = useMatch('/areas/:areaId')?.params.areaId
  const params = new URLSearchParams(search)
  const linkedTopic = topicFor(params.get('topic'))
  const linkedPanel = hash === '#voice-assistant' || hash === '#area-issues'
  if (linkedTopic) return <Navigate to={topicPath(linkedTopic.id, area ?? params.get('area') ?? undefined)} replace />
  if (linkedPanel) return <Navigate to={(area ? '/data/areas/' + encodeURIComponent(area) : '/workbench') + hash} replace />
  return <Cockpit />
}

function OverviewAlias() {
  const { search } = useLocation()
  const area = useMatch('/map/:areaId')?.params.areaId ?? new URLSearchParams(search).get('area')
  return <Navigate replace to={screenPath('overview', area ?? undefined)} />
}

function TopicEntry() {
  const topic = topicFor(useMatch('/topics/:topicId')?.params.topicId ?? null)
  const location = useLocation()
  if (topic && topic.id !== 'water') {
    const params = new URLSearchParams(location.search)
    const target = topicPath(topic.id, params.get('area') ?? undefined, params.get('month'))
    return <Navigate to={target} replace state={location.state} />
  }
  return <TopicPage />
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
                    <Route element={<DisplayCockpit />}>
                      <Route index />
                      <Route path="/areas/:areaId" />
                    </Route>
                    <Route path="/twins/:twinId" element={<TwinScene />} />
                    <Route path="/map/:areaId?" element={<OverviewAlias />} />
                    <Route path="/screens/overview" element={<OverviewAlias />} />
                    <Route path="/screens/population" element={<DisplayShell screen="population" />} />
                    <Route path="/screens/governance" element={<DisplayShell screen="governance" />} />
                    <Route path="/screens/economy" element={<DisplayShell screen="economy" />} />
                    <Route path="/topics/:topicId" element={<TopicEntry />} />
                    <Route path="/play/:projectId" element={
                      session.checking ? <Loading /> : session.identity
                        ? <Playback identity={session.identity} identityControl={session.control} />
                        : <Navigate to="/" replace />
                    } />
                    <Route path="/admin/*" element={<Administration session={session} />} />
                    <Route path="/review" element={<Navigate to="/admin" replace />} />
                    <Route element={<DataWorkspace identityControl={session.control} />}>
                      <Route path="/workbench" />
                      <Route path="/data/areas/:areaId" />
                    </Route>
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
