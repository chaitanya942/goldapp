'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { fmt, fmtVal, getStyles } from './reportUtils'

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const METRICS = [
  { key:'Net Weight',      icon:'⚖', unit:'g' },
  { key:'Gross Weight',    icon:'📦', unit:'g' },
  { key:'No of Bills',     icon:'🧾', unit:''  },
  { key:'Gross Purchases', icon:'₹', unit:'₹' },
  { key:'Final Purchases', icon:'💰', unit:'₹' },
  { key:'Service Charge',  icon:'%', unit:'₹' },
]
const GROUP_OPTIONS  = ['Branch','State','Region','Cluster']
const COMP_LOGICS    = ['Same Branches','All Branches','New Only']
const PERIOD_TYPES   = ['Month','Quarter','Semi Annual','Full Year']
const FY_MONTHS      = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']
const CY_MONTHS      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const QUARTERS       = ['Q1','Q2','Q3','Q4']
const HALVES         = ['H1','H2']
const FY_MN          = {Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12,Jan:1,Feb:2,Mar:3}
const CY_MN          = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}
const CA             = '#c9a84c'   // gold  — base
const CB             = '#3a8fbf'   // blue  — compare
const DRILL_MAP      = { State:'Branch', Region:'Branch', Cluster:'Branch' }
const GROUP_BY_MAP   = { Branch:'branch', State:'state', Region:'region', Cluster:'cluster' }

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function calcDates(yr, type, val, isFY) {
  const by = Number(yr.toString().slice(0,4))
  if (type==='Full Year')
    return isFY ? {from:`${by}-04-01`,to:`${by+1}-03-31`} : {from:`${by}-01-01`,to:`${by}-12-31`}
  const months=isFY?FY_MONTHS:CY_MONTHS, mn=isFY?FY_MN:CY_MN
  let start,dur
  if      (type==='Month')       { start=val;                               dur=0 }
  else if (type==='Quarter')     { start=months[QUARTERS.indexOf(val)*3];   dur=2 }
  else                           { start=months[HALVES.indexOf(val)*6];     dur=5 }
  const m=mn[start]??mn[months[0]]
  const y=isFY&&['Jan','Feb','Mar'].includes(start)?by+1:by
  const s=new Date(y,m-1,1), e=new Date(y,m-1+dur+1,0)
  const iso=d=>d.toISOString().split('T')[0]
  return {from:iso(s),to:iso(e)}
}
function getYears(isFY) {
  const y=new Date().getFullYear()
  return [-2,-1,0,1].map(d=>isFY?`${y+d}-${String(y+d+1).slice(2)}`:`${y+d}`)
}
function getPVals(type,isFY) {
  if (type==='Month')       return isFY?FY_MONTHS:CY_MONTHS
  if (type==='Quarter')     return QUARTERS
  if (type==='Semi Annual') return HALVES
  return ['—']
}
function metricKey(m) {
  return {
    'Net Weight':'net_weight','Gross Weight':'gross_weight','No of Bills':'count',
    'Final Purchases':'final_amount','Gross Purchases':'value','Service Charge':'service_charge',
  }[m]||'net_weight'
}
function fmtM(v, metric) {
  const n=Number(v); if(isNaN(n)) return '—'
  if (metric==='No of Bills') return n.toLocaleString('en-IN')
  if (metric.includes('Purchases')||metric==='Service Charge') return fmtVal(n)
  return `${fmt(n)}g`
}
function stdDev(arr) {
  const n=arr.length; if(!n) return 0
  const mean=arr.reduce((a,b)=>a+b,0)/n
  return Math.sqrt(arr.reduce((s,x)=>s+Math.pow(x-mean,2),0)/n)
}
function pct(v) { return `${v>=0?'+':''}${v.toFixed(1)}%` }

