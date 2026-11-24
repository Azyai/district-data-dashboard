import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Modal } from 'antd'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ApiError, dashboardApi } from '../../api/client'
import type { DemoPersona, Me } from '../../api/client'

const identityKey = ['identity'] as const

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
  queryClient.removeQueries({
    predicate: query => query.queryKey[0] !== 'identity' && query.queryKey[0] !== 'cockpit-area',
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
      if (data.landingPath.startsWith('/play/') || data.landingPath === '/review') navigate(data.landingPath)
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
      <Modal className="identity-dialog" title="身份核验" centered open={open} onCancel={close} footer={null}
        mask={{ closable: !busy }} keyboard={!busy} closable={!busy} width="min(30rem, calc(100vw - 2rem))">
        <div className="session-summary">
          <p className="status-mark">演示核验</p>
          {current && <p className="session-current">当前身份 <strong>{current.displayName}</strong></p>}
        </div>
        <div className="identity-options">
          <PersonaOption title="常规身份" description="继续查看当前区域" persona="district" active={active} submit={login.mutate} />
          <PersonaOption title="政务服务专项" description="进入已授权的政务服务专题" persona="service" active={active} submit={login.mutate} />
          <PersonaOption title="大屏审核员" description="审核待发布的专题版本" persona="reviewer" active={active} submit={login.mutate} />
        </div>
        {current && <Button className="session-logout" loading={logout.isPending} disabled={login.isPending}
          onClick={() => logout.mutate()}>退出核验</Button>}
        {error && <p className="inline-error" role="alert">{error.message}</p>}
      </Modal>
    </>
  )
}
