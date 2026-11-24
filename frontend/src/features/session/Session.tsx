import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Modal } from 'antd'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useMatch, useNavigate } from 'react-router'
import { ApiError, dashboardApi } from '../../api/client'
import type { DemoPersona, Me } from '../../api/client'
import { workspaceForPath } from '../../api/workspace'
import { topicFor } from '../topics/topicCatalog'
import { screens } from '../screens/screenCatalog'

function PersonaOption({ title, description, persona, active, submit }: {
  title: string
  description: string
  persona: DemoPersona
  active?: DemoPersona
  submit: (persona: DemoPersona) => void
}) {
  return (
    <Button className="persona" data-persona={persona} disabled={active !== undefined && active !== persona}
      loading={active === persona} onClick={() => submit(persona)} block>
      <span className="persona-glyph" aria-hidden="true" />
      <span className="persona-text"><strong>{title}</strong><small>{description}</small></span>
    </Button>
  )
}

function clearPrivateQueries(queryClient: ReturnType<typeof useQueryClient>) {
  const publicQueries = ['identity', 'cockpit-area', 'cockpit-locations', 'public-topic-manifest', 'public-topic-snapshot']
  queryClient.removeQueries({
    predicate: query => !publicQueries.includes(String(query.queryKey[0])),
  })
}

export type SessionState = {
  identity: Me | null
  checking: boolean
  control: ReactNode
  busy: boolean
  error: Error | null
  signInForAdministration: () => void
  signOut: () => void
}

export function Session({ children }: { children: (state: SessionState) => ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const topic = topicFor(useMatch('/topics/:topicId')?.params.topicId ?? null)
  const areaData = Boolean(useMatch('/data/areas/:areaId'))
  const screenId = useMatch('/screens/:screenId')?.params.screenId
  const displayScreen = screens.find(item => item.id === screenId)
  const workspace = workspaceForPath(pathname)
  const management = workspace === 'management'
  const identityKey = ['identity', workspace] as const
  const [open, setOpen] = useState(false)
  const identity = useQuery({
    queryKey: identityKey,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      try {
        return await dashboardApi.identity(signal)
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
  })
  const login = useMutation({
    mutationFn: dashboardApi.signIn,
    onSuccess: async (data) => {
      await queryClient.cancelQueries({ queryKey: identityKey })
      clearPrivateQueries(queryClient)
      queryClient.setQueryData(identityKey, data)
      setOpen(false)
      if (!management && data.landingPath.startsWith('/play/')) void navigate(data.landingPath)
    },
  })
  const logout = useMutation({
    mutationFn: dashboardApi.signOut,
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: identityKey })
      clearPrivateQueries(queryClient)
      queryClient.setQueryData(identityKey, null)
      setOpen(false)
      if (pathname.startsWith('/play/')) navigate('/', { replace: true })
    },
  })

  useEffect(() => {
    if (identity.isSuccess && identity.data === null) clearPrivateQueries(queryClient)
  }, [identity.isSuccess, identity.data, queryClient])

  useEffect(() => {
    if (displayScreen) document.title = displayScreen.title + ' · 门头沟区治理与发展大屏'
    else if (topic) document.title = topic.title + ' · 门头沟区'
    else if (management) document.title = '门头沟区数据管理'
    else if (areaData) document.title = '门头沟区区域数据'
    else document.title = pathname.toLowerCase().replace(/\/$/, '') === '/workbench'
      ? '门头沟区数据工作台' : '门头沟区数字驾驶舱'
  }, [management, pathname, topic, areaData, displayScreen])

  const current = identity.data ?? null
  const busy = login.isPending || logout.isPending
  const active = login.isPending ? login.variables : undefined
  const error = login.error ?? logout.error
  const control = <Button className="identity-button" data-verified={!!current} aria-haspopup="dialog" onClick={() => setOpen(true)}>
    {current ? current.displayName : '身份核验'}
  </Button>

  function close() {
    if (!busy) {
      login.reset()
      logout.reset()
      setOpen(false)
    }
  }

  return (
    <>
      {children({
        identity: current,
        checking: identity.isPending,
        control,
        busy,
        error: error ?? identity.error,
        signInForAdministration: () => login.mutate('data-admin'),
        signOut: () => logout.mutate(),
      })}
      {!management && <Modal className="identity-dialog" title="身份核验" centered open={open} onCancel={close} footer={null}
        mask={{ closable: !busy }} keyboard={!busy} closable={!busy} width="min(30rem, calc(100vw - 2rem))">
        <div className="session-summary">
          <p className="status-mark">演示核验</p>
          {current && <p className="session-current">当前身份 <strong>{current.displayName}</strong></p>}
        </div>
        <div className="identity-options">
          <PersonaOption title="常规身份" description="继续查看当前区域" persona="district" active={active} submit={login.mutate} />
          <PersonaOption title="政务服务专项" description="进入已授权的政务服务专题" persona="service" active={active} submit={login.mutate} />
        </div>
        {current && <Button className="session-logout" loading={logout.isPending} disabled={login.isPending}
          onClick={() => logout.mutate()}>退出核验</Button>}
        {error && <p className="inline-error" role="alert">{error.message}</p>}
      </Modal>}
    </>
  )
}
