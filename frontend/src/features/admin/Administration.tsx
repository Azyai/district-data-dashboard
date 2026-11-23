import { Button, Spin } from 'antd'
import { Link, Navigate, NavLink, Route, Routes } from 'react-router'
import type { SessionState } from '../session/Session'
import { MetricCatalog } from './MetricCatalog'
import { SourceDirectory } from './SourceDirectory'
import './admin.css'

export default function Administration({ session }: { session: SessionState }) {
  const authorized = session.identity?.roles.includes('DATA_ADMIN')

  return (
    <div className="admin-app">
      <header className="admin-top">
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>数据管理</span>
        </div>
        <div className="admin-top-actions">
          <Link className="admin-text-link" to="/">返回驾驶舱</Link>
          {authorized && <Button onClick={session.signOut} loading={session.busy}>退出管理</Button>}
        </div>
      </header>
      {session.checking ? (
        <main className="admin-state" aria-busy="true"><Spin /><p>正在检查管理会话</p></main>
      ) : authorized ? (
        <>
          <nav className="admin-nav" aria-label="数据管理功能">
            <NavLink to="/admin/sources">数据来源</NavLink>
            <NavLink to="/admin/metrics">指标目录</NavLink>
            <span>演示环境</span>
          </nav>
          <main className="admin-content">
            {session.error && <p className="admin-error" role="alert">{session.error.message}</p>}
            <Routes>
              <Route index element={<Navigate to="sources" replace />} />
              <Route path="sources" element={<SourceDirectory />} />
              <Route path="metrics" element={<MetricCatalog />} />
              <Route path="*" element={<Navigate to="/admin/sources" replace />} />
            </Routes>
          </main>
        </>
      ) : (
        <main className="admin-state">
          <h1>数据管理员核验</h1>
          <p>{session.identity ? '当前身份未获得数据管理权限。' : '核验后可配置数据来源、同步并发布指标。'}</p>
          <Button type="primary" loading={session.busy} onClick={session.signInForAdministration}>使用演示数据管理员</Button>
          {session.error && <p className="admin-error" role="alert">{session.error.message}</p>}
        </main>
      )}
    </div>
  )
}