// ─────────────────────────────────────────────
// MINI SPARKLINE (inline SVG, no deps)
// ─────────────────────────────────────────────
function MiniBar({ bPct, cPct, color }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'2px',width:'100%'}}>
      {[{p:bPct,c:CA},{p:cPct,c:CB}].map(({p,c},i)=>(
        <div key={i} style={{height:'3px',background:'rgba(255,255,255,.06)',borderRadius:'2px',overflow:'hidden'}}>
          <div style={{width:`${p}%`,height:'100%',background:c,borderRadius:'2px',transition:'width .4s ease'}}/>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────
// PERIOD PICKER
// ─────────────────────────────────────────────
function PeriodPicker({label,color,yr,setYr,type,setType,val,setVal,isFY,sel}) {
  return (
    <div style={{flex:1,minWidth:'200px',padding:'12px 14px',borderRadius:'10px',border:`1px solid ${color}30`,position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:'2px',background:`linear-gradient(90deg,${color},${color}00)`}}/>
      <div style={{fontSize:'.5rem',color,letterSpacing:'.15em',textTransform:'uppercase',marginBottom:'8px',fontWeight:600}}>{label}</div>
      <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
        <select style={sel} value={yr} onChange={e=>setYr(e.target.value)}>
          {getYears(isFY).map(y=><option key={y}>{y}</option>)}
        </select>
        <select style={sel} value={type} onChange={e=>{setType(e.target.value);setVal(getPVals(e.target.value,isFY)[0])}}>
          {PERIOD_TYPES.map(t=><option key={t}>{t}</option>)}
        </select>
        {type!=='Full Year'&&(
          <select style={sel} value={val} onChange={e=>setVal(e.target.value)}>
            {getPVals(type,isFY).map(v=><option key={v}>{v}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// COMPACT TABLE ROW
// ─────────────────────────────────────────────
function CompactRow({row,i,maxVal,metric,bLabel,cLabel,t,onDrill,isLast}) {
  const [hov,setHov]=useState(false)
  const isNew=row.growthVal===null
  const isUp =!isNew&&row.growthVal>0
  const gc   =isNew?t.blue:isUp?t.green:t.red
  const gText=isNew?'New':`${isUp?'+':''}${(row.growthVal*100).toFixed(1)}%`
  const bPct =maxVal>0?Math.min((row.bV/maxVal)*100,100):0
  const cPct =maxVal>0?Math.min((row.cV/maxVal)*100,100):0
  const absDelta=Math.abs(row.bV-row.cV)

  return (
    <div
      onMouseEnter={()=>setHov(true)}
      onMouseLeave={()=>setHov(false)}
      onClick={onDrill?()=>onDrill(row.name):undefined}
      style={{
        display:'grid',
        gridTemplateColumns:'32px 1fr 120px 120px 60px 90px',
        gap:'0',
        alignItems:'center',
        borderBottom:isLast?'none':`1px solid ${t.border}18`,
        background:hov?`${CA}08`:'transparent',
        cursor:onDrill?'pointer':'default',
        transition:'background .12s',
        minHeight:'48px',
      }}>

      {/* Rank */}
      <div style={{padding:'0 0 0 16px',fontSize:'.6rem',color:t.text4,fontVariantNumeric:'tabular-nums'}}>
        {i+1}
      </div>

      {/* Name + bars */}
      <div style={{padding:'8px 12px 8px 4px',minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'5px'}}>
          <span style={{
            fontSize:'.75rem',color:hov?CA:t.text1,fontWeight:hov?500:400,
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
            transition:'color .12s',
          }}>{row.name||'—'}</span>
          {row.isAnomaly&&<span style={{fontSize:'.46rem',color:t.orange,background:`${t.orange}20`,padding:'1px 5px',borderRadius:'3px',flexShrink:0}}>outlier</span>}
          {onDrill&&hov&&<span style={{fontSize:'.52rem',color:t.text4,flexShrink:0}}>drill →</span>}
        </div>
        <MiniBar bPct={bPct} cPct={cPct}/>
      </div>

      {/* Base */}
      <div style={{padding:'0 12px',textAlign:'right'}}>
        <div style={{fontSize:'.72rem',color:CA,fontVariantNumeric:'tabular-nums'}}>{fmtM(row.bV,metric)}</div>
        <div style={{fontSize:'.52rem',color:t.text4,marginTop:'1px'}}>{(row.bShare*100).toFixed(1)}%</div>
      </div>

      {/* Compare */}
      <div style={{padding:'0 12px',textAlign:'right'}}>
        <div style={{fontSize:'.72rem',color:CB,fontVariantNumeric:'tabular-nums'}}>{fmtM(row.cV,metric)}</div>
        <div style={{fontSize:'.52rem',color:t.text4,marginTop:'1px'}}>{(row.cShare*100).toFixed(1)}%</div>
      </div>

      {/* Delta absolute */}
      <div style={{padding:'0 8px',textAlign:'right'}}>
        <div style={{fontSize:'.64rem',color:isNew?t.blue:isUp?t.green:t.red,fontVariantNumeric:'tabular-nums'}}>
          {isNew?'—':`${isUp?'+':'-'}${fmtM(absDelta,metric)}`}
        </div>
      </div>

      {/* Growth % badge */}
      <div style={{padding:'0 16px 0 0',textAlign:'right'}}>
        <span style={{
          display:'inline-block',
          fontSize:'.65rem',fontWeight:600,
          padding:'3px 8px',borderRadius:'5px',
          background:`${gc}15`,color:gc,
          whiteSpace:'nowrap',
        }}>{gText}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// AUTO INSIGHTS
// ─────────────────────────────────────────────
function Insights({rows,totB,totC,bLabel,cLabel,metric,t}) {
  if (!rows.length) return null
  const totalDelta=totB-totC
  const totalPct  =totC>0?((totalDelta/totC)*100):null
  const sortedG   =rows.filter(r=>r.growthVal!==null).sort((a,b)=>b.growthVal-a.growthVal)
  const top       =sortedG[0], bot=sortedG[sortedG.length-1]
  const biggest   =[...rows].sort((a,b)=>b.bV-a.bV)[0]
  const anomalies =rows.filter(r=>r.isAnomaly)
  const imp=rows.filter(r=>r.growthVal!==null&&r.growthVal>0).length
  const dec=rows.filter(r=>r.growthVal!==null&&r.growthVal<0).length

  const list=[
    totalPct!==null&&{c:totalDelta>=0?t.green:t.red,
      text:`Overall ${metric.toLowerCase()} ${totalDelta>=0?'grew':'fell'} ${Math.abs(totalPct).toFixed(1)}% in ${bLabel} vs ${cLabel} — net ${totalDelta>=0?'gain':'loss'} of ${fmtM(Math.abs(totalDelta),metric)}`},
    imp>0&&top&&{c:t.green,
      text:`${imp} of ${rows.length} entities improved — best: ${top.name} at +${(top.growthVal*100).toFixed(1)}%`},
    dec>0&&bot&&{c:t.red,
      text:`${dec} entities declined — worst: ${bot.name} at ${(bot.growthVal*100).toFixed(1)}%`},
    biggest&&{c:t.gold,
      text:`${biggest.name} led base period with ${fmtM(biggest.bV,metric)} (${(biggest.bShare*100).toFixed(1)}% share)`},
    anomalies.length>0&&{c:t.orange,
      text:`${anomalies.length} statistical outlier${anomalies.length>1?'s':''}: ${anomalies.map(a=>a.name).slice(0,3).join(', ')}${anomalies.length>3?'…':''}`},
  ].filter(Boolean)

  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:'8px',marginBottom:'16px'}}>
      {list.map((ins,i)=>(
        <div key={i} style={{
          display:'flex',alignItems:'flex-start',gap:'8px',
          padding:'9px 12px',
          background:t.card,
          border:`1px solid ${t.border}`,
          borderLeft:`2px solid ${ins.c}`,
          borderRadius:'8px',
        }}>
          <span style={{fontSize:'.7rem',color:t.text2,lineHeight:1.6}}>{ins.text}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────
// DUAL TREND
// ─────────────────────────────────────────────
function DualTrend({dataA,dataB,yKey,labelA,labelB,t,height=220}) {
  const ref=useRef(null)
  const [w,setW]=useState(600)
  const [tip,setTip]=useState(null)
  useEffect(()=>{
    if(!ref.current) return
    setW(ref.current.offsetWidth)
    const ro=new ResizeObserver(()=>ref.current&&setW(ref.current.offsetWidth))
    ro.observe(ref.current); return()=>ro.disconnect()
  },[dataA,dataB])
  const vA=dataA.map(d=>Number(d[yKey])||0)
  const vB=dataB.map(d=>Number(d[yKey])||0)
  if(!vA.length&&!vB.length) return <div style={{textAlign:'center',color:t.text4,padding:'40px',fontSize:'.72rem'}}>No trend data</div>
  const all=[...vA,...vB],max=Math.max(...all,1)
  const pad={t:20,b:28,l:44,r:16}
  const cw=w-pad.l-pad.r,ch=height-pad.t-pad.b
  const ptA=i=>[pad.l+(i/Math.max(vA.length-1,1))*cw,pad.t+((max-vA[i])/max)*ch]
  const ptB=i=>[pad.l+(i/Math.max(vB.length-1,1))*cw,pad.t+((max-vB[i])/max)*ch]
  const pA=vA.map((_,i)=>ptA(i)),pB=vB.map((_,i)=>ptB(i))
  const ln=pts=>pts.map(p=>p.join(',')).join(' ')
  const onMove=e=>{
    const rect=ref.current?.getBoundingClientRect();if(!rect)return
    const mx=e.clientX-rect.left-pad.l
    const iA=Math.max(0,Math.min(vA.length-1,Math.round((mx/cw)*(vA.length-1))))
    setTip({x:pad.l+(iA/Math.max(vA.length-1,1))*cw,iA,vA:vA[iA],vB:vB[iA]||0})
  }
  return (
    <div style={{width:'100%',position:'relative'}} ref={ref} onMouseMove={onMove} onMouseLeave={()=>setTip(null)}>
      {tip&&(
        <div style={{position:'absolute',top:4,left:Math.min(tip.x+12,w-190),background:t.card2,border:`1px solid ${t.border2}`,borderRadius:'8px',padding:'10px 14px',pointerEvents:'none',zIndex:10,boxShadow:'0 8px 24px rgba(0,0,0,.6)'}}>
          <div style={{fontSize:'.54rem',color:t.text4,marginBottom:'6px'}}>Day {tip.iA+1}</div>
          {[{l:labelA,v:tip.vA,c:CA},{l:labelB,v:tip.vB,c:CB}].map(({l,v,c})=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',gap:'14px',marginBottom:'3px'}}>
              <span style={{fontSize:'.6rem',color:c}}>{l}</span>
              <span style={{fontSize:'.7rem',color:c,fontWeight:500}}>{fmt(v)}</span>
            </div>
          ))}
          <div style={{borderTop:`1px solid ${t.border}`,paddingTop:'5px',marginTop:'4px',display:'flex',justifyContent:'space-between'}}>
            <span style={{fontSize:'.58rem',color:t.text4}}>Δ</span>
            <span style={{fontSize:'.7rem',color:tip.vA-tip.vB>=0?t.green:t.red,fontWeight:600}}>{tip.vA-tip.vB>=0?'+':''}{fmt(tip.vA-tip.vB)}</span>
          </div>
        </div>
      )}
      <svg width="100%" height={height} style={{overflow:'visible',cursor:'crosshair'}}>
        {[0,.5,1].map((p,i)=>{
          const yp=pad.t+p*ch,val=max*(1-p)
          return <g key={i}>
            <line x1={pad.l} y1={yp} x2={w-pad.r} y2={yp} stroke={t.border} strokeWidth="1" opacity=".35"/>
            <text x={pad.l-5} y={yp+4} textAnchor="end" fontSize="9" fill={t.text4}>{val>=1000?`${(val/1000).toFixed(1)}k`:Math.round(val)}</text>
          </g>
        })}
        <polyline points={ln(pB)} fill="none" stroke={CB} strokeWidth="1.8" strokeDasharray="5,3" opacity=".8"/>
        <polyline points={ln(pA)} fill="none" stroke={CA} strokeWidth="2.2"/>
        {tip&&<line x1={tip.x} y1={pad.t} x2={tip.x} y2={height-pad.b} stroke={t.text3} strokeWidth="1" strokeDasharray="3,3" opacity=".4"/>}
        {pA.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={tip&&Math.abs(tip.x-x)<6?4.5:2} fill={CA} opacity=".85"/>)}
        {pB.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={tip&&Math.abs(tip.x-x)<6?3.5:1.5} fill={CB} opacity=".7"/>)}
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────
// SCATTER
// ─────────────────────────────────────────────
function Scatter({rows,t,height=360}) {
  const ref=useRef(null)
  const [w,setW]=useState(500)
  const [tip,setTip]=useState(null)
  useEffect(()=>{
    if(!ref.current)return
    setW(ref.current.offsetWidth)
    const ro=new ResizeObserver(()=>ref.current&&setW(ref.current.offsetWidth))
    ro.observe(ref.current);return()=>ro.disconnect()
  },[rows])
  const maxV=Math.max(...rows.map(r=>Math.max(r.bV,r.cV)),1)
  const pad={t:16,b:40,l:48,r:16}
  const cw=w-pad.l-pad.r,ch=height-pad.t-pad.b
  const toX=v=>pad.l+(v/maxV)*cw, toY=v=>pad.t+ch-(v/maxV)*ch
  return (
    <div style={{width:'100%',position:'relative'}} ref={ref}>
      {tip&&(
        <div style={{position:'absolute',top:Math.max(4,tip.py-80),left:Math.min(tip.px+14,w-190),background:t.card2,border:`1px solid ${t.border2}`,borderRadius:'8px',padding:'10px 14px',pointerEvents:'none',zIndex:10,boxShadow:'0 8px 24px rgba(0,0,0,.6)'}}>
          <div style={{fontSize:'.72rem',color:t.gold,fontWeight:600,marginBottom:'6px'}}>{tip.name}</div>
          {[{l:'Base',v:tip.bV,c:CA},{l:'Compare',v:tip.cV,c:CB}].map(({l,v,c})=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',gap:'12px',marginBottom:'3px'}}>
              <span style={{fontSize:'.6rem',color:c}}>{l}</span>
              <span style={{fontSize:'.7rem',color:c,fontWeight:500}}>{fmt(v)}</span>
            </div>
          ))}
          <div style={{borderTop:`1px solid ${t.border}`,paddingTop:'5px',marginTop:'4px',display:'flex',justifyContent:'space-between'}}>
            <span style={{fontSize:'.6rem',color:t.text4}}>Growth</span>
            <span style={{fontSize:'.7rem',fontWeight:600,color:tip.gv===null?t.blue:tip.gv>=0?t.green:t.red}}>
              {tip.gv===null?'New ▲':tip.gv>=0?`▲ ${(tip.gv*100).toFixed(1)}%`:`▼ ${(Math.abs(tip.gv)*100).toFixed(1)}%`}
            </span>
          </div>
        </div>
      )}
      <svg width="100%" height={height} style={{overflow:'visible'}}>
        {[0,.25,.5,.75,1].map((p,i)=>{
          const yp=pad.t+ch-p*ch,xp=pad.l+p*cw,val=p*maxV,lbl=val>=1000?`${(val/1000).toFixed(0)}k`:Math.round(val)
          return <g key={i}>
            <line x1={pad.l} y1={yp} x2={w-pad.r} y2={yp} stroke={t.border} strokeWidth="1" opacity=".25"/>
            <line x1={xp} y1={pad.t} x2={xp} y2={pad.t+ch} stroke={t.border} strokeWidth="1" opacity=".25"/>
            <text x={pad.l-5} y={yp+4} textAnchor="end" fontSize="9" fill={t.text4}>{lbl}</text>
            <text x={xp} y={pad.t+ch+14} textAnchor="middle" fontSize="9" fill={t.text4}>{lbl}</text>
          </g>
        })}
        <line x1={toX(0)} y1={toY(0)} x2={toX(maxV)} y2={toY(maxV)} stroke={t.text4} strokeWidth="1.5" strokeDasharray="5,4" opacity=".3"/>
        <text x={pad.l+cw*.72} y={pad.t+ch*.1} fontSize="10" fill={t.green} opacity=".45">Improved ▲</text>
        <text x={pad.l+cw*.04} y={pad.t+ch*.92} fontSize="10" fill={t.red} opacity=".45">Declined ▼</text>
        {rows.map((row,i)=>{
          const cx=toX(row.bV),cy=toY(row.cV)
          const c=row.growthVal===null?t.blue:row.cV>=row.bV?t.green:t.red
          const hov=tip?.name===row.name
          return (
            <g key={i} style={{cursor:'default'}}
              onMouseEnter={()=>setTip({name:row.name,bV:row.bV,cV:row.cV,gv:row.growthVal,px:cx,py:cy})}
              onMouseLeave={()=>setTip(null)}>
              <circle cx={cx} cy={cy} r={hov?7:4.5} fill={c} opacity={hov?1:.6} style={{transition:'all .15s'}}/>
              {(hov||rows.length<=15)&&<text x={cx} y={cy-9} textAnchor="middle" fontSize={hov?10:8} fill={c} opacity={hov?1:.5}>{row.name?.split('-').pop()||row.name}</text>}
            </g>
          )
        })}
      </svg>
      <div style={{display:'flex',gap:'16px',justifyContent:'center',marginTop:'10px'}}>
        {[{c:t.green,l:'Improved'},{c:t.red,l:'Declined'},{c:t.blue,l:'New in Base'}].map(({c,l})=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:'5px'}}>
            <div style={{width:'7px',height:'7px',borderRadius:'50%',background:c}}/>
            <span style={{fontSize:'.6rem',color:t.text3}}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// PARETO
// ─────────────────────────────────────────────
function Pareto({rows,t,height=220}) {
  const ref=useRef(null)
  const [w,setW]=useState(600)
  const [tip,setTip]=useState(null)
  useEffect(()=>{
    if(!ref.current)return
    setW(ref.current.offsetWidth)
    const ro=new ResizeObserver(()=>ref.current&&setW(ref.current.offsetWidth))
    ro.observe(ref.current);return()=>ro.disconnect()
  },[rows])
  const sorted=[...rows].sort((a,b)=>b.bV-a.bV)
  const total=sorted.reduce((s,r)=>s+r.bV,0)
  let cum=0
  const en=sorted.map(r=>{cum+=r.bV;return{...r,cp:cum/total}})
  const pad={t:16,b:32,l:6,r:40}
  const cw=w-pad.l-pad.r,ch=height-pad.t-pad.b
  const bw=cw/Math.max(en.length,1)
  const maxV=Math.max(...en.map(r=>r.bV),1)
  const e80=en.findIndex(r=>r.cp>=0.8)
  return (
    <div style={{width:'100%',position:'relative'}} ref={ref}>
      {tip&&(
        <div style={{position:'absolute',top:0,left:Math.min(tip.x+8,w-175),background:t.card2,border:`1px solid ${t.border2}`,borderRadius:'7px',padding:'9px 13px',pointerEvents:'none',zIndex:10,boxShadow:'0 4px 16px rgba(0,0,0,.5)'}}>
          <div style={{fontSize:'.7rem',color:t.gold,marginBottom:'4px'}}>{tip.name}</div>
          <div style={{fontSize:'.64rem',color:CA}}>Base: {fmt(tip.bV)}</div>
          <div style={{fontSize:'.64rem',color:t.blue}}>Cumulative: {(tip.cp*100).toFixed(1)}%</div>
        </div>
      )}
      <svg width="100%" height={height} style={{overflow:'visible'}}>
        <defs>
          <linearGradient id="pg3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CA} stopOpacity=".85"/>
            <stop offset="100%" stopColor={CA} stopOpacity=".25"/>
          </linearGradient>
        </defs>
        {en.map((r,i)=>{
          const bh=Math.max(2,(r.bV/maxV)*ch),x=pad.l+i*bw,y=pad.t+ch-bh
          return <rect key={i} x={x+.5} y={y} width={Math.max(bw-1,2)} height={bh} fill="url(#pg3)" opacity={tip?.name===r.name?1:.7} rx="1.5" style={{cursor:'pointer'}}
            onMouseEnter={()=>setTip({name:r.name,bV:r.bV,cp:r.cp,x:x+bw/2})}
            onMouseLeave={()=>setTip(null)}/>
        })}
        {en.length>1&&<polyline points={en.map((r,i)=>`${pad.l+(i+.5)*bw},${pad.t+ch-r.cp*ch}`).join(' ')} fill="none" stroke={CB} strokeWidth="1.8"/>}
        {en.map((r,i)=><circle key={i} cx={pad.l+(i+.5)*bw} cy={pad.t+ch-r.cp*ch} r="2" fill={CB} opacity=".85"/>)}
        {e80>=0&&<>
          <line x1={pad.l+(e80+1)*bw} y1={pad.t} x2={pad.l+(e80+1)*bw} y2={pad.t+ch} stroke={t.red} strokeWidth="1.5" strokeDasharray="4,3" opacity=".75"/>
          <text x={pad.l+(e80+1)*bw+3} y={pad.t+12} fontSize="9" fill={t.red}>80%</text>
        </>}
        {[0,.5,1].map((p,i)=><text key={i} x={w-pad.r+4} y={pad.t+ch-p*ch+4} fontSize="9" fill={CB} opacity=".55">{Math.round(p*100)}%</text>)}
      </svg>
      <div style={{fontSize:'.6rem',color:t.text3,textAlign:'center',marginTop:'4px'}}>
        {e80>=0&&<><span style={{color:t.gold}}>{e80+1}</span> entities drive 80% of total</>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
export default function ReportCompare({t}) {
  const s = getStyles(t)

  // ── state ─────────────────────────────────
  const [isFY,      setIsFY]      = useState(true)
  const [compLogic, setCompLogic] = useState('Same Branches')
  const [groupBy,   setGroupBy]   = useState('State')
  const [metric,    setMetric]    = useState('Gross Purchases')
  const [sortBy,    setSortBy]    = useState('base')
  const [sortDir,   setSortDir]   = useState('desc')
  const [innerTab,  setInnerTab]  = useState('Ranked')
  const [tMetric,   setTMetric]   = useState('net_wt')
  const [drill,     setDrill]     = useState('')
  const [drillOpts, setDrillOpts] = useState([])
  const [drillChain,setDrillChain]= useState([])

  const years=getYears(true)
  const [baseYr,  setBaseYr]  = useState(years[years.length-2])
  const [compYr,  setCompYr]  = useState(years[years.length-2])
  const [baseType,setBaseType]= useState('Month')
  const [compType,setCompType]= useState('Month')
  const [baseVal, setBaseVal] = useState('Feb')
  const [compVal, setCompVal] = useState('Jan')

  const [results, setResults] = useState(null)
  const [trendA,  setTrendA]  = useState([])
  const [trendB,  setTrendB]  = useState([])
  const [loading, setLoading] = useState(false)
  const [bLabel,  setBLabel]  = useState('')
  const [cLabel,  setCLabel]  = useState('')

  // saved configs
  const [saved,    setSaved]    = useState([])
  const [saveName, setSaveName] = useState('')
  const [showSave, setShowSave] = useState(false)

  useEffect(()=>{
    supabase.from('branches').select('state,region,cluster').then(({data})=>{
      if(!data) return
      setDrillOpts([...new Set(data.flatMap(b=>[b.state,b.region,b.cluster].filter(Boolean)))].sort())
    })
    try{setSaved(JSON.parse(localStorage.getItem('wg_cmp_cfgs')||'[]'))}catch{}
  },[])

  // ── core run ──────────────────────────────
  const runRef = useRef(null)
  const run = useCallback(async(opts={})=>{
    setLoading(true)
    const ag  = opts.groupBy !== undefined ? opts.groupBy  : groupBy
    const ad  = opts.drill   !== undefined ? opts.drill    : (drill||null)
    const am  = opts.metric  !== undefined ? opts.metric   : metric
    const acl = opts.compLogic!== undefined? opts.compLogic: compLogic

    const bDates = calcDates(baseYr,baseType,baseVal,isFY)
    const cDates = calcDates(compYr,compType,compVal,isFY)
    const grp    = GROUP_BY_MAP[ag]||'branch'
    const mkey   = metricKey(am)

    const cp = dates=>({p_from:dates.from,p_to:dates.to,p_group_by:grp,p_metric:mkey,p_drill:ad,p_txn_type:null})
    const tp = dates=>({p_from:dates.from,p_to:dates.to,p_branch:null,p_txn_type:null,p_state:null})

    const [rB,rC,tA,tB]=await Promise.all([
      supabase.rpc('get_comparison_data',cp(bDates)),
      supabase.rpc('get_comparison_data',cp(cDates)),
      supabase.rpc('get_daily_trend',tp(bDates)),
      supabase.rpc('get_daily_trend',tp(cDates)),
    ])

    const bMap=(rB.data||[]).reduce((a,r)=>{a[r.group_label]=Number(r.metric_value);return a},{})
    const cMap=(rC.data||[]).reduce((a,r)=>{a[r.group_label]=Number(r.metric_value);return a},{})
    const all=[...new Set([...Object.keys(bMap),...Object.keys(cMap)])]

    let keys=all
    if(acl==='Same Branches')  keys=all.filter(k=>bMap[k]&&cMap[k])
    if(acl==='New Only')       keys=all.filter(k=>bMap[k]&&!cMap[k])

    const totB=keys.reduce((s,k)=>s+(bMap[k]||0),0)
    const totC=keys.reduce((s,k)=>s+(cMap[k]||0),0)

    const rows=keys.map(k=>{
      const bV=bMap[k]||0,cV=cMap[k]||0
      const growthVal=cV===0?(bV>0?null:0):(bV-cV)/cV
      return{name:k,bV,cV,delta:bV-cV,growthVal,
        bShare:totB>0?bV/totB:0,cShare:totC>0?cV/totC:0}
    })

    const gs=rows.filter(r=>r.growthVal!==null).map(r=>r.growthVal)
    const gm=gs.reduce((a,b)=>a+b,0)/(gs.length||1)
    const gsd=stdDev(gs)
    const annotated=rows.map(r=>({...r,isAnomaly:r.growthVal!==null&&Math.abs(r.growthVal-gm)>2*gsd&&gsd>0}))

    const bl=baseType==='Full Year'?baseYr:`${baseVal} ${baseYr}`
    const cl=compType==='Full Year'?compYr:`${compVal} ${compYr}`
    setBLabel(bl);setCLabel(cl)

    setResults({rows:annotated,totB,totC,ag,ad,am,
      green:rows.filter(r=>r.growthVal!==null&&r.growthVal>0).length,
      red:  rows.filter(r=>r.growthVal!==null&&r.growthVal<0).length,
      newC: rows.filter(r=>r.growthVal===null).length,
    })
    setTrendA((tA.data||[]).map(d=>({...d,net_wt:Number(d.net_wt),value:Number(d.value),txn_count:Number(d.txn_count)})))
    setTrendB((tB.data||[]).map(d=>({...d,net_wt:Number(d.net_wt),value:Number(d.value),txn_count:Number(d.txn_count)})))
    setLoading(false)
    setInnerTab('Ranked')
  },[groupBy,drill,metric,compLogic,isFY,baseYr,compYr,baseType,compType,baseVal,compVal])

  // keep ref for use in handlers
  runRef.current=run

  // ── auto-run helpers ──────────────────────
  const changeMetric = m => { setMetric(m); if(results) runRef.current({metric:m}) }
  const changeGroup  = g => { setGroupBy(g); setDrillChain([]); if(results) runRef.current({groupBy:g,drill:null}) }
  const changeLogic  = l => { setCompLogic(l); if(results) runRef.current({compLogic:l}) }

  // ── drill ─────────────────────────────────
  const handleDrill = name=>{
    const next=DRILL_MAP[results?.ag]||'Branch'
    setDrillChain(prev=>[...prev,{label:name,groupBy:next}])
    run({groupBy:next,drill:name})
  }
  const resetDrill  = ()=>{setDrillChain([]);run({groupBy,drill:drill||null})}
  const drillToLvl  = idx=>{
    const chain=drillChain.slice(0,idx+1)
    setDrillChain(chain)
    const tgt=chain[chain.length-1]
    run({groupBy:tgt.groupBy,drill:tgt.label})
  }

  // ── save / load ───────────────────────────
  const saveCfg=()=>{
    if(!saveName.trim()) return
    const cfg={name:saveName,isFY,compLogic,groupBy,drill,metric,baseYr,compYr,baseType,compType,baseVal,compVal}
    const u=[...saved.filter(c=>c.name!==saveName),cfg]
    setSaved(u);try{localStorage.setItem('wg_cmp_cfgs',JSON.stringify(u))}catch{}
    setSaveName('');setShowSave(false)
  }
  const loadCfg=cfg=>{
    setIsFY(cfg.isFY);setCompLogic(cfg.compLogic);setGroupBy(cfg.groupBy)
    setDrill(cfg.drill||'');setMetric(cfg.metric)
    setBaseYr(cfg.baseYr);setCompYr(cfg.compYr)
    setBaseType(cfg.baseType);setCompType(cfg.compType)
    setBaseVal(cfg.baseVal);setCompVal(cfg.compVal)
  }
  const delCfg=name=>{const u=saved.filter(c=>c.name!==name);setSaved(u);try{localStorage.setItem('wg_cmp_cfgs',JSON.stringify(u))}catch{}}

  // ── sort ──────────────────────────────────
  const sortedRows = results ? [...results.rows].sort((a,b)=>{
    let av,bv
    if      (sortBy==='base')    {av=a.bV;bv=b.bV}
    else if (sortBy==='compare') {av=a.cV;bv=b.cV}
    else if (sortBy==='growth')  {av=a.growthVal??-Infinity;bv=b.growthVal??-Infinity}
    else                         {av=a.name||'';bv=b.name||''}
    if(typeof av==='string') return sortDir==='asc'?av.localeCompare(bv):bv.localeCompare(av)
    return sortDir==='asc'?av-bv:bv-av
  }) : []

  const sel={background:t.card2,border:`1px solid ${t.border2}`,borderRadius:'6px',padding:'6px 9px',color:t.text1,fontSize:'.72rem',cursor:'pointer',outline:'none'}
  const dm  = results?.am||metric
  const pctD= results?.totC>0?((results.totB-results.totC)/results.totC*100):null
  const canD= results?.ag&&results.ag!=='Branch'&&!!DRILL_MAP[results.ag]
  const maxV= results?Math.max(...results.rows.map(r=>Math.max(r.bV,r.cV)),1):1
  const gl  = results?.ag||groupBy

  return (
    <div>

      {/* ── SAVED CONFIGS ── */}
      {saved.length>0&&(
        <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginBottom:'10px',padding:'8px 12px',background:t.card,border:`1px solid ${t.border}`,borderRadius:'8px',alignItems:'center'}}>
          <span style={{fontSize:'.52rem',color:t.text4,letterSpacing:'.1em',textTransform:'uppercase',marginRight:'4px'}}>Saved</span>
          {saved.map(cfg=>(
            <div key={cfg.name} style={{display:'flex',alignItems:'center',gap:'3px',background:t.card2,borderRadius:'5px',padding:'2px 8px',border:`1px solid ${t.border}`}}>
              <button onClick={()=>loadCfg(cfg)} style={{background:'none',border:'none',color:t.gold,fontSize:'.65rem',cursor:'pointer',padding:0}}>{cfg.name}</button>
              <button onClick={()=>delCfg(cfg.name)} style={{background:'none',border:'none',color:t.text4,fontSize:'.58rem',cursor:'pointer',padding:'0 0 0 5px'}}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── CONTROLS ── */}
      <div style={{...s.card,padding:'16px 18px',marginBottom:'14px'}}>

        {/* Row 1 — FY/CY · Group By · Comp Logic */}
        <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap',marginBottom:'12px'}}>
          {/* FY / CY */}
          <div style={{display:'flex',gap:'2px',background:t.card2,borderRadius:'7px',padding:'2px'}}>
            {[['FY','Financial Year'],['CY','Calendar Year']].map(([k,lbl])=>(
              <button key={k}
                onClick={()=>{const fy=k==='FY';setIsFY(fy);setBaseYr(getYears(fy)[2]);setCompYr(getYears(fy)[2])}}
                style={{background:isFY===(k==='FY')?t.card:'transparent',border:`1px solid ${isFY===(k==='FY')?t.border:'transparent'}`,borderRadius:'5px',padding:'4px 12px',color:isFY===(k==='FY')?t.text1:t.text3,fontSize:'.68rem',cursor:'pointer',transition:'all .18s'}}>
                {lbl}
              </button>
            ))}
          </div>

          <div style={{width:'1px',height:'18px',background:t.border}}/>

          {/* Group By */}
          <span style={{fontSize:'.56rem',color:t.text4}}>Group</span>
          {GROUP_OPTIONS.map(g=>(
            <button key={g} onClick={()=>changeGroup(g)}
              style={{background:groupBy===g?`${CA}18`:'transparent',border:`1px solid ${groupBy===g?CA:t.border}`,borderRadius:'6px',padding:'4px 11px',color:groupBy===g?CA:t.text3,fontSize:'.68rem',cursor:'pointer',transition:'all .18s'}}>
              {g}
            </button>
          ))}

          <div style={{width:'1px',height:'18px',background:t.border}}/>

          {/* Comp Logic */}
          {COMP_LOGICS.map(c=>(
            <button key={c} onClick={()=>changeLogic(c)}
              style={{background:compLogic===c?`${CB}15`:'transparent',border:`1px solid ${compLogic===c?CB:t.border}`,borderRadius:'6px',padding:'4px 11px',color:compLogic===c?CB:t.text3,fontSize:'.68rem',cursor:'pointer',transition:'all .18s'}}>
              {c}
            </button>
          ))}

          {/* Loading indicator */}
          {loading&&<span style={{fontSize:'.62rem',color:t.gold,marginLeft:'auto'}}>● Running…</span>}
        </div>

        {/* Row 2 — Metric pills */}
        <div style={{display:'flex',gap:'5px',flexWrap:'wrap',marginBottom:'12px',alignItems:'center'}}>
          <span style={{fontSize:'.56rem',color:t.text4,width:'38px',flexShrink:0}}>Metric</span>
          {METRICS.map(m=>(
            <button key={m.key} onClick={()=>changeMetric(m.key)}
              style={{
                background:metric===m.key?`${t.gold}18`:'transparent',
                border:`1px solid ${metric===m.key?t.gold:t.border}`,
                borderRadius:'6px',padding:'5px 12px',
                color:metric===m.key?t.gold:t.text3,
                fontSize:'.68rem',cursor:'pointer',transition:'all .18s',
                display:'flex',alignItems:'center',gap:'5px',
              }}>
              <span style={{fontSize:'.7rem'}}>{m.icon}</span>{m.key}
            </button>
          ))}
        </div>

        {/* Row 3 — Period pickers */}
        <div style={{display:'flex',gap:'10px',flexWrap:'wrap',marginBottom:'12px'}}>
          <PeriodPicker label="Base Period" color={CA}
            yr={baseYr} setYr={setBaseYr} type={baseType}
            setType={v=>{setBaseType(v);setBaseVal(getPVals(v,isFY)[0])}}
            val={baseVal} setVal={setBaseVal} isFY={isFY} sel={sel}/>
          <PeriodPicker label="Compare Period" color={CB}
            yr={compYr} setYr={setCompYr} type={compType}
            setType={v=>{setCompType(v);setCompVal(getPVals(v,isFY)[0])}}
            val={compVal} setVal={setCompVal} isFY={isFY} sel={sel}/>
        </div>

        {/* Row 4 — Filter + save + run */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:'7px',flex:1,minWidth:'160px'}}>
            <span style={{fontSize:'.56rem',color:t.text4,flexShrink:0}}>Filter</span>
            <div style={{position:'relative',flex:1,maxWidth:'240px'}}>
              <input style={{...sel,width:'100%',cursor:'text',paddingRight:drill?'26px':'9px',boxSizing:'border-box'}}
                placeholder="State / Region / Cluster…"
                value={drill} onChange={e=>setDrill(e.target.value)} list="drl-opts2"/>
              {drill&&<button onClick={()=>setDrill('')} style={{position:'absolute',right:'6px',top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:t.text4,cursor:'pointer',fontSize:'.75rem',padding:0}}>✕</button>}
            </div>
            <datalist id="drl-opts2">{drillOpts.map(v=><option key={v} value={v}/>)}</datalist>
          </div>

          <div style={{display:'flex',alignItems:'center',gap:'7px'}}>
            {showSave?(
              <>
                <input value={saveName} onChange={e=>setSaveName(e.target.value)} placeholder="Name…"
                  style={{...sel,width:'120px',cursor:'text'}} onKeyDown={e=>e.key==='Enter'&&saveCfg()}/>
                <button onClick={saveCfg} style={{...sel,color:t.gold}}>Save</button>
                <button onClick={()=>setShowSave(false)} style={{background:'none',border:'none',color:t.text4,cursor:'pointer'}}>✕</button>
              </>
            ):(
              <button onClick={()=>setShowSave(true)} style={{background:'none',border:`1px solid ${t.border}`,borderRadius:'6px',padding:'6px 11px',color:t.text3,fontSize:'.66rem',cursor:'pointer'}}>⊕ Save</button>
            )}
            <button
              onClick={()=>{setDrillChain([]);run()}}
              disabled={loading}
              style={{background:`linear-gradient(135deg,${CA},#b8942a)`,border:'none',borderRadius:'8px',padding:'9px 28px',color:'#0a0a0a',fontSize:'.76rem',fontWeight:700,cursor:loading?'wait':'pointer',letterSpacing:'.05em',boxShadow:`0 3px 14px ${CA}35`,opacity:loading?.6:1,transition:'opacity .2s'}}>
              {loading?'Running…':'Run →'}
            </button>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {!results&&!loading&&(
        <div style={{textAlign:'center',padding:'60px 20px',color:t.text4}}>
          <div style={{fontSize:'2.5rem',opacity:.12,marginBottom:'10px'}}>⇄</div>
          <div style={{fontSize:'.78rem',letterSpacing:'.08em'}}>Select periods and click Run →</div>
        </div>
      )}

      {results&&(<>

        {/* ── SUMMARY BAR ── */}
        <div style={{display:'flex',gap:'0',marginBottom:'16px',borderRadius:'12px',overflow:'hidden',border:`1px solid ${t.border}`}}>

          {/* Base */}
          <div style={{flex:1,padding:'14px 18px',background:t.card,borderRight:`1px solid ${t.border}`}}>
            <div style={{fontSize:'.48rem',color:CA,letterSpacing:'.14em',textTransform:'uppercase',marginBottom:'4px'}}>{bLabel}</div>
            <div style={{fontSize:'1.1rem',color:CA,fontWeight:300}}>{fmtM(results.totB,dm)}</div>
          </div>

          {/* Compare */}
          <div style={{flex:1,padding:'14px 18px',background:t.card,borderRight:`1px solid ${t.border}`}}>
            <div style={{fontSize:'.48rem',color:CB,letterSpacing:'.14em',textTransform:'uppercase',marginBottom:'4px'}}>{cLabel}</div>
            <div style={{fontSize:'1.1rem',color:CB,fontWeight:300}}>{fmtM(results.totC,dm)}</div>
          </div>

          {/* Change */}
          <div style={{flex:1,padding:'14px 18px',background:t.card,borderRight:`1px solid ${t.border}`}}>
            <div style={{fontSize:'.48rem',color:t.text4,letterSpacing:'.14em',textTransform:'uppercase',marginBottom:'4px'}}>Change</div>
            <div style={{fontSize:'1.1rem',fontWeight:300,color:(results.totB-results.totC)>=0?t.green:t.red}}>
              {pctD!==null?`${(results.totB-results.totC)>=0?'▲ +':'▼ '}${Math.abs(pctD).toFixed(1)}%`:'—'}
            </div>
            <div style={{fontSize:'.58rem',color:t.text4,marginTop:'2px'}}>{fmtM(Math.abs(results.totB-results.totC),dm)}</div>
          </div>

          {/* Improved */}
          <div style={{flex:1,padding:'14px 18px',background:t.card,borderRight:`1px solid ${t.border}`}}>
            <div style={{fontSize:'.48rem',color:t.text4,letterSpacing:'.14em',textTransform:'uppercase',marginBottom:'4px'}}>Improved</div>
            <div style={{fontSize:'1.1rem',color:t.green,fontWeight:300}}>{results.green}</div>
            <div style={{fontSize:'.58rem',color:t.text4,marginTop:'2px'}}>of {results.rows.length}</div>
          </div>

          {/* Declined */}
          <div style={{flex:1,padding:'14px 18px',background:t.card}}>
            <div style={{fontSize:'.48rem',color:t.text4,letterSpacing:'.14em',textTransform:'uppercase',marginBottom:'4px'}}>Declined</div>
            <div style={{fontSize:'1.1rem',color:t.red,fontWeight:300}}>{results.red}</div>
            <div style={{fontSize:'.58rem',color:t.text4,marginTop:'2px'}}>of {results.rows.length}</div>
          </div>
        </div>

        {/* Split bar */}
        <div style={{height:'4px',borderRadius:'2px',overflow:'hidden',display:'flex',gap:'1px',marginBottom:'16px'}}>
          <div style={{flex:results.totB||1,background:CA,transition:'flex .5s'}}/>
          <div style={{flex:results.totC||1,background:CB,transition:'flex .5s'}}/>
        </div>

        {/* Drill breadcrumb */}
        {drillChain.length>0&&(
          <div style={{display:'flex',alignItems:'center',gap:'5px',marginBottom:'10px',padding:'7px 12px',background:t.card,border:`1px solid ${t.border}`,borderRadius:'7px',flexWrap:'wrap'}}>
            <button onClick={resetDrill} style={{background:'none',border:`1px solid ${t.border}`,borderRadius:'4px',padding:'2px 7px',color:t.text3,fontSize:'.6rem',cursor:'pointer'}}>All</button>
            {drillChain.map((d,i)=>(
              <span key={i} style={{display:'flex',alignItems:'center',gap:'3px'}}>
                <span style={{color:t.text4,fontSize:'.58rem'}}>›</span>
                <button onClick={()=>drillToLvl(i)} style={{background:'none',border:'none',padding:0,color:i===drillChain.length-1?t.gold:t.text3,fontSize:'.63rem',cursor:'pointer',fontWeight:i===drillChain.length-1?500:400}}>{d.label}</button>
              </span>
            ))}
            <button onClick={resetDrill} style={{marginLeft:'auto',background:'none',border:`1px solid ${t.border}`,borderRadius:'4px',padding:'2px 8px',color:t.text3,fontSize:'.6rem',cursor:'pointer'}}>✕ Reset</button>
          </div>
        )}

        <Insights rows={results.rows} totB={results.totB} totC={results.totC} bLabel={bLabel} cLabel={cLabel} metric={dm} t={t}/>

        {/* ── INNER TABS ── */}
        <div style={{display:'flex',gap:'4px',marginBottom:'12px'}}>
          {['Ranked','Trends','Scatter','Pareto'].map(tab=>(
            <button key={tab} onClick={()=>setInnerTab(tab)}
              style={{background:innerTab===tab?`${t.gold}14`:'transparent',border:`1px solid ${innerTab===tab?t.gold:t.border}`,borderRadius:'6px',padding:'6px 16px',color:innerTab===tab?t.gold:t.text3,fontSize:'.7rem',cursor:'pointer',transition:'all .18s'}}>
              {tab}
            </button>
          ))}
        </div>

        {/* ── RANKED TABLE ── */}
        {innerTab==='Ranked'&&(
          <div style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:'10px',overflow:'hidden'}}>

            {/* Header */}
            <div style={{display:'grid',gridTemplateColumns:'32px 1fr 120px 120px 60px 90px',alignItems:'center',padding:'8px 0',background:t.card2,borderBottom:`1px solid ${t.border}`}}>
              <div style={{paddingLeft:'16px',fontSize:'.5rem',color:t.text4}}>#</div>
              <div style={{padding:'0 12px 0 4px',fontSize:'.5rem',color:t.text4,letterSpacing:'.1em',textTransform:'uppercase'}}>{gl}</div>
              <div style={{padding:'0 12px',textAlign:'right',fontSize:'.5rem',color:CA,letterSpacing:'.08em',textTransform:'uppercase'}}>Base</div>
              <div style={{padding:'0 12px',textAlign:'right',fontSize:'.5rem',color:CB,letterSpacing:'.08em',textTransform:'uppercase'}}>Compare</div>
              <div style={{padding:'0 8px',textAlign:'right',fontSize:'.5rem',color:t.text4,letterSpacing:'.08em',textTransform:'uppercase'}}>Δ</div>
              <div style={{padding:'0 16px 0 0',textAlign:'right',fontSize:'.5rem',color:t.text4,letterSpacing:'.08em',textTransform:'uppercase'}}>Growth</div>
            </div>

            {/* Sort bar */}
            <div style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 14px',background:`${t.card2}80`,borderBottom:`1px solid ${t.border}14`}}>
              <span style={{fontSize:'.5rem',color:t.text4,letterSpacing:'.08em',textTransform:'uppercase',marginRight:'3px'}}>Sort</span>
              {[['base','Base'],['compare','Cmp'],['growth','Growth'],['name','Name']].map(([k,l])=>(
                <button key={k} onClick={()=>{if(sortBy===k)setSortDir(d=>d==='desc'?'asc':'desc');else{setSortBy(k);setSortDir('desc')}}}
                  style={{background:sortBy===k?`${CA}14`:'transparent',border:`1px solid ${sortBy===k?CA:t.border}`,borderRadius:'5px',padding:'3px 9px',color:sortBy===k?CA:t.text3,fontSize:'.6rem',cursor:'pointer',display:'flex',alignItems:'center',gap:'3px'}}>
                  {l}{sortBy===k&&<span style={{fontSize:'.5rem'}}>{sortDir==='desc'?'↓':'↑'}</span>}
                </button>
              ))}
              <span style={{marginLeft:'auto',fontSize:'.58rem',color:t.text4}}>{sortedRows.length} {gl.toLowerCase()}s</span>
            </div>

            {canD&&(
              <div style={{padding:'5px 14px',background:`${CA}06`,borderBottom:`1px solid ${t.border}12`,fontSize:'.58rem',color:t.text4}}>
                💡 Click any row to drill into branches
              </div>
            )}

            {/* Rows */}
            {sortedRows.map((row,i)=>(
              <CompactRow key={row.name} row={row} i={i} maxVal={maxV} metric={dm}
                bLabel={bLabel} cLabel={cLabel} t={t}
                onDrill={canD?handleDrill:null}
                isLast={i===sortedRows.length-1}/>
            ))}

            {sortedRows.length===0&&(
              <div style={{textAlign:'center',color:t.text4,padding:'40px',fontSize:'.75rem'}}>No data for this combination</div>
            )}

            {/* Footer */}
            {sortedRows.length>0&&(
              <div style={{display:'grid',gridTemplateColumns:'32px 1fr 120px 120px 60px 90px',alignItems:'center',padding:'10px 0',background:t.card2,borderTop:`1px solid ${t.border}`}}>
                <div/>
                <div style={{padding:'0 12px 0 4px',fontSize:'.62rem',color:t.text3,fontWeight:500}}>Total ({sortedRows.length})</div>
                <div style={{padding:'0 12px',textAlign:'right',fontSize:'.68rem',color:CA,fontWeight:500}}>{fmtM(results.totB,dm)}</div>
                <div style={{padding:'0 12px',textAlign:'right',fontSize:'.68rem',color:CB,fontWeight:500}}>{fmtM(results.totC,dm)}</div>
                <div style={{padding:'0 8px',textAlign:'right',fontSize:'.64rem',color:(results.totB-results.totC)>=0?t.green:t.red,fontWeight:500}}>
                  {pctD!==null?`${(results.totB-results.totC)>=0?'+':'-'}${fmtM(Math.abs(results.totB-results.totC),dm)}`:'—'}
                </div>
                <div style={{padding:'0 16px 0 0',textAlign:'right'}}>
                  <span style={{fontSize:'.65rem',fontWeight:600,color:(results.totB-results.totC)>=0?t.green:t.red}}>
                    {pctD!==null?`${(results.totB-results.totC)>=0?'▲ +':'▼ '}${Math.abs(pctD).toFixed(1)}%`:'—'}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TRENDS ── */}
        {innerTab==='Trends'&&(
          <div style={s.card}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px',flexWrap:'wrap',gap:'8px'}}>
              <div style={{fontSize:'.56rem',color:t.text3,letterSpacing:'.14em',textTransform:'uppercase'}}>Daily Trend Overlay</div>
              <div style={{display:'flex',gap:'4px'}}>
                {[['Net Wt','net_wt'],['Value','value'],['Txns','txn_count']].map(([l,v])=>(
                  <button key={v} onClick={()=>setTMetric(v)}
                    style={{background:tMetric===v?`${t.gold}14`:'transparent',border:`1px solid ${tMetric===v?t.gold:t.border}`,borderRadius:'6px',padding:'4px 10px',color:tMetric===v?t.gold:t.text3,fontSize:'.66rem',cursor:'pointer'}}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:'flex',gap:'18px',marginBottom:'12px'}}>
              {[{c:CA,l:bLabel,dash:false},{c:CB,l:cLabel,dash:true}].map(({c,l,dash})=>(
                <div key={l} style={{display:'flex',alignItems:'center',gap:'6px'}}>
                  {dash?<svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={c} strokeWidth="2" strokeDasharray="4,3"/></svg>
                      :<div style={{width:'18px',height:'2px',background:c,borderRadius:'1px'}}/>}
                  <span style={{fontSize:'.63rem',color:c}}>{l}</span>
                </div>
              ))}
            </div>
            <DualTrend dataA={trendA} dataB={trendB} yKey={tMetric} labelA={bLabel} labelB={cLabel} t={t} height={240}/>
          </div>
        )}

        {/* ── SCATTER ── */}
        {innerTab==='Scatter'&&(
          <div style={s.card}>
            <div style={{fontSize:'.56rem',color:t.text3,letterSpacing:'.14em',textTransform:'uppercase',marginBottom:'4px'}}>Performance Scatter</div>
            <div style={{fontSize:'.66rem',color:t.text4,marginBottom:'16px'}}>Each dot = one {gl.toLowerCase()}. Above diagonal = improved, below = declined.</div>
            <Scatter rows={results.rows} t={t} height={380}/>
          </div>
        )}

        {/* ── PARETO ── */}
        {innerTab==='Pareto'&&(
          <div style={s.card}>
            <div style={{fontSize:'.56rem',color:t.text3,letterSpacing:'.14em',textTransform:'uppercase',marginBottom:'4px'}}>Contribution Analysis</div>
            {(()=>{
              const sr=[...results.rows].sort((a,b)=>b.bV-a.bV)
              const tot=sr.reduce((s,r)=>s+r.bV,0)
              let c=0,n=0; for(const r of sr){c+=r.bV;n++;if(c/tot>=0.8)break}
              return <div style={{fontSize:'.66rem',color:t.text4,marginBottom:'14px'}}>
                <span style={{color:t.gold,fontWeight:500}}>{n}</span> of <span style={{color:t.gold,fontWeight:500}}>{sr.length}</span> {gl.toLowerCase()}s contribute 80% of base total
              </div>
            })()}
            <Pareto rows={results.rows} t={t} height={240}/>
          </div>
        )}

      </>)}
    </div>
  )
}