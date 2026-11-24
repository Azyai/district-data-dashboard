import { StyleProvider } from '@ant-design/cssinjs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, Spin, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useMatch } from 'react-router'
import { Session } from '../features/session/Session'
import { screenPath } from '../features/screens/screenCatalog'
import { topicFor } from '../features/topics/topicCatalog'
import VoiceOrb from '../features/assistant/VoiceOrb'

const Cockpit = lazy(() => import('../features/cockpit/Cockpit'))
const DisplayShell = lazy(() => import('../features/screens/DisplayShell'))
const TwinScene = lazy(() => import('../features/cockpit/TwinScene'))
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
  const params = new URLSearchParams(location.search)
  const legacyArea = useMatch('/data/areas/:areaId')?.params.areaId
  const areaId = legacyArea ?? (params.get('area') || 'mentougou')
  const topic = topicFor(params.get('topic'))
  if (topic) return <Navigate replace to={screenPath(topic.screen, areaId, params.get('month'))} />
  if (legacyArea || params.has('area') || location.hash === '#area-issues') {
    return <Navigate replace to={screenPath('diagnosis', areaId)} />
  }
  return <AreaWorkbench identityControl={identityControl} />
}

function DisplayCockpit() {
  const { search, hash } = useLocation()
  const area = useMatch('/areas/:areaId')?.params.areaId
  const params = new URLSearchParams(search)
  const linkedTopic = topicFor(params.get('topic'))
  if (linkedTopic) return <Navigate to={screenPath(linkedTopic.screen, area ?? params.get('area') ?? undefined, params.get('month'))} replace />
  if (hash === '#area-issues') return <Navigate to={screenPath('diagnosis', area ?? params.get('area') ?? undefined)} replace />
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
  if (topic) {
    const params = new URLSearchParams(location.search)
    const target = screenPath(topic.screen, params.get('area') ?? undefined, params.get('month'))
    return <Navigate to={target} replace state={location.state} />
  }
  return <main className="center-state"><h1>专题不存在</h1><Link to="/">返回首页</Link></main>
}

function DisplayVoice() {
  const { pathname } = useLocation()
  return /^\/admin(?:\/|$)/i.test(pathname) ? null : <VoiceOrb />
}

export function App() {
  return (
    <StyleProvider layer>
      <ConfigProvider locale={zhCN} theme={districtTheme}>
        <QueryClientProvider client={client}>
          <BrowserRouter>
            <DisplayVoice />
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
                    <Route path="/screens/roads" element={<OverviewAlias />} />
                    <Route path="/screens/grid" element={<Cockpit page="grid" />} />
                    <Route path="/screens/waters" element={<Cockpit page="waters" />} />
                    <Route path="/screens/diagnosis" element={<DisplayShell screen="diagnosis" />} />
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
