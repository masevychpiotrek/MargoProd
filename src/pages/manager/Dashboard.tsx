import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, logAudit } from '@/lib/supabase'
import { useClock } from '@/hooks/useClock'
import { cn, efficiencyBg, efficiencyColor, getShiftAutoCloseAt, isShiftPastAutoClose } from '@/lib/utils'
import type { HourlyReport, Machine, Shift, ShiftType } from '@/types/database'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend } from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

const TARGET = 2100
const SHIFTS = ['I', 'II', 'III'] as const

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#8892AA', font: { size: 11 }, boxWidth: 12 } } },
  scales: {
    y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6B7A99' } },
    x: { grid: { display: false }, ticks: { color: '#6B7A99' } }
  }
}

type Mode = 'day' | 'range' | 'month'
type ShiftFilter = 'all' | ShiftType

type ReportWithContext = Omit<HourlyReport, 'operator'> & {
  ready_min?: number
  alarm_min?: number
  counter_good?: number
  counter_reject?: number
  counter_runtime?: number
  counter_ready?: number
  counter_alarm?: number
  order_id?: string | null
  order_qty?: number | null
  operator?: { full_name: string } | { full_name: string }[] | null
  shift?: { shift_type: string; shift_date?: string } | { shift_type: string; shift_date?: string }[] | null
}

type ActiveShift = Shift & {
  operator_1?: { full_name: string } | null
  operator_2?: { full_name: string } | null
}

type GroupRow = {
  key: string
  date: string
  year: string
  month: string
  day: string
  shiftType: string
  machineName: string
  good: number
  reject: number
  target: number
  machineRate: number
  goodRate: number
  runtime: number
  ready: number
  alarm: number
  downtime: number
  reports: number
  wEpq: number
  wEpqTotal: number
}

type EditState = {
  good_count: string
  reject_count: string
  runtime_min: string
  ready_min: string
  alarm_min: string
  downtime_min: string
  failure_min: string
  downtime_reason: string
  notes: string
  reason: string
}

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10)
}

function startOfMonth(year: string, month: string) {
  return `${year}-${month}-01`
}

function endOfMonth(year: string, month: string) {
  return iso(new Date(Number(year), Number(month), 0))
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return iso(d)
}

