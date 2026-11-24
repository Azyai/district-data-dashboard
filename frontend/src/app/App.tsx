import { StyleProvider } from '@ant-design/cssinjs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, Spin, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router'
import { Session } from '../features/session/Session'

const Cockpit = lazy(() => import('../features/cockpit/Cockpit'))
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
                    <Route element={<Cockpit identityControl={session.control} />}>
                      <Route index />
                      <Route path="/areas/:areaId" />
                    </Route>
                    <Route path="/play/:projectId" element={
                      session.checking ? <Loading /> : session.identity
                        ? <Playback identity={session.identity} identityControl={session.control} />
                        : <Navigate to="/" replace />
                    } />
                    <Route path="/admin/*" element={<Administration session={session} />} />
                    <Route path="/review" element={session.checking ? <Loading /> : session.identity?.roles.includes('DASHBOARD_REVIEWER')
                      ? <DashboardReviewPage identityControl={session.control} /> : <Navigate to="/" replace />} />
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
