import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import type { CockpitArea, CockpitDirectory } from '../../api/client'
import { modelAreaName } from './mapBoundaries'
import { number, profileSeed, reservoirRate, roadColors, roadLabel, waterKind } from './monitoringData'
import type { MonitorPage, MonitoringCatalog, MonitoringSnapshot, Road } from './monitoringData'

type Props = {
  page: MonitorPage; area: CockpitArea; directory?: CockpitDirectory; catalog: MonitoringCatalog; data: MonitoringSnapshot
  selected: string; hour: number; status: string
  onSelect: (name: string) => void; onArea: (id: string) => void; onHour: (hour: number) => void; onStatus: (status: string) => void
}
const color = (value: string) => ({ '--ink': value }) as CSSProperties

function Panel({ title, hint, children, className = '' }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return <section className={'monitor-panel ' + className}><header><h2>{title}</h2>{hint && <small>{hint}</small>}</header>{children}</section>
}

function Trend({ values, bars = false, second, labels }: { values: number[]; bars?: boolean; second?: number[]; labels: string[] }) {
  const id = useId()
  const max = Math.max(1, ...values, ...(second ?? [])) * 1.12
  const coords = (series: number[]) => series.map((v,i) => [4 + 192*i/Math.max(1,series.length-1), 58 - 52*v/max])
  const line = coords(values).map(p => p.join(',')).join(' ')
  return <div className="monitor-trend" role="img" aria-label={(bars ? '柱状图' : '折线图') + '，' + labels[0] + '至' + labels.at(-1)}>
    <svg viewBox="0 0 200 64" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
        <stop stopColor="#74e5ff" stopOpacity=".94"/><stop offset="1" stopColor="#228cd0" stopOpacity=".12"/>
      </linearGradient></defs>
      {[12,34,57].map(y => <path key={y} d={'M0 ' + y + 'H200'} stroke="#a8c4da" strokeOpacity=".22" strokeDasharray="2 4"/>)}
      {bars ? values.map((v,i)=><rect key={i} x={200*i/values.length+1} y={58-52*v/max} width={Math.max(1,200/values.length-2)} height={52*v/max} fill={'url(#'+id+')'}/>)
        : <polygon points={'4,58 '+line+' 196,58'} fill={'url(#'+id+')'} opacity=".37"/>}
      {!bars && <polyline points={line} stroke="#65dafc" fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke"/>}
      {second && <polyline points={coords(second).map(p=>p.join(',')).join(' ')} stroke="#ffc383" fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>}
    </svg><div>{labels.map((label,i)=><small key={i}>{label}</small>)}</div>
  </div>
}

function Breakdown({ rows, center, caption }: { rows: {name:string;value:number;color:string}[]; center:string;caption:string }) {
  const total = rows.reduce((n,row)=>n+row.value,0)
  let start = 0
  const segments = rows.filter(row=>row.value>0).map(row=>{
    const end = start + 100*row.value/(total || 1)
    const gradient = row.color+' '+start+'% '+end+'%'
    start=end
    return gradient
  })
  return <div className="monitor-breakdown"><div className="monitor-ring" style={{background: segments.length ? 'conic-gradient('+segments.join(',')+')':'#314956'}}>
    <span><b>{center}</b><small>{caption}</small></span></div>
    <ul>{rows.map(row=><li key={row.name} style={color(row.color)}><i/>{row.name}<b>{total ? Math.round(100*row.value/total) : 0}%</b></li>)}</ul></div>
}

function Radar({name, district}: {name:string;district:boolean}) {
  const axes = ['巡查','响应','办结','覆盖','联动','回访']
  const seed = profileSeed(name)
  const values = district ? [.96,.9,.94,.91,.87,.84] : axes.map((_,i)=>.72+((seed >>> (i*3))%26)/100)
  const point = (i:number,r:number) => [90+Math.sin(i*Math.PI/3)*r,58-Math.cos(i*Math.PI/3)*r]
  const polygon = (r:number) => axes.map((_,i)=>point(i,r).join(',')).join(' ')
  return <svg className="monitor-radar" viewBox="0 0 180 120" role="img" aria-label="治理综合评价雷达图">
    {[12,24,36].map(r=><polygon key={r} points={polygon(r)} fill="#21445a" fillOpacity=".15" stroke="#758fa5" strokeOpacity=".4"/>)}
    {axes.map((name,i)=><g key={name}><line x1="90" y1="58" x2={point(i,36)[0]} y2={point(i,36)[1]} stroke="#a2c6d9" strokeOpacity=".25"/>
      <text x={point(i,49)[0]} y={point(i,49)[1]+3} textAnchor="middle" fill="#d0dfe8" fontSize="9">{name}</text></g>)}
    <polygon points={values.map((v,i)=>point(i,v*36).join(',')).join(' ')} stroke="#56d9ee" fill="#26b5de" fillOpacity=".42"/>
  </svg>
}

function RoadPanels(p: Props) {
  const [query,setQuery] = useState('')
  const [start,setStart] = useState(0)
  const [corridorGroup,setCorridorGroup] = useState(0)
  const { roads } = p.data
  const matches = roads.filter(row => (!p.status || row.status === p.status) && (!query || (roadLabel(row)+row.town).includes(query.trim())))
  const pageSize = 18
  const offset = Math.min(start, Math.max(0, Math.floor((matches.length-1)/pageSize)*pageSize))
  const selected = roads.find(road=>road.name===p.selected)
  const corridors = roads.filter(road=>p.catalog.corridors.includes(road.name))
  const examples = corridors.length ? corridors : roads.filter(road=>!road.name.startsWith('未命名')).slice(0,8)
  const groups = Math.ceil(examples.length / 3)
  const activeGroup = Math.min(corridorGroup, Math.max(0,groups-1))
  const busiest = [...roads].sort((a,b)=>b.flow-a.flow).slice(0,5)
  const parts = Object.entries(roadColors).map(([name,color])=>({name,color,value: roads.reduce((n,r)=>n+(r.status===name ? r.km : 0),0)}))
  const totalFlow = roads.reduce((sum,road)=>sum+road.flow,0)
  const distance = parts.reduce((n,row)=>n+row.value,0)
  const choose = (road: Road) => p.onSelect(road.name === p.selected ? '' : road.name)
  return <>
    <aside className="monitor-wing monitor-left" aria-label="道路监测目录">
      <Panel title="道路监测" hint={number(roads.length)+' 条'} className="road-browser">
        <label className="road-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="搜索道路名称" aria-label="搜索道路名称" value={query} onChange={e=>{setQuery(e.target.value); setStart(0)}}/></label>
        <div className="road-filters">{['',...Object.keys(roadColors)].map(status=><button key={status} type="button" aria-pressed={status===p.status} onClick={()=>{p.onStatus(status);setStart(0)}}>{status || '全部'}</button>)}</div>
        <div className="monitor-column-title"><span>路段 / 镇街</span><span>速度 km/h</span></div>
        <div className="road-results">{matches.slice(offset,offset+pageSize).map(road=><button key={road.name} type="button" className="road-row" aria-pressed={road.name===p.selected} onClick={()=>choose(road)}>
          <i style={color(roadColors[road.status])}/><span>{roadLabel(road)}<small>{road.town} · {road.klass}</small></span><b>{road.speed}</b></button>)}
          {!matches.length && <p className="monitor-empty">当前范围没有匹配道路</p>}</div>
        {matches.length>pageSize && <div className="monitor-pagination"><button disabled={!offset} onClick={()=>setStart(offset-pageSize)} aria-label="上一页道路">‹</button>
          <span>{Math.floor(offset/pageSize)+1} / {Math.ceil(matches.length/pageSize)}</span><button disabled={offset+pageSize>=matches.length} onClick={()=>setStart(offset+pageSize)} aria-label="下一页道路">›</button></div>}
      </Panel>
    </aside>
    <aside className="monitor-wing monitor-right" aria-label="路网运行分析">
      <Panel title={selected ? roadLabel(selected) : '路网运行结构'} hint={selected?.town ?? '按里程'}>
        {selected ? <><div className="road-focus"><b>{selected.congestion.toFixed(2)}</b><span style={{color:roadColors[selected.status]}}>{selected.status}</span></div>
          <dl className="monitor-facts">{[['平均车速',selected.speed+' km/h'],['道路里程',selected.km+' km'],['车道数',selected.lanes+' 条'],['监测流量',number(selected.flow)+' 辆/时']].map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
          <button className="monitor-back" onClick={()=>p.onSelect('')}>返回路网概况</button></>
          : <Breakdown rows={parts} center={distance ? Math.round(100*parts[0].value/distance)+'%' : '—'} caption="畅通里程"/>}
      </Panel>
      <Panel title={selected ? '路段日内拥堵' : '全日流量趋势'} hint={selected ? '指数' : '辆/时'}>
        <Trend values={selected ? p.catalog.hourly.map(f=>selected.congestion*f/p.data.factor) : p.catalog.flow.map(f=>Math.round(totalFlow/p.data.factor*f))} bars={!selected} labels={['00','06','12','18','23']}/>
      </Panel>
      <Panel title="重点路段" hint="小时流量"><div className="corridor-list">{busiest.map((road,i)=><button key={road.name} onClick={()=>choose(road)} aria-pressed={road.name===p.selected}>
        <small>{String(i+1).padStart(2,'0')}</small><span>{roadLabel(road)}</span><b style={{color:roadColors[road.status]}}>{number(road.flow)} <em>辆</em></b></button>)}
        {!busiest.length && <p className="monitor-empty">暂无重点道路</p>}</div></Panel>
    </aside>
    <div className="monitor-dock"><div className="monitor-playback"><label htmlFor="road-hour">时段回看 <b>{String(p.hour).padStart(2,'0')}:00</b></label>
      <input id="road-hour" aria-label="路况演示时段" type="range" min="0" max="23" value={p.hour} onChange={e=>p.onHour(Number(e.target.value))}/>
      <button onClick={()=>p.onHour(p.catalog.baseHour)} disabled={p.hour===p.catalog.baseHour}>复位</button></div>
      {!!groups && <div className="monitor-corridors" role="group" aria-label="骨干路运行">
        {groups>1 && <button className="monitor-arrow" aria-label="上一组骨干路" onClick={()=>setCorridorGroup((activeGroup+groups-1)%groups)}>‹</button>}
        {examples.slice(activeGroup*3,activeGroup*3+3).map(road=><button className="monitor-road-tile" key={road.name} aria-pressed={p.selected===road.name} onClick={()=>choose(road)}>
          <span>{roadLabel(road)}</span><b style={{color:roadColors[road.status]}}>{road.speed} <em>km/h</em></b><small>{road.status}</small></button>)}
        {groups>1 && <button className="monitor-arrow" aria-label="下一组骨干路" onClick={()=>setCorridorGroup((activeGroup+1)%groups)}>›</button>}
      </div>}
    </div>
  </>
}

function GridPanels(p:Props) {
  const { towns, villages } = p.data
  const district = p.area.level==='district'
  const factor = district ? 1 : villages.length/p.catalog.villages.length
  const scores = ['巡查走访','事件上报','矛盾调解','隐患整改']
  const details = district ? towns : villages
  const focus = villages.find(row=>row.name===p.selected)
  return <>
    <aside className="monitor-wing monitor-left" aria-label="网格运行">
      <Panel title="本月事件趋势" hint="件"><div className="monitor-keys"><i/>上报<i/>办结</div>
        <Trend values={[48,62,55,74,66,88,79,96].map(v=>Math.round(v*factor))} second={[28,36,33,44,41,52,48,61].map(v=>Math.round(v*factor))} labels={['02日','10日','18日','30日']}/></Panel>
      <Panel title="本周治理台账"><table className="monitor-table"><thead><tr><th>指标</th><th>本周</th><th>月累计</th></tr></thead>
        <tbody>{scores.map((label,i)=><tr key={label}><td>{label}</td><td>{number([1286,214,86,47][i]*factor)}</td><td>{number([4520,802,291,156][i]*factor)}</td></tr>)}</tbody></table></Panel>
      <Panel title={district?'镇街明细':'村居明细'} hint={details.length+' 个'} className="monitor-grow"><div className="monitor-grid-list">{details.map(row=>{
        const loc=p.directory?.find(d=>modelAreaName(d)===row.name && (district?d.level==='town':d.parentId===(p.area.breadcrumbs[1]?.id)))
        return <button key={row.name} aria-pressed={p.selected===row.name} disabled={loc?.id===p.area.id} onClick={()=>loc?p.onArea(loc.id):p.onSelect(row.name===p.selected?'':row.name)}><span>{row.name}</span><b>{number(row.micro)} <em>微网格</em></b></button>
      })}</div></Panel>
    </aside>
    <aside className="monitor-wing monitor-right" aria-label="治理综合评价">
      {focus && <Panel title={focus.name} hint={focus.town}><dl className="monitor-facts"><div><dt>微网格</dt><dd>{number(focus.micro)} 个</dd></div>
        <div><dt>楼栋覆盖</dt><dd>{number(focus.buildings)} 栋</dd></div></dl><button className="monitor-back" onClick={()=>p.onSelect('')}>返回镇街概况</button></Panel>}
      <Panel title="治理综合评价" hint="雷达图"><Radar name={p.area.name} district={district}/></Panel>
      <Panel title="事项办理进度"><div className="monitor-bars">{['隐患整改','矛盾调解','重点走访','环境整治'].map((label,i)=>{
        const pct=district?[88,65,39,51][i]:50+(profileSeed(p.area.name+label)%45)
        return <div key={label}><span>{label}<b>{pct}%</b></span><i><em style={{width:pct+'%'}}/></i></div>
      })}</div></Panel>
      <Panel title="月度办结" hint="件"><Trend bars values={[86,74,91,68,102,97,110,88,121,96,108,116].map(v=>Math.round(v*factor))} labels={['1月','4月','8月','12月']}/></Panel>
    </aside>
  </>
}

function WaterPanels(p:Props) {
  const { waters }=p.data
  const water=waters.find(row=>row.name===p.selected)
  const reservoirs=waters.filter(row=>waterKind(row.name)==='水库').sort((a,b)=>reservoirRate(b.name)-reservoirRate(a.name))
  const [kind,setKind]=useState('水位')
  const scale=waters.length/p.catalog.waters.length
  const supply=[{name:'地表水',value:62,color:'#52d2fa'},{name:'地下水',value:21,color:'#9981f4'},{name:'再生水',value:11,color:'#f2c562'},{name:'外调水',value:6,color:'#fa9462'}]
  const zoneSupply: [string,number][] = [['城子街道',128],['大峪街道',116],['永定镇',142],['龙泉镇',97],['军庄镇',64],['雁翅镇',41]]
  const zones = zoneSupply.filter(([name])=>p.area.level==='district' || p.area.level==='town' && name===p.area.name)
  const groups=['水库','河流','湖泊','沟道'].map((name,i)=>({name,value:waters.filter(w=>waterKind(w.name)===name).length,color:['#50d9eb','#699af4','#b095fa','#64d7a7'][i]}))
  const sites=[...reservoirs,...waters.filter(w=>waterKind(w.name)!=='水库')]
  const risk=[{name:'正常',value:71,color:'#39e2a4'},{name:'关注',value:18,color:'#f1ce69'},{name:'预警',value:8,color:'#ff924e'},{name:'告警',value:3,color:'#ff5371'}]
  return <>
    <aside className="monitor-wing monitor-left" aria-label="水务运行">
      <Panel title="当日入库流量" hint="m³/s"><Trend values={[42,48,55,63,71,86,92,88,76,69,61,54].map(v=>v*scale)} labels={['00:00','08:00','16:00','22:00']}/></Panel>
      <Panel title="水域类型" hint="按监测点"><Breakdown rows={groups} center={String(waters.length)} caption="监测水域"/></Panel>
      <Panel title="供水构成" hint="演示占比">{waters.length ? <Breakdown rows={supply} center="100%" caption="供水"/> : <p className="monitor-empty">暂无供水资料</p>}</Panel>
    </aside>
    <aside className="monitor-wing monitor-right" aria-label="水域监测分析">
      {water && <Panel title={water.name} hint={water.town}><div className="road-filters">{['水位','流量','告警'].map(label=><button key={label} aria-pressed={kind===label} onClick={()=>setKind(label)}>{label}</button>)}</div>
        <Trend values={Array.from({length:7},(_,i)=>{const seed=(profileSeed(water.name)+i*97+2020+i)%1000/1000; return kind==='水位'?6+seed*20+Math.sin(i)*1.4:kind==='流量'?10+seed*86+i*1.6:Math.round(seed*5)})} labels={['2020','2023','2026']}/>
        <button className="monitor-back" onClick={()=>p.onSelect('')}>返回水域概况</button></Panel>}
      {!water && waters.length>0 && <Panel title="水域风险占比" hint="演示分布"><Breakdown rows={risk} center="71%" caption="正常"/></Panel>}
      <Panel title="水域监测点" hint={waters.length+' 处'} className="monitor-grow"><div className="water-sites">{sites.map(site=><button key={site.name} aria-pressed={site.name===p.selected} onClick={()=>p.onSelect(site.name===p.selected?'':site.name)}>
        <span>{site.name}<small>{site.town} · {waterKind(site.name)}</small></span>{waterKind(site.name)==='水库'?<b>{reservoirRate(site.name)}%<small>蓄水率</small></b>:<em>定位 ↗</em>}</button>)}
        {!sites.length&&<p className="monitor-empty">当前区域暂无监测点</p>}</div></Panel>
      {!water && !!zones.length && <Panel title="分区供水量" hint="万 m³"><div className="monitor-bars">{zones.map(([name,value])=>
        <div key={name}><span>{name}<b>{value}</b></span><i><em style={{width:100*value/142+'%'}}/></i></div>)}</div></Panel>}
    </aside>
  </>
}

export default function MonitoringPanels(props: Props) {
  const [mobile,setMobile]=useState<'left'|'right'|undefined>()
  return <div className="monitor-overlay" data-panel={mobile}>
    <div className="monitor-kpis" aria-label="当前区域指标">{props.data.kpis.map(item=><div key={item.label}><span>{item.label}</span>
      <b>{item.value}</b><small>{item.unit||'指数'}</small></div>)}
      {!props.data.kpis.length && <p>{props.area.name}暂无该专题监测记录</p>}</div>
    {props.page==='roads' ? <RoadPanels {...props}/> : props.page==='grid' ? <GridPanels {...props}/> : <WaterPanels {...props}/>}
    <div className="monitor-mobile-tools"><button aria-pressed={mobile==='left'} onClick={()=>setMobile(mobile==='left'?undefined:'left')}>监测概况</button>
      <button aria-pressed={mobile==='right'} onClick={()=>setMobile(mobile==='right'?undefined:'right')}>运行分析</button></div>
    <small className="monitor-demo">演示数据</small>
  </div>
}
