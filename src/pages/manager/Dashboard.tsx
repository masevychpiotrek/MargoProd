import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useClock } from '@/hooks/useClock'
import { efficiencyColor, efficiencyBg, cn } from '@/lib/utils'
import type { HourlyReport, Shift, Machine } from '@/types/database'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend } from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

const TARGET    = 2100
const REAL_TARGET = 2500

const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#8892AA', font: { size: 11 }, boxWidth: 12 } } },
  scales: {
    y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4A5568' } },
    x: { grid: { display: false }, ticks: { color: '#4A5568' } }
  }
}

function minsToHHMM(m: number) {
  if (!m) return '00:00'
  return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
}

interface MachineStatus {
  machine: Machine
  activeShift: (Shift & { operator_1?: { full_name: string }, operator_2?: { full_name: string } }) | null
  todayReports: ReportWithContext[]
}

type ReportWithContext = Omit<HourlyReport, 'operator'> & {
  ready_min?: number
  alarm_min?: number
  operator?: { full_name: string } | { full_name: string }[] | null
  shift?: { shift_type: string } | { shift_type: string }[] | null
}

interface WepqRow {
  key: string
  date: string
  machineName: string
  shiftType: string
  operatorName: string
  good: number
  target: number
  reports: number
  wEpq: number
  wEpqTotal: number
}

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default function ManagerDashboard() {
  const { time, date, dateISO, hour } = useClock()
  const [machines,    setMachines]    = useState<MachineStatus[]>([])
  const [allReports,  setAllReports]  = useState<ReportWithContext[]>([])
  const [weekReports, setWeekReports] = useState<(HourlyReport & { ready_min?: number; alarm_min?: number })[]>([])
  const [range, setRange] = useState<'today'|'7d'|'30d'>('today')
  const [loading, setLoading] = useState(true)
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    load()
    channel.current?.unsubscribe()
    channel.current = supabase.channel('mgr')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .subscribe()
    return () => { channel.current?.unsubscribe() }
  }, [dateISO, range])

  const load = async () => {
    setLoading(true)
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 1
    const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - days + 1)
    const fromStr  = fromDate.toISOString().split('T')[0]

    // Week for trend comparison
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
    const weekStr  = weekAgo.toISOString().split('T')[0]

    const [mRes, sRes, rRes, wRes] = await Promise.all([
      supabase.from('machines').select('*').eq('is_active', true).order('code'),
      supabase.from('shifts').select('*, operator_1:profiles!operator_1_id(full_name), operator_2:profiles!operator_2_id(full_name)').eq('shift_date', dateISO).is('ended_at', null),
      supabase
        .from('hourly_reports')
        .select('*, operator:profiles!operator_id(full_name), shift:shifts!shift_id(shift_type)')
        .gte('report_date', fromStr)
        .is('deleted_at', null)
        .order('report_date')
        .order('hour_start'),
      supabase.from('hourly_reports').select('good_count, reject_count, runtime_min, ready_min, alarm_min, report_date').gte('report_date', weekStr).is('deleted_at', null)
    ])

    const mList = (mRes.data ?? []) as Machine[]
    const sList = sRes.data ?? []
    const rList = (rRes.data ?? []) as ReportWithContext[]
    const wList = (wRes.data ?? []) as (HourlyReport & { ready_min?: number; alarm_min?: number })[]
    setAllReports(rList)
    setWeekReports(wList)

    setMachines(mList.map(m => ({
      machine: m,
      activeShift: (sList.find((s: Shift) => s.machine_id === m.id) ?? null) as MachineStatus['activeShift'],
      todayReports: rList.filter(r => r.machine_id === m.id && r.report_date === dateISO)
    })))
    setLoading(false)
  }

  const todayReports = allReports.filter(r => r.report_date === dateISO)
  const machineNameById = Object.fromEntries(machines.map(ms => [ms.machine.id, ms.machine.name]))

  // ── KPI obliczenia ────────────────────────────────────────────────────────
  const totalGood    = todayReports.reduce((s,r) => s + r.good_count, 0)
  const totalReject  = todayReports.reduce((s,r) => s + r.reject_count, 0)
  const totalRuntime = todayReports.reduce((s,r) => s + r.runtime_min, 0)
  const totalDowntime= todayReports.reduce((s,r) => s + r.downtime_min + r.failure_min, 0)
  const totalAlarm   = todayReports.reduce((s,r) => s + (r.alarm_min ?? 0), 0)
  const totalReady   = todayReports.reduce((s,r) => s + (r.ready_min ?? 0), 0)
  const totalTime    = totalRuntime + totalDowntime + totalAlarm + totalReady

  const avgEff       = todayReports.length > 0 ? Math.round(todayReports.reduce((s,r) => s + Number(r.efficiency_pct), 0) / todayReports.length) : 0
  const oee          = todayReports.length > 0 ? Math.round(totalGood / (todayReports.length * TARGET) * 100) : 0
  const rejectPct    = (totalGood + totalReject) > 0 ? Math.round(totalReject / (totalGood + totalReject) * 100) : 0
  const availability = totalTime > 0 ? Math.round(totalRuntime / totalTime * 100) : 0

  // Efektywność czasowa (na podstawie raportów z order_qty)
  const totalOrderQty = todayReports.reduce((s,r) => s + (((r as { order_qty?: number }).order_qty) ?? 0), 0)
  const planMins      = totalOrderQty > 0 ? Math.round(totalOrderQty / REAL_TARGET * 60) : 0
  const faktMins      = totalRuntime + totalDowntime + totalAlarm
  const timeEfficiency = planMins > 0 && faktMins > 0 ? Math.round(planMins / faktMins * 100) : null

  // Trend vs tydzień temu
  const prevWeekGood = weekReports.filter(r => r.report_date !== dateISO).reduce((s,r) => s + r.good_count, 0)
  const prevWeekDays = [...new Set(weekReports.filter(r => r.report_date !== dateISO).map(r => r.report_date))].length
  const prevWeekAvgDay = prevWeekDays > 0 ? Math.round(prevWeekGood / prevWeekDays) : 0
  const trendVsLastWeek = prevWeekAvgDay > 0 ? Math.round((totalGood - prevWeekAvgDay) / prevWeekAvgDay * 100) : null

  // Najlepsza godzina
  const bestReport = todayReports.length > 0
    ? todayReports.reduce((best, r) => Number(r.efficiency_pct) > Number(best.efficiency_pct) ? r : best, todayReports[0])
    : null

  // Wykresy
  const activeHours  = Array.from({length:24},(_,h)=>h).filter(h => machines.some(ms => ms.todayReports.some(r => r.hour_start === h)))
  const hourLabels   = activeHours.map(h => `${String(h).padStart(2,'0')}:00`)
  const hourlyDatasets = machines.map((ms,i) => ({
    label: ms.machine.name,
    data: activeHours.map(h => ms.todayReports.find(r => r.hour_start === h)?.good_count ?? 0),
    backgroundColor: i === 0 ? 'rgba(59,130,246,0.75)' : 'rgba(6,182,212,0.75)',
    borderRadius: 4
  }))

  // Trend tygodniowy
  const dateMap: Record<string, number> = {}
  allReports.forEach(r => { dateMap[r.report_date] = (dateMap[r.report_date] ?? 0) + r.good_count })
  const sortedDates  = Object.keys(dateMap).sort()
  const trendLabels  = sortedDates.map(d => d.slice(5))

  const wepqRows = Object.values(allReports.reduce<Record<string, WepqRow>>((acc, r) => {
    const report = r as ReportWithContext
    const operatorName = one(report.operator)?.full_name ?? '—'
    const shiftType = one(report.shift)?.shift_type ?? '—'
    const machineName = machineNameById[report.machine_id] ?? '—'
    const key = `${report.report_date}|${report.machine_id}|${shiftType}|${report.operator_id}`

    if (!acc[key]) {
      acc[key] = {
        key,
        date: report.report_date,
        machineName,
        shiftType,
        operatorName,
        good: 0,
        target: 0,
        reports: 0,
        wEpq: 0,
        wEpqTotal: 0
      }
    }

    acc[key].good += report.good_count
    acc[key].target += report.target || TARGET
    acc[key].reports += 1
    acc[key].wEpq += Number(report.efficiency_pct) || 0
    return acc
  }, {})).map(row => ({
    ...row,
    wEpq: row.reports > 0 ? Math.round(row.wEpq / row.reports) : 0,
    wEpqTotal: row.target > 0 ? Math.round(row.good / row.target * 100) : 0
  })).sort((a, b) =>
    b.date.localeCompare(a.date) ||
    a.machineName.localeCompare(b.machineName) ||
    a.shiftType.localeCompare(b.shiftType) ||
    b.wEpqTotal - a.wEpqTotal
  )

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
          {(['today','7d','30d'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={cn('btn text-xs py-1.5 px-3', range === r ? 'btn-primary' : 'btn-secondary')}>
              {r === 'today' ? 'Dziś' : r === '7d' ? '7 dni' : '30 dni'}
            </button>
          ))}
          <button onClick={load} className="btn-secondary text-xs py-1.5 px-3">↻</button>
        </div>
      </div>

      {/* KPI row 1 — produkcja */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: 'Produkcja łącznie', v: totalGood.toLocaleString('pl-PL') + ' szt', c: 'text-brand',
            sub: trendVsLastWeek !== null ? `${trendVsLastWeek >= 0 ? '↑' : '↓'} ${Math.abs(trendVsLastWeek)}% vs ostatni tydzień` : 'dziś' },
          { l: 'OEE', v: oee + '%', c: efficiencyColor(oee), sub: 'Overall Equipment Effectiveness' },
          { l: 'Śr. efektywność', v: avgEff > 0 ? avgEff + '%' : '—', c: efficiencyColor(avgEff), sub: `vs target ${TARGET} szt/h` },
          { l: 'Odrzut', v: rejectPct + '%', c: rejectPct > 5 ? 'text-red-400' : rejectPct > 2 ? 'text-amber-400' : 'text-green-400',
            sub: `${totalReject.toLocaleString('pl-PL')} szt` },
        ].map(k => (
          <div key={k.l} className="kpi-card">
            <div className="kpi-label">{k.l}</div>
            <div className={cn('kpi-value', k.c)}>{loading ? '...' : k.v}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* KPI row 2 — czasy i efektywność */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { l: 'Dostępność maszyn', v: availability > 0 ? availability + '%' : '—',
            c: availability > 90 ? 'text-green-400' : availability > 75 ? 'text-amber-400' : 'text-red-400',
            sub: `czas pracy ${minsToHHMM(totalRuntime)}` },
          { l: 'Czas przestojów', v: minsToHHMM(totalDowntime),
            c: totalDowntime > 60 ? 'text-red-400' : totalDowntime > 30 ? 'text-amber-400' : 'text-green-400',
            sub: 'postoje + awarie' },
          { l: 'Czas alarmów', v: minsToHHMM(totalAlarm),
            c: totalAlarm > 60 ? 'text-red-400' : totalAlarm > 30 ? 'text-amber-400' : 'text-green-400',
            sub: 'czas w alarmie' },
          { l: 'Ef. czasowa zleceń', v: timeEfficiency !== null ? timeEfficiency + '%' : '—',
            c: timeEfficiency === null ? 'text-navy-400' : timeEfficiency >= 90 ? 'text-green-400' : timeEfficiency >= 75 ? 'text-amber-400' : 'text-red-400',
            sub: timeEfficiency !== null ? `plan ${minsToHHMM(planMins)} vs fakt ${minsToHHMM(faktMins)}` : 'brak zleceń z planem' },
          { l: 'Najlepsza godzina', v: bestReport ? bestReport.hour_block : '—',
            c: 'text-cyan-400',
            sub: bestReport ? `${bestReport.good_count.toLocaleString('pl-PL')} szt · ${bestReport.efficiency_pct}%` : 'brak danych' },
        ].map(k => (
          <div key={k.l} className="kpi-card">
            <div className="kpi-label">{k.l}</div>
            <div className={cn('kpi-value text-xl', k.c)}>{loading ? '...' : k.v}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Machine cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {machines.map(ms => {
          const g    = ms.todayReports.reduce((s,r) => s + r.good_count, 0)
          const rej  = ms.todayReports.reduce((s,r) => s + r.reject_count, 0)
          const al   = ms.todayReports.reduce((s,r) => s + (r.alarm_min ?? 0), 0)
          const eff  = ms.todayReports.length > 0 ? Math.round(ms.todayReports.reduce((s,r) => s + Number(r.efficiency_pct), 0) / ms.todayReports.length) : 0
          const rPct = (g + rej) > 0 ? Math.round(rej / (g + rej) * 100) : 0
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

              <div className="grid grid-cols-4 gap-2 mb-3">
                {[
                  { l: 'Produkcja', v: g.toLocaleString('pl-PL'), c: 'text-white' },
                  { l: 'Efektywność', v: eff > 0 ? eff + '%' : '—', c: efficiencyColor(eff) },
                  { l: '% odrzutu', v: rPct > 0 ? rPct + '%' : '—', c: rPct > 5 ? 'text-red-400' : 'text-green-400' },
                  { l: 'Alarm', v: al > 0 ? minsToHHMM(al) : '—', c: al > 30 ? 'text-red-400' : 'text-navy-400' }
                ].map(s => (
                  <div key={s.l} className="bg-navy-900 rounded-xl p-2.5 text-center">
                    <div className="text-xs text-navy-500 mb-1">{s.l}</div>
                    <div className={cn('text-base font-bold font-mono', s.c)}>{s.v}</div>
                  </div>
                ))}
              </div>

              {eff > 0 && (
                <div className="mb-3">
                  <div className="h-2 bg-navy-900 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', efficiencyBg(eff))} style={{ width: `${Math.min(eff,100)}%` }} />
                  </div>
                </div>
              )}

              {/* Mini chart */}
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
          <div className="card-header"><div><div className="card-title">Przyrost godzinowy — dziś</div><div className="card-sub">Automat 3 vs Automat 4</div></div></div>
          <div style={{ height: 200 }}>
            {hourLabels.length > 0
              ? <Bar data={{ labels: hourLabels, datasets: hourlyDatasets }} options={CHART_OPTS as never} />
              : <div className="flex items-center justify-center h-full text-navy-500 text-sm">Brak danych</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div><div className="card-title">Trend produkcji</div><div className="card-sub">Łączna produkcja dzienna</div></div></div>
          <div style={{ height: 200 }}>
            {trendLabels.length > 0
              ? <Line data={{
                  labels: trendLabels,
                  datasets: [
                    { label: 'Produkcja łącznie', data: sortedDates.map(d => dateMap[d]), borderColor: '#3B82F6', tension: 0.4, fill: false, pointRadius: 3, spanGaps: true }
                  ]
                }} options={CHART_OPTS as never} />
              : <div className="flex items-center justify-center h-full text-navy-500 text-sm">Brak danych</div>}
          </div>
        </div>
      </div>

      {/* WEPQ per operator */}
      <div className="card">
        <div className="card-header">
          <div><div className="card-title">WEPQ operatorów</div><div className="card-sub">{wepqRows.length} zestawień · osoba / zmiana / dzień / maszyna</div></div>
        </div>
        {wepqRows.length === 0
          ? <div className="text-center py-8 text-navy-500">Brak danych WEPQ</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-700">
                    {['Data','Maszyna','Zmiana','Operator','W EPQ','WEPQ TOTAL','Produkcja','Raporty'].map(h => (
                      <th key={h} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {wepqRows.map(row => (
                    <tr key={row.key} className="border-b border-navy-800 hover:bg-navy-800/50">
                      <td className="py-2 px-3 font-mono text-xs text-navy-300">{row.date}</td>
                      <td className="py-2 px-3"><span className="status-info text-xs">{row.machineName}</span></td>
                      <td className="py-2 px-3 font-bold text-white">Zmiana {row.shiftType}</td>
                      <td className="py-2 px-3 text-navy-200">{row.operatorName}</td>
                      <td className="py-2 px-3"><span className={cn('font-bold font-mono', efficiencyColor(row.wEpq))}>{row.wEpq}%</span></td>
                      <td className="py-2 px-3"><span className={cn('font-bold font-mono', efficiencyColor(row.wEpqTotal))}>{row.wEpqTotal}%</span></td>
                      <td className="py-2 px-3 font-bold font-mono text-white">{row.good.toLocaleString('pl-PL')}</td>
                      <td className="py-2 px-3 font-mono text-navy-400">{row.reports}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
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
                    {['Godzina','Maszyna','Operator','W EPQ','Przyrost','Odrzut','Efektyw.','Czas pracy','Alarm','Uwagi'].map(h => (
                      <th key={h} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...todayReports].reverse().map(r => {
                    const eff = Number(r.efficiency_pct)
                    const report = r as ReportWithContext
                    const m = machines.find(ms => ms.machine.id === r.machine_id)
                    const operatorName = one(report.operator)?.full_name ?? '—'
                    return (
                      <tr key={r.id} className="border-b border-navy-800 hover:bg-navy-800/50">
                        <td className="py-2 px-3 font-mono text-xs text-white">{r.hour_block}</td>
                        <td className="py-2 px-3"><span className="status-info text-xs">{m?.machine.name ?? '—'}</span></td>
                        <td className="py-2 px-3 text-xs text-navy-300 max-w-[120px] truncate">{operatorName}</td>
                        <td className="py-2 px-3"><span className={cn('font-bold font-mono', efficiencyColor(eff))}>{eff}%</span></td>
                        <td className="py-2 px-3 font-bold font-mono text-white">{r.good_count.toLocaleString('pl-PL')}</td>
                        <td className="py-2 px-3 font-mono text-red-400 text-xs">{r.reject_count || '—'}</td>
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
