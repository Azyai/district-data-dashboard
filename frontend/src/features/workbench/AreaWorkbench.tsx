import { Link } from 'react-router'
import type { ReactNode } from 'react'
import './workbench.css'

export default function AreaWorkbench({ identityControl }: { identityControl: ReactNode }) {
  return <main className="workspace-portal" aria-label="数据工作台">
    <header><h1>数据工作台</h1>{identityControl}</header>
    <nav aria-label="工作台入口">
      <Link to="/">展开展示首页<span>路网监测</span></Link>
      <Link to="/screens/diagnosis">区域诊断<span>运行事项与指标依据</span></Link>
      <a href="/admin" target="_blank" rel="noopener noreferrer">数据管理<span>数据来源与指标目录 ↗</span></a>
    </nav>
  </main>
}