function minsToHHMM(value: number) {
  const m = Math.max(0, Math.round(value || 0))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function toInt(value: string) {
  const parsed = Number.parseInt(value || '0', 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function reportDowntimeMinutes(report: ReportWithContext) {
  const downtime = report.downtime_min + report.failure_min
  const readyAndAlarm = (report.ready_min ?? 0) + (report.alarm_min ?? 0)
  return downtime === readyAndAlarm && report.failure_min === 0 ? 0 : downtime
}

function reportAccountableMinutes(report: ReportWithContext) {
  return Math.max(
    0,
    report.runtime_min +
      (report.ready_min ?? 0) +
      (report.alarm_min ?? 0) +
      reportDowntimeMinutes(report)
  )
}

function effectiveTarget(ratePerHour: number, accountableMin: number) {
  return Math.round(Math.max(0, ratePerHour) * Math.max(0, accountableMin) / 60)
}

function reportWepq(report: ReportWithContext, ratePerHour: number) {
  const target = effectiveTarget(ratePerHour, reportAccountableMinutes(report))
  return target > 0 ? Math.round(report.good_count / target * 100) : 0
}

function pct(value: number, target: number) {
  return target > 0 ? Math.round(value / target * 100) : 0
}

function hourlyRate(pieces: number, runtimeMin: number) {
  return runtimeMin > 0 ? Math.round(pieces / runtimeMin * 60) : 0
}

export default function ManagerDashboard() {
  const { time, dateISO } = useClock()
  const [machines, setMachines] = useState<Machine[]>([])
  const [activeShifts, setActiveShifts] = useState<ActiveShift[]>([])
  const [reports, setReports] = useState<ReportWithContext[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editError, setEditError] = useState('')
  const [mode, setMode] = useState<Mode>('day')
  const [selectedDate, setSelectedDate] = useState(dateISO)
  const [fromDate, setFromDate] = useState(dateISO)
  const [toDate, setToDate] = useState(dateISO)
  const [month, setMonth] = useState(dateISO.slice(5, 7))
  const [year, setYear] = useState(dateISO.slice(0, 4))
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all')
  const [machineFilter, setMachineFilter] = useState('all')
  const [editing, setEditing] = useState<ReportWithContext | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const queryRange = useMemo(() => {
    if (mode === 'day') return { from: selectedDate, to: selectedDate }
    if (mode === 'month') return { from: startOfMonth(year, month), to: endOfMonth(year, month) }
    return { from: fromDate <= toDate ? fromDate : toDate, to: fromDate <= toDate ? toDate : fromDate }
  }, [fromDate, mode, month, selectedDate, toDate, year])

  const machineNameById = useMemo(
    () => Object.fromEntries(machines.map(machine => [machine.id, machine.name])),
    [machines]
  )
  const machineTargetById = useMemo(
    () => Object.fromEntries(machines.map(machine => [machine.id, machine.target_per_hour])),
    [machines]
  )

  useEffect(() => {
    load()
    channel.current?.unsubscribe()
    channel.current = supabase.channel('manager-control')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machines' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, load)
      .subscribe()
    return () => { channel.current?.unsubscribe() }
  }, [queryRange.from, queryRange.to])

  const load = async () => {
    setLoading(true)

    const [mRes, sRes, rRes] = await Promise.all([
      supabase.from('machines').select('*').eq('is_active', true).order('code'),
      supabase
        .from('shifts')
        .select('*, operator_1:profiles!operator_1_id(full_name), operator_2:profiles!operator_2_id(full_name)')
        .is('ended_at', null),
      supabase
        .from('hourly_reports')
        .select('*, operator:profiles!operator_id(full_name), shift:shifts!shift_id(shift_type, shift_date)')
        .gte('report_date', queryRange.from)
        .lte('report_date', queryRange.to)
        .is('deleted_at', null)
        .order('report_date', { ascending: false })
        .order('hour_start', { ascending: false })
    ])

    const staleShifts = ((sRes.data ?? []) as ActiveShift[]).filter(s =>
      isShiftPastAutoClose(s.shift_date, s.shift_type as ShiftType)
    )
    if (staleShifts.length) {
      await Promise.all(staleShifts.map(s => supabase
        .from('shifts')
        .update({ ended_at: getShiftAutoCloseAt(s.shift_date, s.shift_type as ShiftType).toISOString() })
        .eq('id', s.id)
      ))
    }

    setMachines((mRes.data ?? []) as Machine[])
    setActiveShifts(((sRes.data ?? []) as ActiveShift[]).filter(s =>
      !isShiftPastAutoClose(s.shift_date, s.shift_type as ShiftType)
    ))
    setReports((rRes.data ?? []) as ReportWithContext[])
    setLoading(false)
  }

  const filteredReports = useMemo(() => reports.filter(report => {
    const shiftType = one(report.shift)?.shift_type ?? ''
    const machineOk = machineFilter === 'all' || report.machine_id === machineFilter
    const shiftOk = shiftFilter === 'all' || shiftType === shiftFilter
    return machineOk && shiftOk
  }), [machineFilter, reports, shiftFilter])

  const dayReports = useMemo(
    () => filteredReports.filter(report => report.report_date === selectedDate),
    [filteredReports, selectedDate]
  )

  const groups = useMemo(() => {
    const rows = Object.values(filteredReports.reduce<Record<string, GroupRow>>((acc, report) => {
      const shiftType = one(report.shift)?.shift_type ?? '-'
      const machineName = machineNameById[report.machine_id] ?? '-'
      const key = `${report.report_date}|${shiftType}|${report.machine_id}`
      const accountableMin = reportAccountableMinutes(report)
      const target = effectiveTarget(machineTargetById[report.machine_id] ?? TARGET, accountableMin)

      if (!acc[key]) {
        acc[key] = {
          key,
          date: report.report_date,
          year: report.report_date.slice(0, 4),
          month: report.report_date.slice(5, 7),
          day: report.report_date.slice(8, 10),
          shiftType,
          machineName,
          good: 0,
          reject: 0,
          target: 0,
          machineRate: 0,
          goodRate: 0,
          runtime: 0,
          ready: 0,
          alarm: 0,
          downtime: 0,
          reports: 0,
          wEpq: 0,
          wEpqTotal: 0
        }
      }

      acc[key].good += report.good_count
      acc[key].reject += report.reject_count
      acc[key].target += target
      acc[key].runtime += report.runtime_min
      acc[key].ready += report.ready_min ?? 0
      acc[key].alarm += report.alarm_min ?? 0
      acc[key].downtime += reportDowntimeMinutes(report)
      acc[key].reports += 1
      acc[key].wEpq += reportWepq(report, machineTargetById[report.machine_id] ?? TARGET)
      return acc
    }, {}))

    return rows.map(row => ({
      ...row,
      wEpq: pct(row.good, row.target),
      wEpqTotal: pct(row.good + row.reject, row.target),
      machineRate: hourlyRate(row.good + row.reject, row.runtime + row.ready + row.alarm + row.downtime),
      goodRate: hourlyRate(row.good, row.runtime + row.ready + row.alarm + row.downtime)
    })).sort((a, b) =>
      b.date.localeCompare(a.date) ||
      a.machineName.localeCompare(b.machineName) ||
      a.shiftType.localeCompare(b.shiftType)
    )
  }, [filteredReports, machineNameById, machineTargetById])

  const kpi = useMemo(() => {
    const totalGood = filteredReports.reduce((sum, r) => sum + r.good_count, 0)
    const totalReject = filteredReports.reduce((sum, r) => sum + r.reject_count, 0)
    const runtime = filteredReports.reduce((sum, r) => sum + r.runtime_min, 0)
    const ready = filteredReports.reduce((sum, r) => sum + (r.ready_min ?? 0), 0)
    const alarm = filteredReports.reduce((sum, r) => sum + (r.alarm_min ?? 0), 0)
    const downtime = filteredReports.reduce((sum, r) => sum + reportDowntimeMinutes(r), 0)
    const totalTime = runtime + ready + alarm + downtime
    const target = filteredReports.reduce((sum, r) => sum + effectiveTarget(machineTargetById[r.machine_id] ?? TARGET, reportAccountableMinutes(r)), 0)
    const avgWepq = pct(totalGood, target)
    const wepqTotal = pct(totalGood + totalReject, target)
    const rejectPct = totalGood + totalReject ? Math.round(totalReject / (totalGood + totalReject) * 1000) / 10 : 0
    const availability = totalTime ? Math.round(runtime / totalTime * 100) : 0
    const machineRate = hourlyRate(totalGood + totalReject, totalTime)
    const goodRate = hourlyRate(totalGood, totalTime)

    return { totalGood, totalReject, runtime, ready, alarm, downtime, target, avgWepq, wepqTotal, rejectPct, availability, machineRate, goodRate }
  }, [filteredReports, machineTargetById])

  const dailyTrend = useMemo(() => {
    const map: Record<string, number> = {}
    filteredReports.forEach(report => {
      map[report.report_date] = (map[report.report_date] ?? 0) + report.good_count
    })
    const dates = Object.keys(map).sort()
    return {
      labels: dates.map(value => value.slice(5)),
      values: dates.map(value => map[value])
    }
  }, [filteredReports])

  const hourlyChart = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, hour) => hour).filter(hour =>
      dayReports.some(report => report.hour_start === hour)
    )
    const visibleMachines = machines.filter(machine =>
      machineFilter === 'all' || machine.id === machineFilter
    )
    return {
      labels: hours.map(hour => `${String(hour).padStart(2, '0')}:00`),
      datasets: visibleMachines.map((machine, index) => ({
        label: machine.name,
        data: hours.map(hour => dayReports
          .filter(report => report.machine_id === machine.id && report.hour_start === hour)
          .reduce((sum, report) => sum + report.good_count, 0)),
        backgroundColor: index % 2 === 0 ? 'rgba(59,130,246,0.78)' : 'rgba(34,197,94,0.78)',
        borderRadius: 4
      }))
    }
  }, [dayReports, machineFilter, machines])

  const openEdit = (report: ReportWithContext) => {
    setEditing(report)
    setEditError('')
    setEditState({
      good_count: String(report.good_count ?? 0),
      reject_count: String(report.reject_count ?? 0),
      runtime_min: String(report.runtime_min ?? 0),
      ready_min: String(report.ready_min ?? 0),
      alarm_min: String(report.alarm_min ?? 0),
      downtime_min: String(report.downtime_min ?? 0),
      failure_min: String(report.failure_min ?? 0),
      downtime_reason: report.downtime_reason ?? '',
      notes: report.notes ?? '',
      reason: ''
    })
  }

  const saveEdit = async () => {
    if (!editing || !editState) return
    setSaving(true)
    setEditError('')

    const runtimeMin = toInt(editState.runtime_min)
    const payload = {
      good_count: toInt(editState.good_count),
      reject_count: toInt(editState.reject_count),
      runtime_min: runtimeMin,
      ready_min: toInt(editState.ready_min),
      alarm_min: toInt(editState.alarm_min),
      downtime_min: toInt(editState.downtime_min),
      failure_min: toInt(editState.failure_min),
      target: effectiveTarget(
        machineTargetById[editing.machine_id] ?? TARGET,
        runtimeMin + toInt(editState.ready_min) + toInt(editState.alarm_min) + toInt(editState.downtime_min) + toInt(editState.failure_min)
      ),
      downtime_reason: editState.downtime_reason.trim() || null,
      notes: editState.notes.trim() || null
    }

    const { error } = await supabase.from('hourly_reports').update(payload).eq('id', editing.id)
    if (!error) {
      await logAudit('manager_report_update', 'hourly_reports', editing.id, {
        good_count: editing.good_count,
        reject_count: editing.reject_count,
        runtime_min: editing.runtime_min,
        ready_min: editing.ready_min,
        alarm_min: editing.alarm_min,
        downtime_min: editing.downtime_min,
        failure_min: editing.failure_min,
        downtime_reason: editing.downtime_reason,
        notes: editing.notes
      }, {
        ...payload,
        reason: editState.reason.trim() || 'korekta kierownika'
      })
      setEditing(null)
      setEditState(null)
      await load()
    } else {
      setEditError(error.message || 'Nie udalo sie zapisac korekty.')
    }
    setSaving(false)
  }

  const deleteReport = async () => {
    if (!editing || !editState) return
    const reason = editState.reason.trim()
    if (!reason) {
      setEditError('Wpisz powod usuniecia, zeby zostal slad w audycie.')
      return
    }

    setDeleting(true)
    setEditError('')

    const { error } = await supabase
      .from('hourly_reports')
      .update({
        deleted_at: new Date().toISOString(),
        notes: editing.notes
          ? `${editing.notes}\nUsuniete przez kierownika: ${reason}`
          : `Usuniete przez kierownika: ${reason}`
      })
      .eq('id', editing.id)

    if (!error) {
      await logAudit('manager_report_delete', 'hourly_reports', editing.id, {
        good_count: editing.good_count,
        reject_count: editing.reject_count,
        runtime_min: editing.runtime_min,
        ready_min: editing.ready_min,
        alarm_min: editing.alarm_min,
        downtime_min: editing.downtime_min,
        failure_min: editing.failure_min,
        downtime_reason: editing.downtime_reason,
        notes: editing.notes
      }, {
        deleted_at: true,
        reason
      })
      setEditing(null)
      setEditState(null)
      await load()
    } else {
      setEditError(error.message || 'Nie udalo sie usunac wpisu.')
    }

    setDeleting(false)
  }

  const dayTimeline = [...dayReports].sort((a, b) =>
    (machineNameById[a.machine_id] ?? '').localeCompare(machineNameById[b.machine_id] ?? '') ||
    (one(a.shift)?.shift_type ?? '').localeCompare(one(b.shift)?.shift_type ?? '') ||
    a.hour_start - b.hour_start
  )

  const selectedRangeLabel = mode === 'day'
    ? selectedDate
    : mode === 'month'
      ? `${year}-${month}`
      : `${queryRange.from} - ${queryRange.to}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Sterowanie produkcja</h1>
          <p className="text-navy-400 mt-1">
            {selectedRangeLabel} · <span className="font-mono text-white">{time}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400 font-bold">LIVE</span>
          </div>
          <button onClick={load} className="btn-secondary text-xs py-1.5 px-3">Odswiez</button>
        </div>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr_1fr] gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Zakres kontroli</div>
            <div className="flex flex-wrap gap-2">
              {([
                ['day', 'Konkretny dzien'],
                ['range', 'Okres od-do'],
                ['month', 'Miesiac i rok']
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={cn('btn text-xs py-2 px-3', mode === value ? 'btn-primary' : 'btn-secondary')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Data</div>
            {mode === 'day' && (
              <input className="input" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
            )}
            {mode === 'range' && (
              <div className="grid grid-cols-2 gap-2">
                <input className="input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                <input className="input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
              </div>
            )}
            {mode === 'month' && (
              <div className="grid grid-cols-2 gap-2">
                <select className="input" value={month} onChange={e => setMonth(e.target.value)}>
                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <input className="input" type="number" value={year} min="2024" max="2100" onChange={e => setYear(e.target.value)} />
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Zmiana i maszyna</div>
            <div className="grid grid-cols-2 gap-2">
              <select className="input" value={shiftFilter} onChange={e => setShiftFilter(e.target.value as ShiftFilter)}>
                <option value="all">Wszystkie zmiany</option>
                {SHIFTS.map(value => <option key={value} value={value}>Zmiana {value}</option>)}
              </select>
              <select className="input" value={machineFilter} onChange={e => setMachineFilter(e.target.value)}>
                <option value="all">Wszystkie maszyny</option>
                {machines.map(machine => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Produkcja', value: `${kpi.totalGood.toLocaleString('pl-PL')} szt`, sub: `norma czasu rozlicz. ${kpi.target.toLocaleString('pl-PL')} szt`, color: 'text-brand' },
          { label: 'W EPQ', value: kpi.avgWepq ? `${kpi.avgWepq}%` : '-', sub: 'dobre / norma czasu rozlicz.', color: efficiencyColor(kpi.avgWepq) },
          { label: 'WEPQ TOTAL', value: kpi.wepqTotal ? `${kpi.wepqTotal}%` : '-', sub: 'dobre + odrzut / norma', color: efficiencyColor(kpi.wepqTotal) },
          { label: 'Odrzut', value: `${kpi.rejectPct}%`, sub: `${kpi.totalReject.toLocaleString('pl-PL')} szt`, color: kpi.rejectPct > 5 ? 'text-red-400' : kpi.rejectPct > 2 ? 'text-amber-400' : 'text-green-400' }
        ].map(item => (
          <div key={item.label} className="kpi-card">
            <div className="kpi-label">{item.label}</div>
            <div className={cn('kpi-value', item.color)}>{loading ? '...' : item.value}</div>
            <div className="kpi-sub">{item.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: 'Czas pracy', value: minsToHHMM(kpi.runtime), sub: `gotowosc ${minsToHHMM(kpi.ready)}`, color: 'text-green-400' },
          { label: 'Wyd. maszyny', value: kpi.machineRate ? `${kpi.machineRate.toLocaleString('pl-PL')} szt/h` : '-', sub: 'dobre + odrzut / caly czas', color: 'text-cyan-400' },
          { label: 'Wyd. dobrych', value: kpi.goodRate ? `${kpi.goodRate.toLocaleString('pl-PL')} szt/h` : '-', sub: 'zgodne / caly czas', color: 'text-green-400' },
          { label: 'Alarmy', value: minsToHHMM(kpi.alarm), sub: 'czas alarmow', color: kpi.alarm > 60 ? 'text-red-400' : 'text-amber-400' },
          { label: 'Postoje', value: minsToHHMM(kpi.downtime), sub: 'postoj + awaria', color: kpi.downtime > 60 ? 'text-red-400' : 'text-amber-400' },
          { label: 'Dostepnosc', value: kpi.availability ? `${kpi.availability}%` : '-', sub: 'praca / caly czas', color: efficiencyColor(kpi.availability) }
        ].map(item => (
          <div key={item.label} className="kpi-card">
            <div className="kpi-label">{item.label}</div>
            <div className={cn('kpi-value text-xl', item.color)}>{loading ? '...' : item.value}</div>
            <div className="kpi-sub">{item.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card xl:col-span-2">
          <div className="card-header">
            <div>
              <div className="card-title">Dzien / zmiana / maszyna</div>
              <div className="card-sub">Dane zapisane i pokazane w ukladzie rok, miesiac, dzien, zmiana, maszyna</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700">
                  {['Rok', 'Mc', 'Dzien', 'Zmiana', 'Maszyna', 'W EPQ', 'WEPQ TOTAL', 'Wyd. maszyny', 'Produkcja', 'Czas', 'Alarm', 'Postoj'].map(header => (
                    <th key={header} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 && (
                  <tr><td colSpan={12} className="py-8 text-center text-navy-500">Brak danych dla wybranego zakresu</td></tr>
                )}
                {groups.map(row => (
                  <tr key={row.key} className="border-b border-navy-800 hover:bg-navy-800/50">
                    <td className="py-2 px-3 font-mono text-navy-300">{row.year}</td>
                    <td className="py-2 px-3 font-mono text-navy-300">{row.month}</td>
                    <td className="py-2 px-3 font-mono text-white">{row.day}</td>
                    <td className="py-2 px-3 font-bold text-white">Zmiana {row.shiftType}</td>
                    <td className="py-2 px-3"><span className="status-info text-xs">{row.machineName}</span></td>
                    <td className={cn('py-2 px-3 font-bold font-mono', efficiencyColor(row.wEpq))}>{row.wEpq}%</td>
                    <td className={cn('py-2 px-3 font-bold font-mono', efficiencyColor(row.wEpqTotal))}>{row.wEpqTotal}%</td>
                    <td className="py-2 px-3 font-bold font-mono text-cyan-300">{row.machineRate.toLocaleString('pl-PL')}</td>
                    <td className="py-2 px-3 font-bold font-mono text-white">{row.good.toLocaleString('pl-PL')}</td>
                    <td className="py-2 px-3 font-mono text-green-400">{minsToHHMM(row.runtime)}</td>
                    <td className="py-2 px-3 font-mono text-red-400">{minsToHHMM(row.alarm)}</td>
                    <td className="py-2 px-3 font-mono text-amber-400">{minsToHHMM(row.downtime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Aktywne zmiany</div>
              <div className="card-sub">Kto teraz pracuje i gdzie</div>
            </div>
          </div>
          <div className="space-y-2">
            {activeShifts.length === 0 && <div className="text-center py-8 text-navy-500">Brak aktywnych zmian</div>}
            {activeShifts.map(shift => (
              <div key={shift.id} className="bg-navy-900 rounded-xl p-3 border border-navy-700">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-white">{machineNameById[shift.machine_id] ?? 'Maszyna'}</div>
                  <span className="status-ok text-xs">Zmiana {shift.shift_type}</span>
                </div>
                <div className="text-xs text-navy-400 mt-1">{shift.shift_date}</div>
                <div className="text-sm text-navy-200 mt-2">
                  {[shift.operator_1?.full_name, shift.operator_2?.full_name].filter(Boolean).join(' / ') || 'Brak operatorow'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header">
            <div><div className="card-title">Przyrost godzinowy</div><div className="card-sub">Odtwarzany dla wybranego dnia</div></div>
          </div>
          <div style={{ height: 220 }}>
            {hourlyChart.labels.length
              ? <Bar data={hourlyChart} options={CHART_OPTS as never} />
              : <div className="flex items-center justify-center h-full text-navy-500 text-sm">Brak raportow w tym dniu</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div><div className="card-title">Trend zakresu</div><div className="card-sub">Suma produkcji dzien po dniu</div></div>
          </div>
          <div style={{ height: 220 }}>
            {dailyTrend.labels.length
              ? <Line data={{
                labels: dailyTrend.labels,
                datasets: [{ label: 'Produkcja', data: dailyTrend.values, borderColor: '#3B82F6', tension: 0.35, pointRadius: 3 }]
              }} options={CHART_OPTS as never} />
              : <div className="flex items-center justify-center h-full text-navy-500 text-sm">Brak trendu</div>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Odtworzenie calego dnia</div>
            <div className="card-sub">{selectedDate} · kolejnosc wpisow po maszynie, zmianie i godzinie</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary text-xs py-1.5 px-3"
              onClick={() => {
                setSelectedDate(addDays(selectedDate, -1))
                setMode('day')
              }}
            >
              Poprzedni
            </button>
            <button
              className="btn-secondary text-xs py-1.5 px-3"
              onClick={() => {
                const next = addDays(selectedDate, 1)
                setSelectedDate(next > dateISO ? dateISO : next)
                setMode('day')
              }}
            >
              Nastepny
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {dayTimeline.length === 0 && <div className="md:col-span-2 xl:col-span-3 text-center py-8 text-navy-500">Brak wpisow w wybranym dniu</div>}
          {dayTimeline.map(report => {
            const eff = reportWepq(report, machineTargetById[report.machine_id] ?? TARGET)
            const machineRate = hourlyRate(report.good_count + report.reject_count, reportAccountableMinutes(report))
            return (
              <div key={report.id} className="bg-navy-900 rounded-xl p-3 border border-navy-700">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-white font-bold">{report.hour_block}</div>
                  <div className={cn('font-mono font-bold', efficiencyColor(eff))}>{eff}%</div>
                </div>
                <div className="text-xs text-navy-400 mt-1">
                  {machineNameById[report.machine_id] ?? '-'} · Zmiana {one(report.shift)?.shift_type ?? '-'} · {one(report.operator)?.full_name ?? '-'}
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                  <div><div className="text-xs text-navy-500">szt</div><div className="font-mono font-bold text-white">{report.good_count}</div></div>
                  <div><div className="text-xs text-navy-500">odrz</div><div className="font-mono font-bold text-red-400">{report.reject_count}</div></div>
                  <div><div className="text-xs text-navy-500">praca</div><div className="font-mono font-bold text-green-400">{minsToHHMM(report.runtime_min)}</div></div>
                  <div><div className="text-xs text-navy-500">alarm</div><div className="font-mono font-bold text-amber-400">{minsToHHMM(report.alarm_min ?? 0)}</div></div>
                </div>
                <div className="mt-3 rounded-lg bg-navy-800 px-3 py-2 text-xs text-navy-300">
                  Wydajnosc maszyny: <span className="font-mono font-bold text-cyan-300">{machineRate.toLocaleString('pl-PL')} szt/h</span>
                </div>
                <div className="h-1.5 bg-navy-800 rounded-full overflow-hidden mt-3">
                  <div className={cn('h-full rounded-full', efficiencyBg(eff))} style={{ width: `${Math.min(eff, 120)}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Raporty do kontroli i korekty</div>
            <div className="card-sub">{filteredReports.length} wpisow w aktualnym widoku</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                {['Data', 'Godzina', 'Maszyna', 'Zmiana', 'Operator', 'W EPQ', 'Wyd. maszyny', 'Szt', 'Odrzut', 'Praca', 'Alarm', 'Postoj', 'Akcja'].map(header => (
                  <th key={header} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredReports.length === 0 && (
                <tr><td colSpan={13} className="py-8 text-center text-navy-500">Brak raportow do pokazania</td></tr>
              )}
              {filteredReports.map(report => {
                const eff = reportWepq(report, machineTargetById[report.machine_id] ?? TARGET)
                const machineRate = hourlyRate(report.good_count + report.reject_count, reportAccountableMinutes(report))
                return (
                  <tr key={report.id} className="border-b border-navy-800 hover:bg-navy-800/50">
                    <td className="py-2 px-3 font-mono text-xs text-navy-300">{report.report_date}</td>
                    <td className="py-2 px-3 font-mono text-xs text-white">{report.hour_block}</td>
                    <td className="py-2 px-3"><span className="status-info text-xs">{machineNameById[report.machine_id] ?? '-'}</span></td>
                    <td className="py-2 px-3 font-bold text-white">Zmiana {one(report.shift)?.shift_type ?? '-'}</td>
                    <td className="py-2 px-3 text-navy-200 max-w-[150px] truncate">{one(report.operator)?.full_name ?? '-'}</td>
                    <td className={cn('py-2 px-3 font-bold font-mono', efficiencyColor(eff))}>{eff}%</td>
                    <td className="py-2 px-3 font-bold font-mono text-cyan-300">{machineRate.toLocaleString('pl-PL')}</td>
                    <td className="py-2 px-3 font-bold font-mono text-white">{report.good_count}</td>
                    <td className="py-2 px-3 font-mono text-red-400">{report.reject_count}</td>
                    <td className="py-2 px-3 font-mono text-green-400">{minsToHHMM(report.runtime_min)}</td>
                    <td className="py-2 px-3 font-mono text-amber-400">{minsToHHMM(report.alarm_min ?? 0)}</td>
                    <td className="py-2 px-3 font-mono text-navy-300">{minsToHHMM(reportDowntimeMinutes(report))}</td>
                    <td className="py-2 px-3">
                      <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => openEdit(report)}>Edytuj</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && editState && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="card-header">
              <div>
                <div className="card-title">Korekta wpisu kierownika</div>
                <div className="card-sub">
                  {editing.report_date} · {editing.hour_block} · {machineNameById[editing.machine_id] ?? '-'} · Zmiana {one(editing.shift)?.shift_type ?? '-'}
                </div>
              </div>
              <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => { setEditing(null); setEditError('') }}>Zamknij</button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ['good_count', 'Sztuki dobre'],
                ['reject_count', 'Odrzut'],
                ['runtime_min', 'Praca min'],
                ['ready_min', 'Gotowosc min'],
                ['alarm_min', 'Alarm min'],
                ['downtime_min', 'Postoj min'],
                ['failure_min', 'Awaria min']
              ].map(([key, label]) => (
                <label key={key} className="block">
                  <span className="text-xs text-navy-400 font-bold uppercase tracking-wider">{label}</span>
                  <input
                    className="input mt-1"
                    type="number"
                    min="0"
                    value={editState[key as keyof EditState]}
                    onChange={e => setEditState({ ...editState, [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <label className="block">
                <span className="text-xs text-navy-400 font-bold uppercase tracking-wider">Powod postoju</span>
                <input className="input mt-1" value={editState.downtime_reason} onChange={e => setEditState({ ...editState, downtime_reason: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-xs text-navy-400 font-bold uppercase tracking-wider">Powod korekty</span>
                <input className="input mt-1" placeholder="np. blad operatora, korekta licznika" value={editState.reason} onChange={e => setEditState({ ...editState, reason: e.target.value })} />
              </label>
            </div>

            <label className="block mt-3">
              <span className="text-xs text-navy-400 font-bold uppercase tracking-wider">Notatka</span>
              <textarea className="input mt-1 min-h-[90px]" value={editState.notes} onChange={e => setEditState({ ...editState, notes: e.target.value })} />
            </label>

            {editError && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {editError}
              </div>
            )}

            <div className="flex flex-wrap justify-between gap-2 mt-5">
              <button
                className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 font-bold text-red-300 transition-all hover:bg-red-500/20 disabled:opacity-50"
                onClick={deleteReport}
                disabled={saving || deleting}
              >
                {deleting ? 'Usuwanie...' : 'Usun wpis'}
              </button>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => { setEditing(null); setEditError('') }} disabled={saving || deleting}>Anuluj</button>
                <button className="btn-primary" onClick={saveEdit} disabled={saving || deleting}>{saving ? 'Zapisywanie...' : 'Zapisz korekte'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
