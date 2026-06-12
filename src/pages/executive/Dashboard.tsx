import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn, compareProductionHours, efficiencyColor, getProductionDate } from '@/lib/utils'
import type { FailureReport, HourlyReport, Machine, Shift, ShiftType } from '@/types/database'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend } from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

const TARGET_PER_HOUR = 3200
const SHIFTS: ShiftType[] = ['I', 'II', 'III']

const CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#8892AA', font: { size: 11 }, boxWidth: 12 } }
  },
  scales: {
    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7B89A8' } },
    x: { grid: { display: false }, ticks: { color: '#7B89A8' } }
  }
}

type Mode = 'day' | 'range' | 'month'

type ReportWithShift = HourlyReport & {
  shift?: { shift_type: ShiftType; shift_date?: string } | { shift_type: ShiftType; shift_date?: string }[] | null
}

type ShiftSummary = Shift & {
  summary_good_count?: number | null
  summary_reject_count?: number | null
  summary_runtime_min?: number | null
  summary_ready_min?: number | null
  summary_alarm_min?: number | null
  summary_downtime_min?: number | null
  summary_notes?: string | null
}

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return iso(d)
}

function startOfMonth(year: string, month: string) {
  return `${year}-${month}-01`
}

function endOfMonth(year: string, month: string) {
  return iso(new Date(Number(year), Number(month), 0))
}

function pct(value: number, target: number) {
  return target > 0 ? Math.round(value / target * 100) : 0
}

function pct1(value: number, target: number) {
  return target > 0 ? Math.round(value / target * 1000) / 10 : 0
}

function pieces(value: number) {
  return value.toLocaleString('pl-PL')
}

