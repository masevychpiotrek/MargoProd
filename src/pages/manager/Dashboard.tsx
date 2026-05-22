import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useClock } from '@/hooks/useClock'
import { efficiencyColor, efficiencyBg, cn } from '@/lib/utils'
import type { HourlyReport, Shift, Machine } from '@/types/database'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend } from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

const TARGET     = 2100
const REAL_TARGET = 2500

const MONTHS_PL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień']
const VIEW_MODES = ['Dziś','Tydzień','Miesiąc','Rok']

const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#8892AA', font: { size: 11 }, boxWidth: 12 } } },
  scales: {
    y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4A5568' } },
    x: { grid: { display: false }, ticks: { color: '#4A5568', maxTicksLimit: 12 } }
  }
}

function minsToHHMM(m: number) {
  if (!m) return '00:00'
  return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
}

function TrendBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null
  const up = pct >= 0
  return (
    <span className={cn('text-xs font-bold ml-1', up ? 'text-green-400' : 'text-red-400')}>
      {up ? '↑' : '↓'}{Math.abs(pct)}%
    </span>
  )
}

interface MachineStatus {
  machine: Machine
  activeShift: (Shift & { operator_1?: { full_name: string }, operator_2?: { full_name: string } }) | null
  todayReports: (HourlyReport & { ready_min?: number; alarm_min?: number })[]
}

type ExtReport = HourlyReport & { ready_min?: number; alarm_min?: number; order_qty?: number }

