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

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 20_000 },
    mutations: { retry: false },
  },
})

function Loading() {
  return <main className="center-state" aria-busy="true"><Spin /><span>正在加载页面</span></main>
}

export function App() {
  return (
    <StyleProvider layer>
      <ConfigProvider locale={zhCN} theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#78bfff',
          colorText: '#edf6ff',
          colorBgBase: '#08142a',
          colorBgContainer: '#0e203f',
          colorBorder: '#355687',
          borderRadius: 4,
          fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
        },
      }}>
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