function mins(value: number) {
  const rounded = Math.max(0, Math.round(value || 0))
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`
}

function hasShiftSummary(shift: ShiftSummary) {
  return [
    shift.summary_good_count,
    shift.summary_reject_count,
    shift.summary_runtime_min,
    shift.summary_ready_min,
    shift.summary_alarm_min,
    shift.summary_downtime_min,
    shift.summary_notes
  ].some(value => value !== null && value !== undefined && value !== '')
}

function shiftFromHour(hour: number): ShiftType {
  if (hour >= 6 && hour < 14) return 'I'
  if (hour >= 14 && hour < 22) return 'II'
  return 'III'
}

function buildReasonText(params: {
  realization: number
  weakestMachine: string
  weakestMachineEpq: number
  rejectPct: number
  lossMinutes: number
  missingSummaries: number
  criticalFailures: number
}) {
  const reasons: string[] = []
  if (params.realization >= 100) {
    reasons.push('Cel produkcyjny zostal osiagniety w analizowanym zakresie.')
  } else {
    reasons.push(`Cel nie zostal osiagniety. Realizacja wyniosla ${params.realization}% wzgledem normy producenta.`)
  }
  if (params.weakestMachine && params.weakestMachineEpq > 0 && params.weakestMachineEpq < 85) {
    reasons.push(`Najwieksze odchylenie widac na ${params.weakestMachine}, gdzie W EPQ wynioslo ${params.weakestMachineEpq}%.`)
  }
  if (params.rejectPct > 5) {
    reasons.push(`Odrzut przekroczyl prog 5% i wymaga analizy przyczyn jakosciowych.`)
  }
  if (params.lossMinutes > 0) {
    reasons.push(`Zarejestrowano ${mins(params.lossMinutes)} strat czasu w alarmach, postojach lub braku gotowosci.`)
  }
  if (params.criticalFailures > 0) {
    reasons.push(`Wystapily ${params.criticalFailures} krytyczne zgloszenia techniczne.`)
  }
  if (params.missingSummaries > 0) {
    reasons.push(`Brakuje ${params.missingSummaries} rozliczen konca zmiany, co obniza jakosc analizy czasu pracy.`)
  }
  return reasons.join(' ')
}

export default function ExecutiveDashboard() {
  const today = getProductionDate()
  const [mode, setMode] = useState<Mode>('day')
  const [selectedDate, setSelectedDate] = useState(today)
  const [fromDate, setFromDate] = useState(addDays(today, -6))
  const [toDate, setToDate] = useState(today)
  const [month, setMonth] = useState(today.slice(5, 7))
  const [year, setYear] = useState(today.slice(0, 4))
  const [machines, setMachines] = useState<Machine[]>([])
  const [reports, setReports] = useState<ReportWithShift[]>([])
  const [shifts, setShifts] = useState<ShiftSummary[]>([])
  const [failures, setFailures] = useState<FailureReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const range = useMemo(() => {
    if (mode === 'day') return { from: selectedDate, to: selectedDate }
    if (mode === 'month') return { from: startOfMonth(year, month), to: endOfMonth(year, month) }
    return { from: fromDate <= toDate ? fromDate : toDate, to: fromDate <= toDate ? toDate : fromDate }
  }, [fromDate, mode, month, selectedDate, toDate, year])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      const [mRes, rRes, sRes, fRes] = await Promise.all([
        supabase.from('machines').select('*').eq('is_active', true).is('deleted_at', null).order('code'),
        supabase
          .from('hourly_reports')
          .select('*, shift:shifts!shift_id(shift_type, shift_date)')
          .gte('report_date', range.from)
          .lte('report_date', range.to)
          .is('deleted_at', null)
          .order('report_date')
          .order('hour_start'),
        supabase
          .from('shifts')
          .select('*')
          .gte('shift_date', range.from)
          .lte('shift_date', range.to),
        supabase
          .from('failure_reports')
          .select('*')
          .gte('created_at', `${range.from}T00:00:00`)
          .lte('created_at', `${range.to}T23:59:59`)
      ])
      if (!active) return
      if (mRes.error || rRes.error || sRes.error) {
        setError(mRes.error?.message || rRes.error?.message || sRes.error?.message || 'Blad ladowania danych.')
      } else {
        setMachines((mRes.data ?? []) as Machine[])
        setReports((rRes.data ?? []) as ReportWithShift[])
        setShifts((sRes.data ?? []) as ShiftSummary[])
        setFailures(fRes.error ? [] : (fRes.data ?? []) as FailureReport[])
      }
      setLoading(false)
    }
    load()
    const channel = supabase.channel(`executive-dashboard-${range.from}-${range.to}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'failure_reports' }, load)
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [range.from, range.to])

  const machineById = useMemo(
    () => Object.fromEntries(machines.map(machine => [machine.id, machine])),
    [machines]
  )

  const shiftSummaryByKey = useMemo(() => {
    const map: Record<string, ShiftSummary> = {}
    shifts.filter(hasShiftSummary).forEach(shift => {
      map[`${shift.shift_date}|${shift.shift_type}|${shift.machine_id}`] = shift
    })
    return map
  }, [shifts])

  const machineRows = useMemo(() => {
    const map: Record<string, {
      machineId: string
      machineName: string
      good: number
      reject: number
      target: number
      runtime: number
      ready: number
      alarm: number
      downtime: number
      reports: number
      failures: number
    }> = {}

    machines.forEach(machine => {
      map[machine.id] = {
        machineId: machine.id,
        machineName: machine.name,
        good: 0,
        reject: 0,
        target: 0,
        runtime: 0,
        ready: 0,
        alarm: 0,
        downtime: 0,
        reports: 0,
        failures: 0
      }
    })

    reports.forEach(report => {
      const machine = map[report.machine_id] ?? {
        machineId: report.machine_id,
        machineName: machineById[report.machine_id]?.name ?? 'Nieznana maszyna',
        good: 0,
        reject: 0,
        target: 0,
        runtime: 0,
        ready: 0,
        alarm: 0,
        downtime: 0,
        reports: 0,
        failures: 0
      }
      map[report.machine_id] = machine
      machine.good += report.good_count
      machine.reject += report.reject_count
      machine.target += TARGET_PER_HOUR
      machine.reports += 1
    })

    shifts.filter(hasShiftSummary).forEach(shift => {
      const machine = map[shift.machine_id]
      if (!machine) return
      if (shift.summary_good_count != null) machine.good = machine.good - reports
        .filter(report => report.machine_id === shift.machine_id && one(report.shift)?.shift_type === shift.shift_type && report.report_date === shift.shift_date)
        .reduce((sum, report) => sum + report.good_count, 0) + shift.summary_good_count
      if (shift.summary_reject_count != null) machine.reject = machine.reject - reports
        .filter(report => report.machine_id === shift.machine_id && one(report.shift)?.shift_type === shift.shift_type && report.report_date === shift.shift_date)
        .reduce((sum, report) => sum + report.reject_count, 0) + shift.summary_reject_count
      machine.runtime += shift.summary_runtime_min ?? 0
      machine.ready += shift.summary_ready_min ?? 0
      machine.alarm += shift.summary_alarm_min ?? 0
      machine.downtime += shift.summary_downtime_min ?? 0
      if ((shift.summary_runtime_min ?? 0) > 0) {
        machine.target += Math.round(TARGET_PER_HOUR * (shift.summary_runtime_min ?? 0) / 60)
      }
    })

    failures.forEach(failure => {
      if (map[failure.machine_id]) map[failure.machine_id].failures += 1
    })

    return Object.values(map).filter(row => row.good || row.reject || row.reports || row.failures)
  }, [failures, machineById, machines, reports, shifts])

  const shiftRows = useMemo(() => {
    const map: Record<string, {
      key: string
      shift: string
      machineName: string
      date: string
      good: number
      reject: number
      target: number
      runtime: number
      loss: number
      missingSummary: boolean
      notes: string[]
    }> = {}

    reports.forEach(report => {
      const shiftType = one(report.shift)?.shift_type ?? shiftFromHour(report.hour_start)
      const key = `${report.report_date}|${shiftType}|${report.machine_id}`
      if (!map[key]) {
        map[key] = {
          key,
          shift: shiftType,
          machineName: machineById[report.machine_id]?.name ?? '-',
          date: report.report_date,
          good: 0,
          reject: 0,
          target: 0,
          runtime: 0,
          loss: 0,
          missingSummary: true,
          notes: []
        }
      }
      map[key].good += report.good_count
      map[key].reject += report.reject_count
      map[key].target += TARGET_PER_HOUR
      const note = [report.downtime_reason, report.reject_reason, report.notes].filter(Boolean).join(' ')
      if (note) map[key].notes.push(note)
    })

    Object.entries(shiftSummaryByKey).forEach(([key, shift]) => {
      const row = map[key] ?? {
        key,
        shift: shift.shift_type,
        machineName: machineById[shift.machine_id]?.name ?? '-',
        date: shift.shift_date,
        good: 0,
        reject: 0,
        target: 0,
        runtime: 0,
        loss: 0,
        missingSummary: true,
        notes: []
      }
      row.good = shift.summary_good_count ?? row.good
      row.reject = shift.summary_reject_count ?? row.reject
      row.runtime = shift.summary_runtime_min ?? 0
      row.loss = (shift.summary_ready_min ?? 0) + (shift.summary_alarm_min ?? 0) + (shift.summary_downtime_min ?? 0)
      row.target = row.runtime > 0 ? Math.round(TARGET_PER_HOUR * row.runtime / 60) : row.target
      row.missingSummary = false
      if (shift.summary_notes) row.notes.push(shift.summary_notes)
      map[key] = row
    })

    return Object.values(map).sort((a, b) =>
      a.date.localeCompare(b.date) ||
      a.machineName.localeCompare(b.machineName) ||
      a.shift.localeCompare(b.shift)
    )
  }, [machineById, reports, shiftSummaryByKey])

  const dailyTrend = useMemo(() => {
    const map: Record<string, { good: number; target: number }> = {}
    reports.forEach(report => {
      if (!map[report.report_date]) map[report.report_date] = { good: 0, target: 0 }
      map[report.report_date].good += report.good_count
      map[report.report_date].target += TARGET_PER_HOUR
    })
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, item]) => ({ date: date.slice(5), good: item.good, target: item.target }))
  }, [reports])

  const hourlyGrowth = useMemo(() => {
    const hours = Array.from(new Set(reports.map(report => report.hour_start))).sort(compareProductionHours)
    return hours.map(hour => ({
      label: `${String(hour).padStart(2, '0')}:00`,
      ...machines.reduce<Record<string, number>>((acc, machine) => {
        acc[machine.name] = reports
          .filter(report => report.machine_id === machine.id && report.hour_start === hour)
          .reduce((sum, report) => sum + report.good_count, 0)
        return acc
      }, {})
    }))
  }, [machines, reports])

  const kpi = useMemo(() => {
    const good = machineRows.reduce((sum, row) => sum + row.good, 0)
    const reject = machineRows.reduce((sum, row) => sum + row.reject, 0)
    const target = machineRows.reduce((sum, row) => sum + row.target, 0)
    const runtime = machineRows.reduce((sum, row) => sum + row.runtime, 0)
    const loss = machineRows.reduce((sum, row) => sum + row.ready + row.alarm + row.downtime, 0)
    const rejectPct = pct1(reject, good + reject)
    const realization = pct(good, target)
    const missingSummaries = shiftRows.filter(row => row.missingSummary && (row.good || row.reject)).length
    const criticalFailures = failures.filter(failure => failure.severity === 'critical').length
    const weakest = [...machineRows]
      .filter(row => row.target > 0)
      .sort((a, b) => pct(a.good, a.target) - pct(b.good, b.target))[0]
    const reasonText = buildReasonText({
      realization,
      weakestMachine: weakest?.machineName ?? '',
      weakestMachineEpq: weakest ? pct(weakest.good, weakest.target) : 0,
      rejectPct,
      lossMinutes: loss,
      missingSummaries,
      criticalFailures
    })
    return { good, reject, target, runtime, loss, rejectPct, realization, missingSummaries, criticalFailures, weakest, reasonText }
  }, [failures, machineRows, shiftRows])

  const lossReasons = useMemo(() => {
    const lowOutput = shiftRows
      .filter(row => row.target > 0 && pct(row.good, row.target) < 85)
      .reduce((sum, row) => sum + Math.max(0, row.target - row.good), 0)
    const rejectLoss = kpi.reject
    const timeLoss = Math.round(kpi.loss * TARGET_PER_HOUR / 60)
    const missing = kpi.missingSummaries
    const items = [
      { label: 'Niska wydajnosc', value: lowOutput, detail: 'brakujace sztuki wzgledem normy' },
      { label: 'Odrzut', value: rejectLoss, detail: 'sztuki niezgodne' },
      { label: 'Straty czasu', value: timeLoss, detail: `${mins(kpi.loss)} poza praca` },
      { label: 'Braki rozliczen', value: missing, detail: 'zmiany bez czasu pracy' }
    ]
    return items.sort((a, b) => b.value - a.value)
  }, [kpi.loss, kpi.missingSummaries, kpi.reject, shiftRows])

  const recommendations = useMemo(() => {
    const list: string[] = []
    if (kpi.realization < 90 && kpi.weakest) list.push(`Priorytet: analiza ${kpi.weakest.machineName}, bo ma najnizsze wykonanie celu.`)
    if (kpi.rejectPct > 5) list.push('Odrzut przekracza 5%. Wymagana analiza stacji i powtarzalnosci problemu.')
    if (kpi.loss > 120) list.push('Straty czasu przekraczaja 2 godziny. Porownac alarmy z opisami awarii.')
    if (kpi.missingSummaries > 0) list.push('Domknac rozliczenia zmian, bo bez nich zarzad nie widzi pelnej dostepnosci maszyn.')
    if (!list.length) list.push('Wynik stabilny. Utrzymac kontrole odrzutu i regularne rozliczanie zmian.')
    return list
  }, [kpi])

  const machineChart = {
    labels: machineRows.map(row => row.machineName),
    datasets: [
      { label: 'Produkcja', data: machineRows.map(row => row.good), backgroundColor: 'rgba(59,130,246,0.75)', borderRadius: 4 },
      { label: 'Cel', data: machineRows.map(row => row.target), backgroundColor: 'rgba(201,168,76,0.65)', borderRadius: 4 }
    ]
  }

  const rejectChart = {
    labels: machineRows.map(row => row.machineName),
    datasets: [
      {
        label: 'Odrzut %',
        data: machineRows.map(row => pct1(row.reject, row.good + row.reject)),
        backgroundColor: machineRows.map(row => pct1(row.reject, row.good + row.reject) > 5 ? 'rgba(239,68,68,0.72)' : 'rgba(34,197,94,0.72)'),
        borderRadius: 4
      }
    ]
  }

  const trendChart = {
    labels: dailyTrend.map(item => item.date),
    datasets: [
      { label: 'Produkcja', data: dailyTrend.map(item => item.good), borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.15)', tension: 0.25 },
      { label: 'Cel', data: dailyTrend.map(item => item.target), borderColor: '#C9A84C', backgroundColor: 'rgba(201,168,76,0.12)', tension: 0.25 }
    ]
  }

  const hourlyChart = {
    labels: hourlyGrowth.map(row => row.label),
    datasets: machines.map((machine, index) => ({
      label: machine.name,
      data: hourlyGrowth.map(row => (row as Record<string, string | number>)[machine.name] as number ?? 0),
      backgroundColor: index % 2 === 0 ? 'rgba(59,130,246,0.72)' : 'rgba(34,197,94,0.72)',
      borderRadius: 4
    }))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-brand">Panel zarzadu</div>
          <h1 className="mt-1 text-3xl font-black text-white">Wynik produkcji i przyczyny odchylen</h1>
          <p className="mt-1 max-w-3xl text-sm text-navy-400">
            Widok decyzyjny: cel, wykonanie, strata, odrzut, awarie oraz uzasadnienie wyniku bez edycji danych.
          </p>
        </div>
        <div className="rounded-2xl border border-navy-600 bg-navy-800 px-4 py-3 text-right">
          <div className="text-xs font-bold uppercase tracking-wider text-navy-500">Zakres</div>
          <div className="mt-1 font-mono text-sm text-white">{range.from} - {range.to}</div>
        </div>
      </div>

      <div className="card">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1.2fr]">
          <div className="flex flex-wrap gap-2">
            {[
              ['day', 'Dzien'],
              ['range', 'Okres'],
              ['month', 'Miesiac']
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMode(key as Mode)}
                className={cn('rounded-xl px-4 py-2 text-sm font-bold', mode === key ? 'bg-brand text-navy-950' : 'bg-navy-900 text-navy-300 hover:bg-navy-700')}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === 'day' && <input className="input" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />}
          {mode === 'range' && (
            <>
              <input className="input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              <input className="input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
            </>
          )}
          {mode === 'month' && (
            <>
              <select className="input" value={month} onChange={e => setMonth(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(value => <option key={value} value={value}>{value}</option>)}
              </select>
              <input className="input" value={year} onChange={e => setYear(e.target.value)} />
            </>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        {[
          { label: 'Produkcja', value: `${pieces(kpi.good)} szt`, sub: `cel ${pieces(kpi.target)} szt`, color: 'text-brand' },
          { label: 'Realizacja celu', value: `${kpi.realization}%`, sub: 'wzgledem 3200 szt/h', color: efficiencyColor(kpi.realization) },
          { label: 'Odrzut', value: `${kpi.rejectPct}%`, sub: `${pieces(kpi.reject)} szt`, color: kpi.rejectPct > 5 ? 'text-red-400' : kpi.rejectPct > 2 ? 'text-amber-400' : 'text-green-400' },
          { label: 'Czas pracy', value: kpi.runtime ? mins(kpi.runtime) : '-', sub: 'z rozliczen zmian', color: 'text-green-400' },
          { label: 'Straty czasu', value: kpi.loss ? mins(kpi.loss) : '-', sub: 'gotowosc + alarm + postoj', color: kpi.loss > 120 ? 'text-red-400' : 'text-amber-400' },
          { label: 'Awarie krytyczne', value: kpi.criticalFailures, sub: `${failures.length} zgloszen lacznie`, color: kpi.criticalFailures ? 'text-red-400' : 'text-green-400' }
        ].map(item => (
          <div key={item.label} className="kpi-card">
            <div className="kpi-label">{item.label}</div>
            <div className={cn('kpi-value text-xl', item.color)}>{loading ? '...' : item.value}</div>
            <div className="kpi-sub">{item.sub}</div>
          </div>
        ))}
      </div>

      <div className="card border-brand/25">
        <div className="card-header">
          <div>
            <div className="card-title">Uzasadnienie wyniku</div>
            <div className="card-sub">Automatyczny opis dla zarzadu na podstawie produkcji, odrzutu, strat czasu i awarii</div>
          </div>
          <span className={cn('rounded-full px-3 py-1 text-xs font-bold', kpi.realization >= 100 ? 'bg-green-500/10 text-green-300' : kpi.realization >= 90 ? 'bg-amber-500/10 text-amber-300' : 'bg-red-500/10 text-red-300')}>
            {kpi.realization >= 100 ? 'Cel osiagniety' : kpi.realization >= 90 ? 'Ryzyko odchylenia' : 'Cel nieosiagniety'}
          </span>
        </div>
        <p className="text-base leading-relaxed text-navy-100">{loading ? 'Ladowanie analizy...' : kpi.reasonText}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Realizacja vs cel</div>
              <div className="card-sub">Porownanie automatow wzgledem normy producenta</div>
            </div>
          </div>
          <div className="h-[300px]"><Bar data={machineChart} options={CHART_OPTIONS as never} /></div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Odrzut per automat</div>
              <div className="card-sub">Prog ostrzegawczy: 5%</div>
            </div>
          </div>
          <div className="h-[300px]"><Bar data={rejectChart} options={CHART_OPTIONS as never} /></div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Trend okresu</div>
              <div className="card-sub">Produkcja dzienna kontra cel</div>
            </div>
          </div>
          <div className="h-[300px]"><Line data={trendChart} options={CHART_OPTIONS as never} /></div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Przyrost godzinowy</div>
              <div className="card-sub">Szybki obraz przebiegu dnia po automatach</div>
            </div>
          </div>
          <div className="h-[300px]"><Bar data={hourlyChart} options={CHART_OPTIONS as never} /></div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Ranking przyczyn strat</div>
              <div className="card-sub">Co najbardziej odciagnelo wynik od celu</div>
            </div>
          </div>
          <div className="space-y-3">
            {lossReasons.map(item => (
              <div key={item.label} className="rounded-2xl border border-navy-700 bg-navy-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-white">{item.label}</div>
                    <div className="mt-1 text-sm text-navy-400">{item.detail}</div>
                  </div>
                  <div className="font-mono text-xl font-black text-brand">{typeof item.value === 'number' ? pieces(item.value) : item.value}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Rekomendacje</div>
              <div className="card-sub">Krotka lista tematow do decyzji lub kontroli</div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {recommendations.map((text, index) => (
              <div key={text} className="rounded-2xl border border-brand/25 bg-brand/10 p-4">
                <div className="text-xs font-black uppercase tracking-widest text-brand">#{index + 1}</div>
                <p className="mt-2 text-sm leading-relaxed text-navy-100">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Wynik wedlug zmian i maszyn</div>
            <div className="card-sub">Bez danych personalnych, tylko proces i odchylenia</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                {['Data', 'Zmiana', 'Maszyna', 'Produkcja', 'Cel', 'W EPQ', 'Odrzut', 'Strata czasu', 'Status'].map(header => (
                  <th key={header} className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-navy-400">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shiftRows.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-navy-500">Brak danych w wybranym zakresie</td></tr>
              )}
              {shiftRows.map(row => {
                const epq = pct(row.good, row.target)
                const rejectPct = pct1(row.reject, row.good + row.reject)
                return (
                  <tr key={row.key} className="border-b border-navy-800 hover:bg-navy-800/45">
                    <td className="px-3 py-2 font-mono text-navy-300">{row.date}</td>
                    <td className="px-3 py-2 font-bold text-white">Zmiana {row.shift}</td>
                    <td className="px-3 py-2 text-navy-100">{row.machineName}</td>
                    <td className="px-3 py-2 font-mono font-bold text-white">{pieces(row.good)}</td>
                    <td className="px-3 py-2 font-mono text-navy-300">{pieces(row.target)}</td>
                    <td className={cn('px-3 py-2 font-mono font-bold', efficiencyColor(epq))}>{epq}%</td>
                    <td className={cn('px-3 py-2 font-mono font-bold', rejectPct > 5 ? 'text-red-400' : rejectPct > 2 ? 'text-amber-400' : 'text-green-400')}>{rejectPct}%</td>
                    <td className="px-3 py-2 font-mono text-amber-300">{row.loss ? mins(row.loss) : '-'}</td>
                    <td className="px-3 py-2">
                      <span className={cn('rounded-full px-2 py-1 text-xs font-bold', row.missingSummary ? 'bg-amber-500/10 text-amber-300' : epq >= 90 ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300')}>
                        {row.missingSummary ? 'Brak rozliczenia' : epq >= 90 ? 'Stabilnie' : 'Wymaga analizy'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {SHIFTS.some(shift => shiftRows.some(row => row.shift === shift && row.notes.length > 0)) && (
        <div className="grid gap-4 xl:grid-cols-3">
          {SHIFTS.map(shift => {
            const rows = shiftRows.filter(row => row.shift === shift && row.notes.length > 0)
            return (
              <div key={shift} className="card">
                <div className="card-title">Komentarze - zmiana {shift}</div>
                <div className="mt-4 space-y-3">
                  {rows.length === 0 && <div className="text-sm text-navy-500">Brak istotnych komentarzy.</div>}
                  {rows.slice(0, 6).map(row => (
                    <div key={row.key} className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                      <div className="text-xs font-bold uppercase tracking-wider text-brand">{row.machineName} - {row.date}</div>
                      <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-navy-200">{row.notes.join(' ')}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