export default function ManagerDashboard() {
  const { time, date, dateISO, hour } = useClock()
  const [machines,     setMachines]     = useState<MachineStatus[]>([])
  const [allReports,   setAllReports]   = useState<ExtReport[]>([])
  const [prevReports,  setPrevReports]  = useState<ExtReport[]>([])
  const [activeOrders, setActiveOrders] = useState<{ id: string; order_number: string; target_qty: number; produced_qty: number; machine_id: string }[]>([])
  const [monthPlan,    setMonthPlan]    = useState<{ assortment_id: string; planned_qty: number }[]>([])
  const [monthProduced,setMonthProduced]= useState(0)
  const [monthPlanned, setMonthPlanned] = useState(0)
  const [viewMode,     setViewMode]     = useState('Miesiąc')
  const [selYear,      setSelYear]      = useState(new Date().getFullYear())
  const [selMonth,     setSelMonth]     = useState(new Date().getMonth() + 1)
  const [loading,      setLoading]      = useState(true)
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Oblicz fromStr i toStr na podstawie viewMode
  const getDateRange = () => {
    const now = new Date()
    if (viewMode === 'Dziś') {
      return { fromStr: dateISO, toStr: dateISO }
    } else if (viewMode === 'Tydzień') {
      const mon = new Date(now)
      mon.setDate(now.getDate() - now.getDay() + 1)
      return { fromStr: mon.toISOString().split('T')[0], toStr: dateISO }
    } else if (viewMode === 'Miesiąc') {
      return {
        fromStr: `${selYear}-${String(selMonth).padStart(2,'0')}-01`,
        toStr:   new Date(selYear, selMonth, 0).toISOString().split('T')[0]
      }
    } else { // Rok
      return { fromStr: `${selYear}-01-01`, toStr: `${selYear}-12-31` }
    }
  }
  const { fromStr: rangeFrom, toStr: rangeTo } = getDateRange()

  useEffect(() => {
    load()
    channel.current?.unsubscribe()
    channel.current = supabase.channel('mgr-v3')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .subscribe()
    return () => { channel.current?.unsubscribe() }
  }, [dateISO, viewMode, selYear, selMonth])

  const load = async () => {
    setLoading(true)
    const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - days + 1)
    const fromStr  = fromDate.toISOString().split('T')[0]
    // Previous period for trend
    const prevFrom = new Date(); prevFrom.setDate(prevFrom.getDate() - days * 2 + 1)
    const prevTo   = new Date(); prevTo.setDate(prevTo.getDate() - days)
    const prevFromStr = prevFrom.toISOString().split('T')[0]
    const prevToStr   = prevTo.toISOString().split('T')[0]
    // Month plan
    const now = new Date()

    const [mRes, sRes, rRes, pRes, ordRes, planRes, planRep] = await Promise.all([
      supabase.from('machines').select('*').eq('is_active', true).order('code'),
      supabase.from('shifts').select('*, operator_1:profiles!operator_1_id(full_name), operator_2:profiles!operator_2_id(full_name)').eq('shift_date', dateISO).is('ended_at', null),
      supabase.from('hourly_reports').select('*').gte('report_date', fromStr).lte('report_date', rangeTo).is('deleted_at', null).order('report_date').order('hour_start'),
      supabase.from('hourly_reports').select('good_count,reject_count,runtime_min,ready_min,alarm_min,downtime_min,failure_min').gte('report_date', prevFromStr).lte('report_date', prevToStr).is('deleted_at', null),
      supabase.from('production_orders').select('id,order_number,target_qty,produced_qty,machine_id').in('status', ['active','paused']),
      supabase.from('monthly_plans').select('assortment_id,planned_qty').eq('year', now.getFullYear()).eq('month', now.getMonth() + 1),
      supabase.from('hourly_reports').select('good_count').gte('report_date', `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`).is('deleted_at', null)
    ])

    const mList = (mRes.data ?? []) as Machine[]
    const sList = sRes.data ?? []
    const rList = (rRes.data ?? []) as ExtReport[]
    const pList = (pRes.data ?? []) as ExtReport[]
    setAllReports(rList)
    setPrevReports(pList)
    setActiveOrders((ordRes.data ?? []) as { id: string; order_number: string; target_qty: number; produced_qty: number; machine_id: string }[])
    setMonthPlan(planRes.data ?? [])
    setMonthPlanned((planRes.data ?? []).reduce((s: number, p: { planned_qty: number }) => s + p.planned_qty, 0))
    setMonthProduced((planRep.data ?? []).reduce((s: number, r: { good_count: number }) => s + r.good_count, 0))

    setMachines(mList.map(m => ({
      machine: m,
      activeShift: (sList.find((s: Shift) => s.machine_id === m.id) ?? null) as MachineStatus['activeShift'],
      todayReports: rList.filter(r => r.machine_id === m.id && r.report_date === dateISO)
    })))
    setLoading(false)
  }

  const todayReports  = allReports.filter(r => r.report_date === dateISO)
  const rangeReports  = allReports

  // ── KPI ───────────────────────────────────────────────────────────────────
  const totalGood     = rangeReports.reduce((s,r) => s + r.good_count, 0)
  const totalReject   = rangeReports.reduce((s,r) => s + r.reject_count, 0)
  const totalRuntime  = rangeReports.reduce((s,r) => s + r.runtime_min, 0)
  const totalDowntime = rangeReports.reduce((s,r) => s + r.downtime_min + r.failure_min, 0)
  const totalAlarm    = rangeReports.reduce((s,r) => s + (r.alarm_min ?? 0), 0)
  const totalReady    = rangeReports.reduce((s,r) => s + (r.ready_min ?? 0), 0)
  const totalTime     = totalRuntime + totalDowntime + totalAlarm + totalReady

  const avgEff        = rangeReports.length > 0 ? Math.round(rangeReports.reduce((s,r) => s + Number(r.efficiency_pct), 0) / rangeReports.length) : 0
  const oee           = rangeReports.length > 0 ? Math.round(totalGood / (rangeReports.length * TARGET) * 100) : 0
  const rejectPct     = (totalGood + totalReject) > 0 ? Math.round(totalReject / (totalGood + totalReject) * 100) : 0
  const fpy           = (totalGood + totalReject) > 0 ? Math.round(totalGood / (totalGood + totalReject) * 100) : 0
  const availability  = totalTime > 0 ? Math.round(totalRuntime / totalTime * 100) : 0
  const taktSec       = totalGood > 0 && totalRuntime > 0 ? Math.round(totalRuntime * 60 / totalGood * 10) / 10 : 0
  const machineRate   = totalRuntime > 0 ? Math.round(totalGood / totalRuntime * 60) : 0

  // Efektywność czasowa
  const totalOrderQty   = rangeReports.reduce((s,r) => s + ((r as { order_qty?: number }).order_qty ?? 0), 0)
  const planMins        = totalOrderQty > 0 ? Math.round(totalOrderQty / REAL_TARGET * 60) : 0
  const faktMins        = totalRuntime + totalDowntime + totalAlarm
  const timeEfficiency  = planMins > 0 && faktMins > 0 ? Math.round(planMins / faktMins * 100) : null

  // Plan miesięczny
  const monthPlanPct    = monthPlanned > 0 ? Math.round(monthProduced / monthPlanned * 100) : null

  // Trend vs poprzedni okres
  const prevGood        = prevReports.reduce((s,r) => s + r.good_count, 0)
  const prevReject      = prevReports.reduce((s,r) => s + r.reject_count, 0)
  const prevRuntime     = prevReports.reduce((s,r) => s + r.runtime_min, 0)
  const prevOee         = prevReports.length > 0 ? Math.round(prevGood / (prevReports.length * TARGET) * 100) : 0
  const trendGood       = prevGood > 0 ? Math.round((totalGood - prevGood) / prevGood * 100) : null
  const trendOee        = prevOee > 0 ? Math.round((oee - prevOee)) : null
  const prevRejectPct   = (prevGood + prevReject) > 0 ? Math.round(prevReject / (prevGood + prevReject) * 100) : 0
  const trendReject     = prevRejectPct > 0 ? Math.round(rejectPct - prevRejectPct) : null

  // Najlepsza godzina (today)
  const bestReport      = todayReports.length > 0
    ? todayReports.reduce((b,r) => Number(r.efficiency_pct) > Number(b.efficiency_pct) ? r : b, todayReports[0])
    : null

  // ETA aktywnych zleceń
  const last3h = todayReports.slice(-3)
  const avg3hRate = last3h.length > 0
    ? last3h.reduce((s,r) => s + r.good_count, 0) / last3h.length
    : 0

  // OEE per zmiana (today)
  const shiftOee = ['I','II','III'].map(st => {
    const shiftHours: Record<string, number[]> = { I: [6,7,8,9,10,11,12,13], II: [14,15,16,17,18,19,20,21], III: [22,23,0,1,2,3,4,5] }
    const sr = todayReports.filter(r => shiftHours[st].includes(r.hour_start))
    const g  = sr.reduce((s,r) => s + r.good_count, 0)
    return { shift: st, oee: sr.length > 0 ? Math.round(g / (sr.length * TARGET) * 100) : 0, count: sr.length }
  })

  // Charts
  const dateMap: Record<string, { good: number; reject: number; runtime: number }> = {}
  rangeReports.forEach(r => {
    if (!dateMap[r.report_date]) dateMap[r.report_date] = { good: 0, reject: 0, runtime: 0 }
    dateMap[r.report_date].good    += r.good_count
    dateMap[r.report_date].reject  += r.reject_count
    dateMap[r.report_date].runtime += r.runtime_min
  })
  const sortedDates  = Object.keys(dateMap).sort()
  const trendLabels  = sortedDates.map(d => days <= 10 ? d.slice(5) : d.slice(5))
  const trendGoodData= sortedDates.map(d => dateMap[d].good)
  const trendOeeData = sortedDates.map(d => {
    const dayReports = rangeReports.filter(r => r.report_date === d)
    return dayReports.length > 0 ? Math.round(dayReports.reduce((s,r) => s + r.good_count, 0) / (dayReports.length * TARGET) * 100) : 0
  })

  // Hourly chart (today)
  const activeHours    = Array.from({length:24},(_,h)=>h).filter(h => machines.some(ms => ms.todayReports.some(r => r.hour_start === h)))
  const hourLabels     = activeHours.map(h => `${String(h).padStart(2,'0')}:00`)
  const hourlyDatasets = machines.map((ms,i) => ({
    label: ms.machine.name,
    data: activeHours.map(h => ms.todayReports.find(r => r.hour_start === h)?.good_count ?? 0),
    backgroundColor: i === 0 ? 'rgba(59,130,246,0.75)' : 'rgba(6,182,212,0.75)',
    borderRadius: 4
  }))

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Produkcja</h1>
          <p className="text-navy-400 mt-1">{date} · <span className="font-mono text-white">{time}</span></p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400 font-bold">LIVE</span>
          </div>
          {/* Tryb widoku */}
          <div className="flex gap-1">
            {VIEW_MODES.map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className={cn('btn text-xs py-1.5 px-3', viewMode === m ? 'btn-primary' : 'btn-secondary')}>
                {m}
              </button>
            ))}
          </div>
          {/* Selektor miesiąca/roku */}
          {(viewMode === 'Miesiąc' || viewMode === 'Rok') && (
            <div className="flex items-center gap-1">
              <button onClick={() => {
                if (viewMode === 'Miesiąc') {
                  if (selMonth === 1) { setSelMonth(12); setSelYear(y => y-1) }
                  else setSelMonth(m => m-1)
                } else setSelYear(y => y-1)
              }} className="btn-secondary text-xs py-1.5 px-2">‹</button>
              <span className="text-xs font-bold text-white px-2 min-w-[120px] text-center">
                {viewMode === 'Miesiąc' ? `${MONTHS_PL[selMonth-1]} ${selYear}` : selYear}
              </span>
              <button onClick={() => {
                if (viewMode === 'Miesiąc') {
                  if (selMonth === 12) { setSelMonth(1); setSelYear(y => y+1) }
                  else setSelMonth(m => m+1)
                } else setSelYear(y => y+1)
              }} className="btn-secondary text-xs py-1.5 px-2">›</button>
            </div>
          )}
          <button onClick={load} className="btn-secondary text-xs py-1.5 px-3">↻</button>
        </div>
      </div>

      {/* KPI row 1 — produkcja */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">Produkcja łącznie</div>
          <div className="kpi-value text-brand">
            {loading ? '...' : totalGood.toLocaleString('pl-PL')}
            <TrendBadge pct={trendGood} />
          </div>
          <div className="kpi-sub">szt · {viewMode === 'Miesiąc' ? `${MONTHS_PL[selMonth-1]} ${selYear}` : viewMode.toLowerCase()}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">OEE</div>
          <div className={cn('kpi-value', efficiencyColor(oee))}>
            {loading ? '...' : oee + '%'}
            {trendOee !== null && <span className={cn('text-xs font-bold ml-1', trendOee >= 0 ? 'text-green-400' : 'text-red-400')}>{trendOee >= 0 ? '↑' : '↓'}{Math.abs(trendOee)}pp</span>}
          </div>
          <div className="kpi-sub">Overall Equipment Effectiveness</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Śr. efektywność</div>
          <div className={cn('kpi-value', efficiencyColor(avgEff))}>{loading ? '...' : avgEff > 0 ? avgEff + '%' : '—'}</div>
          <div className="kpi-sub">vs target {TARGET} szt/h</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Realizacja planu</div>
          <div className={cn('kpi-value', monthPlanPct === null ? 'text-navy-400' : monthPlanPct >= 100 ? 'text-green-400' : monthPlanPct >= 75 ? 'text-amber-400' : 'text-red-400')}>
            {monthPlanPct !== null ? monthPlanPct + '%' : '—'}
          </div>
          <div className="kpi-sub">{monthProduced.toLocaleString('pl-PL')} / {monthPlanned.toLocaleString('pl-PL')} szt · miesiąc</div>
        </div>
      </div>

      {/* KPI row 2 — jakość i czas */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">FPY</div>
          <div className={cn('kpi-value text-xl', efficiencyColor(fpy))}>{loading ? '...' : fpy > 0 ? fpy + '%' : '—'}</div>
          <div className="kpi-sub">First Pass Yield</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">% odrzutu</div>
          <div className={cn('kpi-value text-xl', rejectPct > 5 ? 'text-red-400' : rejectPct > 2 ? 'text-amber-400' : 'text-green-400')}>
            {loading ? '...' : rejectPct + '%'}
            {trendReject !== null && <span className={cn('text-xs font-bold ml-1', trendReject <= 0 ? 'text-green-400' : 'text-red-400')}>{trendReject <= 0 ? '↓' : '↑'}{Math.abs(trendReject)}pp</span>}
          </div>
          <div className="kpi-sub">{totalReject.toLocaleString('pl-PL')} szt odrzut</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Dostępność</div>
          <div className={cn('kpi-value text-xl', availability > 90 ? 'text-green-400' : availability > 75 ? 'text-amber-400' : 'text-red-400')}>
            {loading ? '...' : availability > 0 ? availability + '%' : '—'}
          </div>
          <div className="kpi-sub">czas pracy {minsToHHMM(totalRuntime)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Takt produkcji</div>
          <div className="kpi-value text-xl text-cyan-400">{loading ? '...' : taktSec > 0 ? taktSec + 's' : '—'}</div>
          <div className="kpi-sub">{machineRate > 0 ? machineRate.toLocaleString('pl-PL') + ' szt/h aktyw.' : 'szt/szt'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Ef. czasowa zleceń</div>
          <div className={cn('kpi-value text-xl', timeEfficiency === null ? 'text-navy-400' : timeEfficiency >= 90 ? 'text-green-400' : timeEfficiency >= 75 ? 'text-amber-400' : 'text-red-400')}>
            {loading ? '...' : timeEfficiency !== null ? timeEfficiency + '%' : '—'}
          </div>
          <div className="kpi-sub">{timeEfficiency !== null ? `plan ${minsToHHMM(planMins)} vs fakt ${minsToHHMM(faktMins)}` : 'brak zleceń z planem'}</div>
        </div>
      </div>

      {/* KPI row 3 — przestoje + OEE per zmiana */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">Czas przestojów</div>
          <div className={cn('kpi-value text-xl', totalDowntime > 120 ? 'text-red-400' : totalDowntime > 60 ? 'text-amber-400' : 'text-green-400')}>
            {minsToHHMM(totalDowntime)}
          </div>
          <div className="kpi-sub">postoje + awarie</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Czas alarmów</div>
          <div className={cn('kpi-value text-xl', totalAlarm > 120 ? 'text-red-400' : totalAlarm > 60 ? 'text-amber-400' : 'text-green-400')}>
            {minsToHHMM(totalAlarm)}
          </div>
          <div className="kpi-sub">łącznie w alarmie</div>
        </div>
        {shiftOee.map(s => (
          <div key={s.shift} className="kpi-card">
            <div className="kpi-label">OEE Zmiana {s.shift}</div>
            <div className={cn('kpi-value text-xl', s.count === 0 ? 'text-navy-500' : efficiencyColor(s.oee))}>
              {s.count === 0 ? '—' : s.oee + '%'}
            </div>
            <div className="kpi-sub">{s.count} raportów dziś</div>
          </div>
        ))}
      </div>

      {/* ETA zleceń + najlepsza godzina */}
      {(activeOrders.length > 0 || bestReport) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ETA aktywnych zleceń */}
          {activeOrders.length > 0 && (
            <div className="card">
              <div className="card-header"><div><div className="card-title">ETA zakończenia zleceń</div><div className="card-sub">Na podstawie śr. wydajności ostatnich 3h</div></div></div>
              <div className="space-y-3">
                {activeOrders.map(o => {
                  const remaining = Math.max(0, o.target_qty - o.produced_qty)
                  const machine   = machines.find(m => m.machine.id === o.machine_id)
                  const mRate     = avg3hRate > 0 ? avg3hRate : TARGET
                  const etaHours  = mRate > 0 ? remaining / mRate : null
                  const etaDate   = etaHours !== null ? new Date(Date.now() + etaHours * 3600000) : null
                  const pct       = o.target_qty > 0 ? Math.round(o.produced_qty / o.target_qty * 100) : 0
                  return (
                    <div key={o.id} className="bg-navy-900 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="font-bold font-mono text-white">{o.order_number}</div>
                          <div className="text-xs text-navy-400">{machine?.machine.name ?? '—'}</div>
                        </div>
                        <div className="text-right">
                          {etaDate ? (
                            <>
                              <div className="text-sm font-bold text-cyan-400">
                                ETA: {etaDate.toLocaleDateString('pl-PL')} {etaDate.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                              <div className="text-xs text-navy-400">
                                ≈ {etaHours! < 1 ? Math.round(etaHours! * 60) + ' min' : Math.round(etaHours! * 10) / 10 + ' h'}
                              </div>
                            </>
                          ) : <div className="text-xs text-navy-500">Brak danych</div>}
                        </div>
                      </div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-navy-400">{o.produced_qty.toLocaleString('pl-PL')} / {o.target_qty.toLocaleString('pl-PL')} szt</span>
                        <span className={cn('font-bold', pct >= 100 ? 'text-green-400' : pct >= 75 ? 'text-amber-400' : 'text-brand')}>{pct}%</span>
                      </div>
                      <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-green-500' : 'bg-brand')} style={{ width: `${Math.min(pct,100)}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Najlepsza godzina + statystyki dnia */}
          <div className="card">
            <div className="card-header"><div><div className="card-title">Podsumowanie dnia</div><div className="card-sub">Dzisiejsze statystyki</div></div></div>
            <div className="space-y-3">
              {bestReport && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                  <div className="text-xs text-green-400 font-bold mb-1">🏆 Najlepsza godzina</div>
                  <div className="flex justify-between">
                    <span className="font-mono font-bold text-white">{bestReport.hour_block}</span>
                    <span className={cn('font-bold', efficiencyColor(Number(bestReport.efficiency_pct)))}>{bestReport.efficiency_pct}%</span>
                  </div>
                  <div className="text-xs text-navy-400">{bestReport.good_count.toLocaleString('pl-PL')} szt</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  { l: 'Raporty dziś', v: todayReports.length + ' wpisów', c: 'text-white' },
                  { l: 'Aktywne maszyny', v: machines.filter(m => m.activeShift).length + ' / ' + machines.length, c: 'text-brand' },
                  { l: 'Łączny czas pracy', v: minsToHHMM(todayReports.reduce((s,r) => s + r.runtime_min, 0)), c: 'text-green-400' },
                  { l: 'Łączny czas alarm', v: minsToHHMM(todayReports.reduce((s,r) => s + (r.alarm_min ?? 0), 0)), c: 'text-red-400' },
                ].map(k => (
                  <div key={k.l} className="bg-navy-900 rounded-xl p-2.5">
                    <div className="text-xs text-navy-500">{k.l}</div>
                    <div className={cn('font-bold font-mono text-sm', k.c)}>{k.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Machine cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {machines.map(ms => {
          const g   = ms.todayReports.reduce((s,r) => s + r.good_count, 0)
          const rej = ms.todayReports.reduce((s,r) => s + r.reject_count, 0)
          const rt  = ms.todayReports.reduce((s,r) => s + r.runtime_min, 0)
          const al  = ms.todayReports.reduce((s,r) => s + (r.alarm_min ?? 0), 0)
          const eff = ms.todayReports.length > 0 ? Math.round(ms.todayReports.reduce((s,r) => s + Number(r.efficiency_pct), 0) / ms.todayReports.length) : 0
          const rPct = (g + rej) > 0 ? Math.round(rej / (g + rej) * 100) : 0
          const mFpy = (g + rej) > 0 ? Math.round(g / (g + rej) * 100) : 0
          const reported = ms.todayReports.some(r => r.hour_start === hour)
          const online   = !!ms.activeShift
          const ops = [ms.activeShift?.operator_1?.full_name, ms.activeShift?.operator_2?.full_name].filter(Boolean).join(' / ')

          return (
            <div key={ms.machine.id} className={cn('card border-2', online ? 'border-brand/20' : 'border-navy-700')}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={cn('w-3 h-3 rounded-full', online ? 'bg-green-400 animate-pulse' : 'bg-navy-600')} />
                  <div>
                    <div className="font-bold text-white text-lg">{ms.machine.name}</div>
                    <div className="text-xs text-navy-400">{online ? `Zmiana ${ms.activeShift?.shift_type} · ${ops || '—'}` : 'Brak aktywnej zmiany'}</div>
                  </div>
                </div>
                {online && (reported
                  ? <span className="status-ok text-xs">✓ raport ok</span>
                  : <span className="status-alarm text-xs animate-pulse">⚠ brak raportu</span>
                )}
              </div>
              <div className="grid grid-cols-5 gap-2 mb-3">
                {[
                  { l: 'Produkcja', v: g.toLocaleString('pl-PL'), c: 'text-white' },
                  { l: 'Efektywność', v: eff > 0 ? eff + '%' : '—', c: efficiencyColor(eff) },
                  { l: 'FPY', v: mFpy > 0 ? mFpy + '%' : '—', c: efficiencyColor(mFpy) },
                  { l: '% odrzutu', v: rPct > 0 ? rPct + '%' : '—', c: rPct > 5 ? 'text-red-400' : 'text-green-400' },
                  { l: 'Alarm', v: al > 0 ? minsToHHMM(al) : '—', c: al > 30 ? 'text-red-400' : 'text-navy-400' }
                ].map(s => (
                  <div key={s.l} className="bg-navy-900 rounded-xl p-2 text-center">
                    <div className="text-xs text-navy-500 mb-1">{s.l}</div>
                    <div className={cn('text-sm font-bold font-mono', s.c)}>{s.v}</div>
                  </div>
                ))}
              </div>
              {eff > 0 && (
                <div className="h-1.5 bg-navy-900 rounded-full overflow-hidden mb-2">
                  <div className={cn('h-full rounded-full', efficiencyBg(eff))} style={{ width: `${Math.min(eff,100)}%` }} />
                </div>
              )}
              {ms.todayReports.length > 0 && (
                <div className="flex items-end gap-px h-8 mt-1">
                  {Array.from({length:24},(_,h) => {
                    const r = ms.todayReports.find(r => r.hour_start === h)
                    const e = r ? Number(r.efficiency_pct) : 0
                    return (
                      <div key={h} className="flex-1 flex flex-col justify-end h-full">
                        {r ? <div className={cn('rounded-sm', efficiencyBg(e))} style={{ height: `${Math.max(e,8)}%` }} title={`${h}:00 — ${r.good_count} szt`} />
                           : <div className="rounded-sm bg-navy-800 opacity-30" style={{ height: '3px' }} />}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header"><div><div className="card-title">Przyrost godzinowy — dziś</div><div className="card-sub">Produkcja per godzina</div></div></div>
          <div style={{ height: 200 }}>
            {hourLabels.length > 0
              ? <Bar data={{ labels: hourLabels, datasets: hourlyDatasets }} options={CHART_OPTS as never} />
              : <div className="flex items-center justify-center h-full text-navy-500 text-sm">Brak danych</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div><div className="card-title">Trend produkcji — {viewMode === 'Miesiąc' ? `${MONTHS_PL[selMonth-1]} ${selYear}` : viewMode}</div><div className="card-sub">Dzienna produkcja łącznie</div></div></div>
          <div style={{ height: 200 }}>
            {trendLabels.length > 0
              ? <Line data={{
                  labels: trendLabels,
                  datasets: [
                    { label: 'Produkcja (szt)', data: trendGoodData, borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.4, fill: true, pointRadius: days <= 10 ? 4 : 2, spanGaps: true, yAxisID: 'y' },
                    { label: 'OEE (%)', data: trendOeeData, borderColor: '#10B981', tension: 0.4, fill: false, pointRadius: days <= 10 ? 4 : 2, spanGaps: true, yAxisID: 'y1' }
                  ]
                }} options={{
                  ...CHART_OPTS as never,
                  scales: {
                    y:  { ...CHART_OPTS.scales.y, position: 'left' as const },
                    y1: { ...CHART_OPTS.scales.y, position: 'right' as const, grid: { display: false }, ticks: { color: '#4A5568', callback: (v: unknown) => v + '%' } },
                    x:  CHART_OPTS.scales.x
                  }
                } as never} />
              : <div className="flex items-center justify-center h-full text-navy-500 text-sm">Brak danych</div>}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div><div className="card-title">Raporty godzinowe — dziś</div><div className="card-sub">{todayReports.length} wpisów</div></div>
        </div>
        {todayReports.length === 0
          ? <div className="text-center py-8 text-navy-500">Brak raportów</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-700">
                    {['Godzina','Maszyna','Przyrost','Odrzut','FPY','Efektyw.','Czas pracy','Alarm','Uwagi'].map(h => (
                      <th key={h} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...todayReports].reverse().map(r => {
                    const eff  = Number(r.efficiency_pct)
                    const rFpy = (r.good_count + r.reject_count) > 0 ? Math.round(r.good_count / (r.good_count + r.reject_count) * 100) : 0
                    const m    = machines.find(ms => ms.machine.id === r.machine_id)
                    return (
                      <tr key={r.id} className="border-b border-navy-800 hover:bg-navy-800/50">
                        <td className="py-2 px-3 font-mono text-xs text-white">{r.hour_block}</td>
                        <td className="py-2 px-3"><span className="status-info text-xs">{m?.machine.name ?? '—'}</span></td>
                        <td className="py-2 px-3 font-bold font-mono text-white">{r.good_count.toLocaleString('pl-PL')}</td>
                        <td className="py-2 px-3 font-mono text-red-400 text-xs">{r.reject_count || '—'}</td>
                        <td className="py-2 px-3"><span className={cn('font-bold text-xs', efficiencyColor(rFpy))}>{rFpy > 0 ? rFpy + '%' : '—'}</span></td>
                        <td className="py-2 px-3"><span className={cn('font-bold', efficiencyColor(eff))}>{eff}%</span></td>
                        <td className="py-2 px-3 font-mono text-xs text-green-400">{minsToHHMM(r.runtime_min)}</td>
                        <td className="py-2 px-3 font-mono text-xs text-red-400">{r.alarm_min ? minsToHHMM(r.alarm_min) : '—'}</td>
                        <td className="py-2 px-3 text-xs text-navy-500 max-w-xs truncate">{r.notes || r.downtime_reason || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </div>
  )
}
