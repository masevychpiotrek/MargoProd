import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase, logAudit } from '@/lib/supabase'
import { useClock } from '@/hooks/useClock'
import { useAuthStore } from '@/stores/authStore'
import { TimeInput } from '@/components/shared/FormControls'
import {
  PRODUCTION_DAY_HOURS,
  cn,
  compareProductionHours,
  efficiencyBg,
  efficiencyColor,
  getProductionDate,
  getShiftAutoCloseAt,
  isProductionHourAtOrBefore,
  isShiftPastAutoClose,
  productionHourOrder
} from '@/lib/utils'
import { reportStationLabel, problemCategoryLabel, issueStatusLabel, ISSUE_STATUSES } from '@/lib/issueReports'
import { computeOee, planAttainmentPct, WORLD_CLASS_OEE } from '@/lib/oee'
import type { HourlyReport, Machine, Profile, Shift, ShiftType } from '@/types/database'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend } from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

const TARGET = 3200 // hourly machine performance base
const TARGET_PER_SHIFT = 18000
const SHIFTS = ['I', 'II', 'III'] as const
const MONTHLY_TARGET_STORAGE_PREFIX = 'margoprod.monthly-target'
const DEFAULT_JUNE_PLAN = 1600000

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#8892AA', font: { size: 11 }, boxWidth: 12 } } },
  scales: {
    y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6B7A99' } },
    x: { grid: { display: false }, ticks: { color: '#6B7A99' } }
  }
}

const PERCENT_CHART_OPTS = {
  ...CHART_OPTS,
  scales: {
    ...CHART_OPTS.scales,
    y: {
      ...CHART_OPTS.scales.y,
      beginAtZero: true,
      ticks: {
        ...CHART_OPTS.scales.y.ticks,
        callback: (value: string | number) => `${value}%`
      }
    }
  }
}

const MONTHLY_PERCENT_CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#8892AA', font: { size: 11 }, boxWidth: 12 } } },
  scales: {
    y: {
      beginAtZero: true,
      max: 120,
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: {
        color: '#7B89A8',
        callback: (value: string | number) => `${Number(value).toFixed(0)}%`
      }
    },
    x: { grid: { display: false }, ticks: { color: '#7B89A8', maxRotation: 55, minRotation: 55 } }
  }
}

type Mode = 'day' | 'range' | 'month'
type ShiftFilter = 'all' | ShiftType
type ManagerTab = 'production' | 'monthly' | 'operators' | 'forecast'

type Recommendation = {
  title: string
  body: string
  tone: 'red' | 'amber' | 'green' | 'blue'
  actionLabel: string
  action: 'missing-time' | 'missing-reason' | 'reject' | 'low-output' | 'losses' | 'none'
  groupKey?: string
  reportId?: string
}

type ReportWithContext = Omit<HourlyReport, 'operator'> & {
  ready_min?: number
  alarm_min?: number
  counter_good?: number
  counter_reject?: number
  counter_runtime?: number
  counter_ready?: number
  counter_alarm?: number
  operator?: { full_name: string } | { full_name: string }[] | null
  shift?: { shift_type: string; shift_date?: string } | { shift_type: string; shift_date?: string }[] | null
}

type ShiftWithContext = Shift & {
  operator_1?: { full_name: string } | null
  operator_2?: { full_name: string } | null
}

type ReportGroup = {
  good: number
  reject: number
  target: number
  reports: number
  lowOutput: number
  highReject: number
  missingLowOutputReason: number
  missingRejectReason: number
}

type GroupRow = {
  key: string
  date: string
  year: string
  month: string
  day: string
  shiftType: string
  machineId: string
  machineName: string
  good: number
  reject: number
  target: number
  machineRate: number | null
  goodRate: number | null
  runtime: number
  ready: number
  alarm: number
  downtime: number
  reports: number
  hasTimeSummary: boolean
  summaryClosed: boolean
  rejectPct: number
  wEpq: number
  wEpqTotal: number
  availabilityPct: number | null
  performancePct: number | null
  qualityPct: number
  oeePct: number | null
  lowOutput: number
  highReject: number
  missingLowOutputReason: number
  missingRejectReason: number
  suggestion: string
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
  reject_reason: string
  downtime_status: string
  reject_status: string
  notes: string
  reason: string
}

type ShiftEditState = {
  operator1Id: string
  operator2Id: string
  runtimeMin: string
  readyMin: string
  alarmMin: string
  downtimeMin: string
  notes: string
  reason: string
}

type CounterRow = Pick<ReportWithContext, 'id' | 'hour_start' | 'good_count' | 'reject_count'>

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

function hourLabel(hour: number) {
  return `${String(hour % 24).padStart(2, '0')}:00`
}

function reportEndHourLabel(report: Pick<ReportWithContext, 'hour_start'>) {
  return hourLabel(report.hour_start + 1)
}

function reportBlockLabel(report: Pick<ReportWithContext, 'hour_start' | 'hour_block'>) {
  return report.hour_block || `${hourLabel(report.hour_start)}-${hourLabel(report.hour_start + 1)}`
}

function lastProductionHour(reports: Pick<ReportWithContext, 'hour_start'>[]) {
  if (!reports.length) return null
  return reports.reduce((latest, report) =>
    productionHourOrder(report.hour_start) > productionHourOrder(latest) ? report.hour_start : latest,
  reports[0].hour_start)
}

function toInt(value: string) {
  const parsed = Number.parseInt(value || '0', 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function parseOptionalHHMM(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^(\d{1,2}):([0-5]\d)$/)
  if (!match) return Number.NaN
  return Number(match[1]) * 60 + Number(match[2])
}

function hhmmTotal(...values: string[]) {
  return values.reduce((sum, value) => {
    const parsed = parseOptionalHHMM(value)
    return sum + (typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0)
  }, 0)
}

function pct(value: number, target: number) {
  return target > 0 ? Math.round(value / target * 100) : 0
}

function pct1(value: number, target: number) {
  return target > 0 ? Math.round(value / target * 1000) / 10 : 0
}

function pctValue(value: number, target: number) {
  return target > 0 ? Math.round(value / target * 1000) / 10 : 0
}

function monthTargetKey(year: string, month: string) {
  return `${MONTHLY_TARGET_STORAGE_PREFIX}.${year}-${month}`
}

function defaultMonthlyTarget(month: string) {
  return month === '06' ? String(DEFAULT_JUNE_PLAN) : ''
}

function readStoredMonthlyTarget(year: string, month: string) {
  if (typeof window === 'undefined') return defaultMonthlyTarget(month)
  return window.localStorage.getItem(monthTargetKey(year, month)) ?? defaultMonthlyTarget(month)
}

function isWorkday(date: Date) {
  const day = date.getDay()
  return day >= 1 && day <= 5
}

function workdaysOfMonth(year: string, month: string) {
  const days: string[] = []
  const totalDays = new Date(Number(year), Number(month), 0).getDate()
  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(Number(year), Number(month) - 1, day, 12)
    if (isWorkday(date)) days.push(iso(date))
  }
  return days
}

function calendarDaysOfMonth(year: string, month: string) {
  const days: { date: string; label: string; workday: boolean }[] = []
  const totalDays = new Date(Number(year), Number(month), 0).getDate()
  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(Number(year), Number(month) - 1, day, 12)
    days.push({
      date: iso(date),
      label: String(day).padStart(2, '0'),
      workday: isWorkday(date)
    })
  }
  return days
}

function previousMonth(year: string, month: string) {
  const date = new Date(Number(year), Number(month) - 2, 1, 12)
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0')
  }
}

function hourlyRate(pieces: number, runtimeMin: number) {
  return runtimeMin > 0 ? Math.round(pieces / runtimeMin * 60) : null
}

function reportTarget(_report: ReportWithContext, _machineRate: number) {
  return TARGET
}

function reportWepq(report: ReportWithContext, ratePerHour: number) {
  const target = reportTarget(report, ratePerHour)
  return target > 0 ? Math.round(report.good_count / target * 100) : 0
}

function reportRejectPct(report: ReportWithContext) {
  return pct1(report.reject_count, report.good_count + report.reject_count)
}

function hasShiftSummary(shift?: ShiftWithContext) {
  if (!shift) return false
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

function groupSuggestion(row: Omit<GroupRow, 'suggestion'>) {
  if (!row.hasTimeSummary) return 'Brakuje rozliczenia konca zmiany'
  if (row.rejectPct > 5) return 'Sprawdz przyczyne odrzutu i stacje problemowe'
  if (row.wEpq > 0 && row.wEpq < 80) return 'Zweryfikuj tempo pracy i komentarze do wyniku'
  if (row.missingLowOutputReason || row.missingRejectReason) return 'Uzupelnij brakujace wyjasnienia operatora'
  if (row.downtime >= 60 || row.alarm >= 60) return 'Przejrzyj alarmy i postoje z tej zmiany'
  return 'Wynik bez pilnej reakcji'
}

export default function ManagerDashboard() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { time } = useClock()
  const productionDate = getProductionDate()
  const canEdit = profile?.role === 'manager' || profile?.role === 'admin'
  const [machines, setMachines] = useState<Machine[]>([])
  const [operators, setOperators] = useState<Pick<Profile, 'id' | 'full_name'>[]>([])
  const [activeShifts, setActiveShifts] = useState<ShiftWithContext[]>([])
  const [shiftSummaries, setShiftSummaries] = useState<ShiftWithContext[]>([])
  const [reports, setReports] = useState<ReportWithContext[]>([])
  const [historyReports, setHistoryReports] = useState<ReportWithContext[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editError, setEditError] = useState('')
  const [mode, setMode] = useState<Mode>('day')
  const [selectedDate, setSelectedDate] = useState(productionDate)
  const [fromDate, setFromDate] = useState(productionDate)
  const [toDate, setToDate] = useState(productionDate)
  const [month, setMonth] = useState(productionDate.slice(5, 7))
  const [year, setYear] = useState(productionDate.slice(0, 4))
  const [monthlyTargetInput, setMonthlyTargetInput] = useState(() =>
    readStoredMonthlyTarget(productionDate.slice(0, 4), productionDate.slice(5, 7))
  )
  const [monthlySaveMessage, setMonthlySaveMessage] = useState('')
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all')
  const [machineFilter, setMachineFilter] = useState('all')
  const [editing, setEditing] = useState<ReportWithContext | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [editingShift, setEditingShift] = useState<ShiftWithContext | null>(null)
  const [shiftEditState, setShiftEditState] = useState<ShiftEditState | null>(null)
  const [shiftEditError, setShiftEditError] = useState('')
  const [shiftSaving, setShiftSaving] = useState(false)
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const loadRequestSeq = useRef(0)
  const groupsTableRef = useRef<HTMLDivElement>(null)
  const dayTimelineRef = useRef<HTMLDivElement>(null)
  const activeTab: ManagerTab = location.pathname.endsWith('/monthly')
    ? 'monthly'
    : location.pathname.endsWith('/operators')
      ? 'operators'
      : location.pathname.endsWith('/forecast')
        ? 'forecast'
        : 'production'

  const queryRange = useMemo(() => {
    if (activeTab === 'monthly') return { from: startOfMonth(year, month), to: endOfMonth(year, month) }
    if (mode === 'day') return { from: selectedDate, to: selectedDate }
    if (mode === 'month') return { from: startOfMonth(year, month), to: endOfMonth(year, month) }
    return { from: fromDate <= toDate ? fromDate : toDate, to: fromDate <= toDate ? toDate : fromDate }
  }, [activeTab, fromDate, mode, month, selectedDate, toDate, year])

  // Plan miesieczny z bazy (wspolny dla wszystkich kierownikow). Gdy w bazie
  // nie ma jeszcze wpisu - miekki fallback do starej wartosci z localStorage.
  useEffect(() => {
    let cancelled = false
    setMonthlySaveMessage('')
    void (async () => {
      const { data } = await supabase
        .from('monthly_production_targets')
        .select('target_qty')
        .eq('year', Number(year))
        .eq('month', Number(month))
        .is('machine_id', null)
        .maybeSingle()
      if (cancelled) return
      setMonthlyTargetInput(data?.target_qty != null
        ? String(Math.round(Number(data.target_qty)))
        : readStoredMonthlyTarget(year, month))
    })()
    return () => { cancelled = true }
  }, [month, year])

  const machineNameById = useMemo(
    () => Object.fromEntries(machines.map(machine => [machine.id, machine.name])),
    [machines]
  )
  // Norma godzinowa per-maszyna z konfiguracji (target_per_hour); stala TARGET
  // tylko jako fallback. Wczesniej wszystkie maszyny miały narzuconą tę samą 3200.
  const machineTargetById = useMemo(
    () => Object.fromEntries(machines.map(machine => [
      machine.id,
      machine.target_per_hour && machine.target_per_hour > 0 ? machine.target_per_hour : TARGET
    ])),
    [machines]
  )

  useEffect(() => {
    load()
    channel.current?.unsubscribe()
    channel.current = supabase.channel('manager-control')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machines' }, load)
      .subscribe()
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', refreshOnFocus)

    return () => {
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', refreshOnFocus)
      channel.current?.unsubscribe()
    }
  }, [queryRange.from, queryRange.to])

  const load = async () => {
    const requestId = ++loadRequestSeq.current
    setLoading(true)

    const historyFrom = addDays(queryRange.from, -75)
    const [mRes, pRes, activeRes, shiftRes, rRes, historyRes] = await Promise.all([
      supabase.from('machines').select('*').eq('is_active', true).order('code'),
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'operator')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('full_name'),
      supabase
        .from('shifts')
        .select('*, operator_1:profiles!operator_1_id(full_name), operator_2:profiles!operator_2_id(full_name)')
        .is('ended_at', null),
      supabase
        .from('shifts')
        .select('*, operator_1:profiles!operator_1_id(full_name), operator_2:profiles!operator_2_id(full_name)')
        .gte('shift_date', queryRange.from)
        .lte('shift_date', queryRange.to)
        .order('shift_date', { ascending: false }),
      supabase
        .from('hourly_reports')
        .select('*, operator:profiles!operator_id(full_name), shift:shifts!shift_id(shift_type, shift_date)')
        .gte('report_date', queryRange.from)
        .lte('report_date', queryRange.to)
        .is('deleted_at', null)
        .order('report_date', { ascending: false })
        .order('hour_start', { ascending: false }),
      supabase
        .from('hourly_reports')
        .select('*, operator:profiles!operator_id(full_name), shift:shifts!shift_id(shift_type, shift_date)')
        .gte('report_date', historyFrom)
        .lt('report_date', queryRange.from)
        .is('deleted_at', null)
        .order('report_date', { ascending: false })
        .order('hour_start', { ascending: false })
    ])

    if (requestId !== loadRequestSeq.current) return

    const staleShifts = ((activeRes.data ?? []) as ShiftWithContext[]).filter(s =>
      isShiftPastAutoClose(s.shift_date, s.shift_type as ShiftType)
    )
    if (staleShifts.length) {
      await Promise.all(staleShifts.map(s => supabase
        .from('shifts')
        .update({ ended_at: getShiftAutoCloseAt(s.shift_date, s.shift_type as ShiftType).toISOString() })
        .eq('id', s.id)
      ))
    }

    if (!mRes.error) setMachines((mRes.data ?? []) as Machine[])
    if (!pRes.error) setOperators((pRes.data ?? []) as Pick<Profile, 'id' | 'full_name'>[])
    if (!activeRes.error) {
      setActiveShifts(((activeRes.data ?? []) as ShiftWithContext[]).filter(s =>
        !isShiftPastAutoClose(s.shift_date, s.shift_type as ShiftType)
      ))
    }
    if (!shiftRes.error) setShiftSummaries((shiftRes.data ?? []) as ShiftWithContext[])
    if (!rRes.error) setReports((rRes.data ?? []) as ReportWithContext[])
    if (!historyRes.error) setHistoryReports((historyRes.data ?? []) as ReportWithContext[])
    setLoading(false)
  }

  const filteredReports = useMemo(() => reports.filter(report => {
    const shiftType = one(report.shift)?.shift_type ?? ''
    const machineOk = machineFilter === 'all' || report.machine_id === machineFilter
    const shiftOk = shiftFilter === 'all' || shiftType === shiftFilter
    return machineOk && shiftOk
  }), [machineFilter, reports, shiftFilter])

  const filteredShifts = useMemo(() => shiftSummaries.filter(shift => {
    const machineOk = machineFilter === 'all' || shift.machine_id === machineFilter
    const shiftOk = shiftFilter === 'all' || shift.shift_type === shiftFilter
    return machineOk && shiftOk
  }), [machineFilter, shiftFilter, shiftSummaries])

  const shiftByGroupKey = useMemo(() => Object.fromEntries(
    filteredShifts.map(shift => [`${shift.shift_date}|${shift.shift_type}|${shift.machine_id}`, shift])
  ), [filteredShifts])

  const dayReports = useMemo(
    () => filteredReports.filter(report => report.report_date === selectedDate),
    [filteredReports, selectedDate]
  )

  const groups = useMemo(() => {
    const reportGroups = filteredReports.reduce<Record<string, ReportGroup>>((acc, report) => {
      const shiftType = one(report.shift)?.shift_type ?? '-'
      const key = `${report.report_date}|${shiftType}|${report.machine_id}`
      const rate = machineTargetById[report.machine_id] ?? TARGET
      const eff = reportWepq(report, rate)
      const reject = reportRejectPct(report)

      if (!acc[key]) {
        acc[key] = {
          good: 0,
          reject: 0,
          target: 0,
          reports: 0,
          lowOutput: 0,
          highReject: 0,
          missingLowOutputReason: 0,
          missingRejectReason: 0
        }
      }

      acc[key].good += report.good_count
      acc[key].reject += report.reject_count
      acc[key].target = TARGET_PER_SHIFT
      acc[key].reports += 1
      if (eff > 0 && eff < 80) {
        acc[key].lowOutput += 1
        if (!report.downtime_reason?.trim()) acc[key].missingLowOutputReason += 1
      }
      if (reject > 5) {
        acc[key].highReject += 1
        if (!report.reject_reason?.trim()) acc[key].missingRejectReason += 1
      }
      return acc
    }, {})

    const shiftByKey = filteredShifts.reduce<Record<string, ShiftWithContext>>((acc, shift) => {
      acc[`${shift.shift_date}|${shift.shift_type}|${shift.machine_id}`] = shift
      return acc
    }, {})

    const keys = Array.from(new Set([...Object.keys(reportGroups), ...Object.keys(shiftByKey)]))
    return keys.map(key => {
      const [date, shiftType, machineId] = key.split('|')
      const reportGroup = reportGroups[key]
      const shift = shiftByKey[key]
      const hasSummary = hasShiftSummary(shift)
      // JEDNO zrodlo prawdy dla sztuk: suma wpisow godzinowych. Podsumowanie
      // zmiany (summary_*) sluzy tylko jako fallback, gdy nie ma zadnego wpisu
      // (dane legacy) - dzieki temu korekta wpisu przez kierownika jest
      // natychmiast widoczna, a wszystkie ekrany licza tak samo.
      const good = reportGroup ? reportGroup.good : shift?.summary_good_count ?? 0
      const reject = reportGroup ? reportGroup.reject : shift?.summary_reject_count ?? 0
      // Czas bierzemy WYLACZNIE z podsumowania zmiany (wpisy godzinowe maja
      // sztuczny runtime_min=60) - to jedyne realne zrodlo rozkladu czasu.
      const runtime = hasSummary ? shift?.summary_runtime_min ?? 0 : 0
      const ready = hasSummary ? shift?.summary_ready_min ?? 0 : 0
      const alarm = hasSummary ? shift?.summary_alarm_min ?? 0 : 0
      const downtime = hasSummary ? shift?.summary_downtime_min ?? 0 : 0
      const target = reportGroup || shift ? TARGET_PER_SHIFT : 0
      const idealRate = machineTargetById[machineId] ?? TARGET
      const oee = computeOee({ good, reject, runtimeMin: runtime, readyMin: ready, alarmMin: alarm, downtimeMin: downtime, idealRatePerHour: idealRate })
      const base = {
        key,
        date,
        year: date.slice(0, 4),
        month: date.slice(5, 7),
        day: date.slice(8, 10),
        shiftType,
        machineId,
        machineName: machineNameById[machineId] ?? '-',
        good,
        reject,
        target,
        machineRate: hourlyRate(good + reject, runtime),
        goodRate: hourlyRate(good, runtime),
        runtime,
        ready,
        alarm,
        downtime,
        reports: reportGroup?.reports ?? 0,
        hasTimeSummary: hasSummary,
        summaryClosed: Boolean(shift?.ended_at),
        rejectPct: pct1(reject, good + reject),
        wEpq: pct(good, target),
        wEpqTotal: pct(good + reject, target),
        // OEE = Dostepnosc x Wydajnosc x Jakosc (standard przemyslowy).
        availabilityPct: oee.availabilityPct,
        performancePct: oee.performancePct,
        qualityPct: oee.qualityPct,
        oeePct: oee.oeePct,
        lowOutput: reportGroup?.lowOutput ?? 0,
        highReject: reportGroup?.highReject ?? 0,
        missingLowOutputReason: reportGroup?.missingLowOutputReason ?? 0,
        missingRejectReason: reportGroup?.missingRejectReason ?? 0
      }
      return { ...base, suggestion: groupSuggestion(base) }
    }).sort((a, b) =>
      b.date.localeCompare(a.date) ||
      a.machineName.localeCompare(b.machineName) ||
      a.shiftType.localeCompare(b.shiftType)
    )
  }, [filteredReports, filteredShifts, machineNameById, machineTargetById])

  const kpi = useMemo(() => {
    const totalGood = groups.reduce((sum, row) => sum + row.good, 0)
    const totalReject = groups.reduce((sum, row) => sum + row.reject, 0)
    const runtime = groups.reduce((sum, row) => sum + row.runtime, 0)
    const ready = groups.reduce((sum, row) => sum + row.ready, 0)
    const alarm = groups.reduce((sum, row) => sum + row.alarm, 0)
    const downtime = groups.reduce((sum, row) => sum + row.downtime, 0)
    const target = groups.reduce((sum, row) => sum + row.target, 0)
    const avgWepq = pct(totalGood, target)
    const wepqTotal = pct(totalGood + totalReject, target)
    const rejectPct = pct1(totalReject, totalGood + totalReject)
    const totalTime = runtime + ready + alarm + downtime
    const availability = totalTime ? Math.round(runtime / totalTime * 100) : 0
    const summarizedShifts = groups.filter(row => row.hasTimeSummary).length
    const missingTimeSummaries = groups.filter(row => !row.hasTimeSummary && row.reports > 0).length
    const machineRate = missingTimeSummaries ? null : hourlyRate(totalGood + totalReject, runtime)
    const goodRate = missingTimeSummaries ? null : hourlyRate(totalGood, runtime)
    const lowOutput = groups.reduce((sum, row) => sum + row.lowOutput, 0)
    const highReject = groups.reduce((sum, row) => sum + row.highReject, 0)
    const missingReasons = groups.reduce((sum, row) => sum + row.missingLowOutputReason + row.missingRejectReason, 0)

    // Zbiorcze OEE - liczone z sum po grupach majacych rozliczenie czasu.
    // Wydajnosc wazona: laczne sztuki / suma "idealnego wyjscia" kazdej grupy
    // (runtime x norma tej maszyny), zeby rozne normy maszyn byly uwzglednione.
    const timedGroups = groups.filter(row => row.hasTimeSummary && row.runtime > 0)
    const timedRuntime = timedGroups.reduce((sum, row) => sum + row.runtime, 0)
    const timedPlanned = timedGroups.reduce((sum, row) => sum + row.runtime + row.ready + row.alarm + row.downtime, 0)
    const timedGood = timedGroups.reduce((sum, row) => sum + row.good, 0)
    const timedReject = timedGroups.reduce((sum, row) => sum + row.reject, 0)
    const idealOutput = timedGroups.reduce((sum, row) =>
      sum + row.runtime / 60 * (machineTargetById[row.machineId] ?? TARGET), 0)
    const oeeAvailability = timedPlanned > 0 ? Math.round(timedRuntime / timedPlanned * 1000) / 10 : null
    const oeePerformance = idealOutput > 0 ? Math.min(100, Math.round((timedGood + timedReject) / idealOutput * 1000) / 10) : null
    const oeeQuality = (timedGood + timedReject) > 0 ? Math.round(timedGood / (timedGood + timedReject) * 1000) / 10 : null
    const oee = oeeAvailability != null && oeePerformance != null && oeeQuality != null
      ? Math.round(oeeAvailability / 100 * (oeePerformance / 100) * (oeeQuality / 100) * 1000) / 10
      : null

    return {
      totalGood,
      totalReject,
      runtime,
      ready,
      alarm,
      downtime,
      target,
      avgWepq,
      wepqTotal,
      rejectPct,
      availability,
      oee,
      oeeAvailability,
      oeePerformance,
      oeeQuality,
      machineRate,
      goodRate,
      summarizedShifts,
      missingTimeSummaries,
      lowOutput,
      highReject,
      missingReasons
    }
  }, [groups])

  const recommendations = useMemo(() => {
    const items: Recommendation[] = []
    const missingTime = groups.find(row => !row.hasTimeSummary && row.reports > 0)
    const worstReject = [...groups].filter(row => row.rejectPct > 0).sort((a, b) => b.rejectPct - a.rejectPct)[0]
    const worstWepq = [...groups].filter(row => row.wEpq > 0).sort((a, b) => a.wEpq - b.wEpq)[0]
    const missingReasonReport = filteredReports.find(report => {
      const wepq = reportWepq(report, machineTargetById[report.machine_id] ?? TARGET)
      const reject = reportRejectPct(report)
      return (wepq > 0 && wepq < 80 && !report.downtime_reason?.trim()) ||
        (reject > 5 && !report.reject_reason?.trim())
    })
    const worstLoss = [...groups].filter(row => row.alarm + row.downtime > 0).sort((a, b) =>
      (b.alarm + b.downtime) - (a.alarm + a.downtime)
    )[0]

    if (kpi.missingTimeSummaries) {
      items.push({
        title: 'Domknij rozliczenia zmian',
        body: `${kpi.missingTimeSummaries} zm. ma wpisy produkcji, ale brakuje czasu pracy z konca zmiany.`,
        tone: 'amber',
        actionLabel: 'Otworz korekte zmiany',
        action: 'missing-time',
        groupKey: missingTime?.key
      })
    }
    if (kpi.rejectPct > 5 && worstReject) {
      items.push({
        title: 'Odrzut przekracza prog 5%',
        body: `Najpierw sprawdz ${worstReject.machineName}, zmiana ${worstReject.shiftType}: ${worstReject.rejectPct}% odrzutu.`,
        tone: 'red',
        actionLabel: 'Pokaz te zmiane',
        action: 'reject',
        groupKey: worstReject.key
      })
    }
    if (kpi.avgWepq > 0 && kpi.avgWepq < 85 && worstWepq) {
      items.push({
        title: 'Wydajnosc wymaga reakcji',
        body: `Najslabszy wynik ma ${worstWepq.machineName}, zmiana ${worstWepq.shiftType}: W EPQ ${worstWepq.wEpq}%.`,
        tone: 'amber',
        actionLabel: 'Pokaz slaby wynik',
        action: 'low-output',
        groupKey: worstWepq.key
      })
    }
    if (kpi.missingReasons) {
      items.push({
        title: 'Brakuje wyjasnien',
        body: `${kpi.missingReasons} wpisow ma niski wynik lub duzy odrzut bez pelnego komentarza.`,
        tone: 'blue',
        actionLabel: 'Otworz wpis do uzupelnienia',
        action: 'missing-reason',
        reportId: missingReasonReport?.id
      })
    }
    if (kpi.alarm + kpi.downtime >= 60) {
      items.push({
        title: 'Sprawdz straty czasu',
        body: `Alarmy i postoje lacznie: ${minsToHHMM(kpi.alarm + kpi.downtime)}. Warto porownac z opisami awarii.`,
        tone: 'amber',
        actionLabel: 'Pokaz najwieksza strate',
        action: 'losses',
        groupKey: worstLoss?.key
      })
    }
    if (!items.length) {
      items.push({
        title: 'Brak pilnych odchylen',
        body: 'Dane nie pokazuja teraz krytycznego problemu. Kontroluj trend i zamkniecia zmian.',
        tone: 'green',
        actionLabel: 'Zostan w podsumowaniu',
        action: 'none'
      })
    }
    return items.slice(0, 4)
  }, [filteredReports, groups, kpi, machineTargetById])

  const dailyTrend = useMemo(() => {
    const map: Record<string, number> = {}
    groups.forEach(row => {
      map[row.date] = (map[row.date] ?? 0) + row.good
    })
    const dates = Object.keys(map).sort()
    return {
      labels: dates.map(value => value.slice(5)),
      values: dates.map(value => map[value])
    }
  }, [groups])

  const machineComparison = useMemo(() => {
    const map = groups.reduce<Record<string, {
      machineId: string
      machineName: string
      good: number
      reject: number
      target: number
      runtime: number
      missingTime: number
      rows: number
    }>>((acc, row) => {
      if (!acc[row.machineId]) {
        acc[row.machineId] = {
          machineId: row.machineId,
          machineName: row.machineName,
          good: 0,
          reject: 0,
          target: 0,
          runtime: 0,
          missingTime: 0,
          rows: 0
        }
      }
      acc[row.machineId].good += row.good
      acc[row.machineId].reject += row.reject
      acc[row.machineId].target += row.target
      acc[row.machineId].runtime += row.runtime
      if (!row.hasTimeSummary && row.reports > 0) acc[row.machineId].missingTime += 1
      acc[row.machineId].rows += 1
      return acc
    }, {})

    return Object.values(map)
      .filter(row => row.good > 0 || row.reject > 0 || row.target > 0)
      .map(row => ({
        ...row,
        wEpq: pct(row.good, row.target),
        wEpqTotal: pct(row.good + row.reject, row.target),
        rejectPct: pct1(row.reject, row.good + row.reject),
        machineRate: row.missingTime ? null : hourlyRate(row.good + row.reject, row.runtime)
      }))
      .sort((a, b) => b.wEpq - a.wEpq || a.rejectPct - b.rejectPct || a.machineName.localeCompare(b.machineName))
  }, [groups])

  const machineEfficiencyChart = useMemo(() => ({
    labels: machineComparison.map(row => row.machineName),
    datasets: [
      {
        label: 'W EPQ',
        data: machineComparison.map(row => row.wEpq),
        backgroundColor: 'rgba(34,197,94,0.78)',
        borderRadius: 4
      },
      {
        label: 'WEPQ TOTAL',
        data: machineComparison.map(row => row.wEpqTotal),
        backgroundColor: 'rgba(59,130,246,0.78)',
        borderRadius: 4
      }
    ]
  }), [machineComparison])

  const machineRejectChart = useMemo(() => ({
    labels: machineComparison.map(row => row.machineName),
    datasets: [
      {
        label: 'Odrzut %',
        data: machineComparison.map(row => row.rejectPct),
        backgroundColor: machineComparison.map(row =>
          row.rejectPct > 5 ? 'rgba(248,113,113,0.82)' : row.rejectPct > 2 ? 'rgba(251,191,36,0.82)' : 'rgba(34,197,94,0.78)'
        ),
        borderRadius: 4
      }
    ]
  }), [machineComparison])

  const wepqHourlyDelta = useMemo(() => {
    const byMachine: Record<string, Array<{ hour: number; wepq: number }>> = {}

    dayReports.forEach(report => {
      const target = machineTargetById[report.machine_id] ?? TARGET
      const wepq = reportWepq(report, target)
      if (!byMachine[report.machine_id]) byMachine[report.machine_id] = []
      byMachine[report.machine_id].push({ hour: report.hour_start, wepq })
    })

    return machines
      .filter(machine => machineFilter === 'all' || machine.id === machineFilter)
      .map(machine => {
        const trend = (byMachine[machine.id] ?? []).sort((a, b) => compareProductionHours(a.hour, b.hour))
        if (trend.length < 2) return { machineId: machine.id, machineName: machine.name, avgDelta: null, trend }
        const deltas = trend.slice(1).map((point, index) => point.wepq - trend[index].wepq)
        const avgDelta = Math.round((deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length) * 10) / 10
        return { machineId: machine.id, machineName: machine.name, avgDelta, trend }
      })
      .filter(machine => machine.trend.length > 0)
  }, [dayReports, machineFilter, machineTargetById, machines])

  const wepqHourlyLineChart = useMemo(() => {
    const hours = PRODUCTION_DAY_HOURS.filter(hour =>
      dayReports.some(report => report.hour_start === hour)
    )
    const visibleMachines = machines.filter(machine => machineFilter === 'all' || machine.id === machineFilter)
    const colors = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444']

    return {
      labels: hours.map(hour => hourLabel(hour + 1)),
      datasets: visibleMachines.map((machine, index) => ({
        label: machine.name,
        data: hours.map(hour => {
          const reportsForHour = dayReports.filter(report =>
            report.machine_id === machine.id && report.hour_start === hour
          )
          if (!reportsForHour.length) return null
          const good = reportsForHour.reduce((sum, report) => sum + report.good_count, 0)
          const target = reportsForHour.reduce((sum, report) =>
            sum + reportTarget(report, machineTargetById[machine.id] ?? TARGET), 0
          )
          return pct(good, target)
        }),
        borderColor: colors[index % colors.length],
        backgroundColor: colors[index % colors.length],
        tension: 0.32,
        pointRadius: 4,
        spanGaps: false
      }))
    }
  }, [dayReports, machineFilter, machineTargetById, machines])

  const wepqByShift = useMemo(() => SHIFTS.map(shift => {
    const rows = groups.filter(row => row.shiftType === shift)
    const good = rows.reduce((sum, row) => sum + row.good, 0)
    const target = rows.reduce((sum, row) => sum + row.target, 0)
    const reject = rows.reduce((sum, row) => sum + row.reject, 0)
    const reports = rows.reduce((sum, row) => sum + row.reports, 0)

    return {
      shift,
      good,
      target,
      reject,
      reports,
      wepq: pct(good, target),
      rejectPct: pct1(reject, good + reject)
    }
  }), [groups])

  const shiftForecast = useMemo(() => activeShifts
    .map(shift => {
      const shiftReports = filteredReports.filter(report => report.shift_id === shift.id)
      const totalGood = shiftReports.reduce((sum, report) => sum + report.good_count, 0)
      const hoursWorked = shiftReports.length
      const rate = hoursWorked > 0 ? Math.round(totalGood / hoursWorked) : 0
      const remainingHours = Math.max(0, 8 - hoursWorked)
      const forecast = totalGood + rate * remainingHours
      const target = TARGET_PER_SHIFT

      return {
        shiftId: shift.id,
        machineName: machineNameById[shift.machine_id] ?? '-',
        shiftType: shift.shift_type,
        totalGood,
        hoursWorked,
        remainingHours,
        rate,
        forecast,
        target,
        forecastPct: pct(forecast, target)
      }
    })
    .filter(forecast => forecast.hoursWorked > 0),
  [activeShifts, filteredReports, machineNameById, machineTargetById])

  const downtimePareto = useMemo(() => {
    const reasons: Record<string, { count: number; label: string }> = {}

    filteredReports.forEach(report => {
      const values = [report.downtime_reason, report.reject_reason, report.notes]
      values.forEach(value => {
        const reason = value?.trim()
        if (!reason) return
        const key = reason.toLowerCase().slice(0, 90)
        if (!reasons[key]) reasons[key] = { count: 0, label: reason.slice(0, 110) }
        reasons[key].count += 1
      })
    })

    const items = Object.values(reasons).sort((a, b) => b.count - a.count).slice(0, 8)
    const total = items.reduce((sum, item) => sum + item.count, 0)
    return items.map(item => ({
      ...item,
      pct: total > 0 ? Math.round(item.count / total * 100) : 0
    }))
  }, [filteredReports])

  const operatorRanking = useMemo(() => {
    const map: Record<string, {
      operatorId: string
      operatorName: string
      good: number
      reject: number
      target: number
      reports: number
      lowOutput: number
      highReject: number
      machines: Set<string>
      shifts: Set<string>
    }> = {}
    // Cel planowy zmiany (18000) dzielimy MIEDZY operatorow proporcjonalnie do
    // liczby ich wpisow w tej zmianie (proxy przepracowanych godzin). Wczesniej
    // kazdy z dwoch operatorow na zmianie dostawal pelne 18000 - podwojne liczenie.
    const groupReportCount: Record<string, number> = {}
    filteredReports.forEach(report => {
      const shiftType = one(report.shift)?.shift_type ?? '-'
      const gk = `${report.report_date}|${shiftType}|${report.machine_id}`
      groupReportCount[gk] = (groupReportCount[gk] ?? 0) + 1
    })

    filteredReports.forEach(report => {
      const operatorId = report.operator_id
      const operatorName = one(report.operator)?.full_name ?? 'Nieznany operator'
      const shiftType = one(report.shift)?.shift_type ?? '-'
      const gk = `${report.report_date}|${shiftType}|${report.machine_id}`
      const target = groupReportCount[gk] > 0 ? TARGET_PER_SHIFT / groupReportCount[gk] : 0
      const wepq = reportWepq(report, machineTargetById[report.machine_id] ?? TARGET)
      const rejectPct = reportRejectPct(report)

      if (!map[operatorId]) {
        map[operatorId] = {
          operatorId,
          operatorName,
          good: 0,
          reject: 0,
          target: 0,
          reports: 0,
          lowOutput: 0,
          highReject: 0,
          machines: new Set(),
          shifts: new Set()
        }
      }

      map[operatorId].good += report.good_count
      map[operatorId].reject += report.reject_count
      map[operatorId].target += target
      map[operatorId].reports += 1
      map[operatorId].machines.add(machineNameById[report.machine_id] ?? '-')
      map[operatorId].shifts.add(shiftType)
      if (wepq > 0 && wepq < 80) map[operatorId].lowOutput += 1
      if (rejectPct > 5) map[operatorId].highReject += 1
    })

    return Object.values(map)
      .map(row => ({
        ...row,
        machineList: Array.from(row.machines).filter(Boolean).join(', '),
        shiftList: Array.from(row.shifts).filter(Boolean).sort().join(', '),
        wEpq: pct(row.good, row.target),
        rejectPct: pct1(row.reject, row.good + row.reject),
        avgPerReport: row.reports ? Math.round(row.good / row.reports) : 0,
        score: pct(row.good, row.target) - Math.max(0, pct1(row.reject, row.good + row.reject) - 2) * 3
      }))
      .sort((a, b) => b.score - a.score || b.good - a.good || a.rejectPct - b.rejectPct)
  }, [filteredReports, machineNameById, machineTargetById])

  const dayForecast = useMemo(() => {
    const scopedHistory = historyReports.filter(report => {
      const shiftType = one(report.shift)?.shift_type ?? ''
      const machineOk = machineFilter === 'all' || report.machine_id === machineFilter
      const shiftOk = shiftFilter === 'all' || shiftType === shiftFilter
      return machineOk && shiftOk
    })
    const currentReports = dayReports
    const currentGood = currentReports.reduce((sum, report) => sum + report.good_count, 0)
    const currentReject = currentReports.reduce((sum, report) => sum + report.reject_count, 0)
    const currentTargetKeys = new Set(currentReports.map(report =>
      `${report.report_date}|${one(report.shift)?.shift_type ?? '-'}|${report.machine_id}`
    ))
    const currentTarget = currentTargetKeys.size * TARGET_PER_SHIFT
    const currentHour = lastProductionHour(currentReports)

    const byDate = scopedHistory.reduce<Record<string, ReportWithContext[]>>((acc, report) => {
      if (!acc[report.report_date]) acc[report.report_date] = []
      acc[report.report_date].push(report)
      return acc
    }, {})

    const historicalDays = Object.entries(byDate)
      .map(([date, rows]) => {
        const sorted = [...rows].sort((a, b) => compareProductionHours(a.hour_start, b.hour_start))
        const finalGood = sorted.reduce((sum, report) => sum + report.good_count, 0)
        const finalReject = sorted.reduce((sum, report) => sum + report.reject_count, 0)
        const finalTarget = new Set(sorted.map(report =>
          `${report.report_date}|${one(report.shift)?.shift_type ?? '-'}|${report.machine_id}`
        )).size * TARGET_PER_SHIFT
        const cutoffGood = currentHour === null
          ? 0
          : sorted
            .filter(report => isProductionHourAtOrBefore(report.hour_start, currentHour))
            .reduce((sum, report) => sum + report.good_count, 0)
        return {
          date,
          rows: sorted,
          finalGood,
          finalReject,
          finalTarget,
          cutoffGood,
          shareAtCurrentHour: finalGood > 0 && cutoffGood > 0 ? cutoffGood / finalGood : null
        }
      })
      .filter(day => day.finalGood > 0)

    const shares = historicalDays
      .map(day => day.shareAtCurrentHour)
      .filter((value): value is number => typeof value === 'number' && value > 0 && value <= 1)
    const learnedShare = shares.length
      ? shares.reduce((sum, value) => sum + value, 0) / shares.length
      : null
    const historicalAverage = historicalDays.length
      ? Math.round(historicalDays.reduce((sum, day) => sum + day.finalGood, 0) / historicalDays.length)
      : 0
    const forecastGood = currentGood > 0 && learnedShare
      ? Math.round(currentGood / learnedShare)
      : historicalAverage
    const forecastRejectPct = historicalDays.length
      ? Math.round((historicalDays.reduce((sum, day) => sum + pct1(day.finalReject, day.finalGood + day.finalReject), 0) / historicalDays.length) * 10) / 10
      : pct1(currentReject, currentGood + currentReject)
    const expectedReject = Math.round(forecastGood * forecastRejectPct / Math.max(0.1, 100 - forecastRejectPct))
    const visibleMachineCount = machineFilter === 'all' ? machines.length : 1
    const visibleShiftCount = shiftFilter === 'all' ? SHIFTS.length : 1
    const forecastTarget = currentTarget > 0
      ? currentTarget
      : visibleMachineCount * visibleShiftCount * TARGET_PER_SHIFT

    const backtests = historicalDays
      .filter(day => day.rows.length >= 2)
      .slice(0, 12)
      .map(day => {
        const localCutoff = currentHour ?? lastProductionHour(day.rows) ?? day.rows[0].hour_start
        const partialGood = day.rows
          .filter(report => isProductionHourAtOrBefore(report.hour_start, localCutoff))
          .reduce((sum, report) => sum + report.good_count, 0)
        const localShare = day.finalGood > 0 && partialGood > 0 ? partialGood / day.finalGood : learnedShare
        const predicted = localShare ? Math.round(partialGood / localShare) : partialGood
        const errorPct = day.finalGood > 0 ? Math.abs(predicted - day.finalGood) / day.finalGood * 100 : 0
        return {
          date: day.date,
          predicted,
          actual: day.finalGood,
          accuracy: Math.max(0, Math.round(100 - errorPct))
        }
      })

    const avgAccuracy = backtests.length
      ? Math.round(backtests.reduce((sum, item) => sum + item.accuracy, 0) / backtests.length)
      : null

    return {
      selectedDate,
      currentGood,
      currentReject,
      currentRejectPct: pct1(currentReject, currentGood + currentReject),
      currentHour,
      currentReports: currentReports.length,
      forecastGood,
      forecastReject: expectedReject,
      forecastRejectPct,
      forecastTarget,
      forecastWepq: pct(forecastGood, forecastTarget),
      learnedSharePct: learnedShare ? Math.round(learnedShare * 100) : null,
      historyDays: historicalDays.length,
      avgAccuracy,
      backtests
    }
  }, [dayReports, historyReports, machineFilter, machineTargetById, machines, selectedDate, shiftFilter])

  const hourlyChart = useMemo(() => {
    const hours = PRODUCTION_DAY_HOURS.filter(hour =>
      dayReports.some(report => report.hour_start === hour)
    )
    const visibleMachines = machines.filter(machine =>
      machineFilter === 'all' || machine.id === machineFilter
    )
    return {
      labels: hours.map(hour => hourLabel(hour + 1)),
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

  const monthlyTarget = Math.max(0, Number.parseInt(monthlyTargetInput || '0', 10) || 0)
  const monthlyPlan = useMemo(() => {
    const workdays = workdaysOfMonth(year, month)
    const calendarDays = calendarDaysOfMonth(year, month)
    const prev = previousMonth(year, month)
    const previousCalendarDays = calendarDaysOfMonth(prev.year, prev.month)
    const dailyPlan = workdays.length && monthlyTarget > 0 ? monthlyTarget / workdays.length : 0
    const productionByDate = filteredReports.reduce<Record<string, number>>((acc, report) => {
      acc[report.report_date] = (acc[report.report_date] ?? 0) + report.good_count
      return acc
    }, {})
    const previousProductionByDay = historyReports.reduce<Record<string, number>>((acc, report) => {
      if (!report.report_date.startsWith(`${prev.year}-${prev.month}`)) return acc
      const day = report.report_date.slice(8, 10)
      acc[day] = (acc[day] ?? 0) + report.good_count
      return acc
    }, {})
    const previousHasData = Object.values(previousProductionByDay).some(value => value > 0)

    let cumulativeActual = 0
    let cumulativePrevious = 0
    let cumulativePlan = 0
    const today = getProductionDate()
    const points = calendarDays.map(day => {
      if (day.workday) cumulativePlan += dailyPlan
      cumulativeActual += productionByDate[day.date] ?? 0
      const previousDay = previousCalendarDays.find(item => item.label === day.label)
      cumulativePrevious += previousProductionByDay[day.label] ?? 0
      const isFuture = day.date > today
      return {
        date: day.date,
        label: day.workday ? day.label : `${day.label} W`,
        plan: Math.round(cumulativePlan),
        actual: isFuture ? null : cumulativeActual,
        planPct: pctValue(cumulativePlan, monthlyTarget),
        actualPct: isFuture ? null : pctValue(cumulativeActual, monthlyTarget),
        previousPct: previousHasData && previousDay ? pctValue(cumulativePrevious, monthlyTarget) : null
      }
    })

    const actual = Object.values(productionByDate).reduce((sum, value) => sum + value, 0)
    const elapsedWorkdays = workdays.filter(date => date <= today).length || 1
    const expectedToday = monthlyTarget > 0 ? Math.round(dailyPlan * Math.min(elapsedWorkdays, workdays.length || elapsedWorkdays)) : 0
    const gapToToday = expectedToday - actual

    return {
      workdays,
      calendarDays,
      points,
      actual,
      dailyPlan: Math.round(dailyPlan),
      expectedToday,
      gapToToday,
      remaining: Math.max(0, monthlyTarget - actual),
      realization: pct(actual, monthlyTarget),
      elapsedWorkdays: Math.min(elapsedWorkdays, workdays.length || elapsedWorkdays),
      previousLabel: `${prev.month}.${prev.year}`,
      previousHasData
    }
  }, [filteredReports, historyReports, month, monthlyTarget, year])

  const monthlyLineChart = useMemo(() => ({
    labels: monthlyPlan.points.map(point => point.label),
    datasets: [
      {
        label: 'Plan idealny',
        data: monthlyPlan.points.map(point => point.planPct),
        borderColor: '#1F6F9B',
        backgroundColor: 'rgba(31,111,155,0.10)',
        tension: 0,
        stepped: 'after' as const,
        pointRadius: 2,
        borderWidth: 2
      },
      {
        label: 'Plan faktyczny',
        data: monthlyPlan.points.map(point => point.actualPct),
        borderColor: '#F97316',
        backgroundColor: 'rgba(249,115,22,0.10)',
        tension: 0,
        stepped: 'after' as const,
        pointRadius: 3,
        borderWidth: 2,
        spanGaps: false
      },
      ...(monthlyPlan.previousHasData ? [{
        label: `Realizacja ${monthlyPlan.previousLabel}`,
        data: monthlyPlan.points.map(point => point.previousPct),
        borderColor: '#16A34A',
        backgroundColor: 'rgba(22,163,74,0.10)',
        borderDash: [8, 4],
        tension: 0,
        stepped: 'after' as const,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: false
      }] : [])
    ]
  }), [monthlyPlan.points, monthlyPlan.previousHasData, monthlyPlan.previousLabel])

  // Zapis planu miesiecznego do bazy (wspolny dla wszystkich). Plan zakladowy =
  // wiersz z machine_id NULL. Recznie select->update/insert/delete, bo unikalnosc
  // (rok,miesiac,machine_id) dla NULL opiera sie na indeksie wyrazeniowym.
  const saveMonthlyTarget = async () => {
    const yearNum = Number(year)
    const monthNum = Number(month)
    const { data: existing } = await supabase
      .from('monthly_production_targets')
      .select('id')
      .eq('year', yearNum)
      .eq('month', monthNum)
      .is('machine_id', null)
      .maybeSingle()

    let error = null
    if (monthlyTarget > 0) {
      const payload = { year: yearNum, month: monthNum, machine_id: null, target_qty: monthlyTarget, updated_by: profile?.id ?? null, updated_at: new Date().toISOString() }
      const res = existing
        ? await supabase.from('monthly_production_targets').update(payload).eq('id', existing.id)
        : await supabase.from('monthly_production_targets').insert(payload)
      error = res.error
      if (!error) {
        setMonthlyTargetInput(String(monthlyTarget))
        setMonthlySaveMessage(`Plan na ${month}.${year} zapisany: ${monthlyTarget.toLocaleString('pl-PL')} szt.`)
      }
    } else {
      if (existing) {
        const res = await supabase.from('monthly_production_targets').delete().eq('id', existing.id)
        error = res.error
      }
      if (!error) {
        setMonthlyTargetInput('')
        setMonthlySaveMessage(`Plan na ${month}.${year} wyczyszczony.`)
      }
    }
    if (error) {
      setMonthlySaveMessage('Nie udalo sie zapisac planu: ' + error.message)
    }
    window.setTimeout(() => setMonthlySaveMessage(''), 4000)
  }

  const openEdit = (report: ReportWithContext) => {
    if (!canEdit) return
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
      reject_reason: report.reject_reason ?? '',
      downtime_status: report.downtime_status ?? '',
      reject_status: report.reject_status ?? '',
      notes: report.notes ?? '',
      reason: ''
    })
  }

  const focusGroup = (row: GroupRow, target: 'table' | 'timeline' = 'table') => {
    navigate('/manager')
    setMode('day')
    setSelectedDate(row.date)
    setMachineFilter(row.machineId)
    setShiftFilter(row.shiftType as ShiftFilter)
    window.setTimeout(() => {
      const ref = target === 'timeline' ? dayTimelineRef : groupsTableRef
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }

  const handleRecommendationClick = (item: Recommendation) => {
    if (item.action === 'none') return

    if (item.reportId) {
      const report = filteredReports.find(row => row.id === item.reportId)
      if (!report) return
      const shiftType = one(report.shift)?.shift_type ?? 'all'
      navigate('/manager')
      setMode('day')
      setSelectedDate(report.report_date)
      setMachineFilter(report.machine_id)
      setShiftFilter(shiftType as ShiftFilter)
      window.setTimeout(() => {
        dayTimelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        if (canEdit) openEdit(report)
      }, 80)
      return
    }

    if (item.groupKey) {
      const row = groups.find(group => group.key === item.groupKey)
      if (!row) return
      focusGroup(row, item.action === 'missing-reason' ? 'timeline' : 'table')
      if (item.action === 'missing-time' && canEdit) {
        const shift = shiftByGroupKey[row.key]
        if (shift) window.setTimeout(() => openShiftEdit(shift), 120)
      }
    }
  }

  const openShiftEdit = (shift: ShiftWithContext) => {
    if (!canEdit) return
    setEditingShift(shift)
    setShiftEditState({
      operator1Id: shift.operator_1_id,
      operator2Id: shift.operator_2_id ?? '',
      runtimeMin: shift.summary_runtime_min != null ? minsToHHMM(shift.summary_runtime_min) : '',
      readyMin: shift.summary_ready_min != null ? minsToHHMM(shift.summary_ready_min) : '',
      alarmMin: shift.summary_alarm_min != null ? minsToHHMM(shift.summary_alarm_min) : '',
      downtimeMin: shift.summary_downtime_min != null ? minsToHHMM(shift.summary_downtime_min) : '',
      notes: shift.summary_notes ?? '',
      reason: ''
    })
    setShiftEditError('')
  }

  const saveShiftCorrection = async () => {
    if (!canEdit) return
    if (!editingShift || !shiftEditState) return
    if (!shiftEditState.operator1Id) {
      setShiftEditError('Wybierz pierwszego operatora.')
      return
    }
    if (shiftEditState.operator2Id && shiftEditState.operator2Id === shiftEditState.operator1Id) {
      setShiftEditError('Drugi operator musi byc inny niz pierwszy.')
      return
    }
    const runtimeMin = parseOptionalHHMM(shiftEditState.runtimeMin)
    const readyMin = parseOptionalHHMM(shiftEditState.readyMin)
    const alarmMin = parseOptionalHHMM(shiftEditState.alarmMin)
    const downtimeMin = parseOptionalHHMM(shiftEditState.downtimeMin)
    if ([runtimeMin, readyMin, alarmMin, downtimeMin].some(value => typeof value === 'number' && Number.isNaN(value))) {
      setShiftEditError('Wpisz czas w formacie HH:MM, np. 07:35 albo 00:20.')
      return
    }
    const totalTime = (runtimeMin ?? 0) + (readyMin ?? 0) + (alarmMin ?? 0) + (downtimeMin ?? 0)
    if (totalTime > 16 * 60) {
      setShiftEditError('Suma czasu jest za duza. Sprawdz wpisane minuty.')
      return
    }

    setShiftSaving(true)
    setShiftEditError('')
    const payload = {
      operator_1_id: shiftEditState.operator1Id,
      operator_2_id: shiftEditState.operator2Id || null,
      summary_runtime_min: runtimeMin,
      summary_ready_min: readyMin,
      summary_alarm_min: alarmMin,
      summary_downtime_min: downtimeMin,
      summary_notes: shiftEditState.notes.trim() || null
    }
    const { error } = await supabase.from('shifts').update(payload).eq('id', editingShift.id)

    if (error) {
      setShiftEditError(error.message || 'Nie udalo sie zapisac korekty zmiany.')
      setShiftSaving(false)
      return
    }

    await logAudit('shift_manager_correction', 'shifts', editingShift.id, {
      operator_1_id: editingShift.operator_1_id,
      operator_2_id: editingShift.operator_2_id,
      summary_runtime_min: editingShift.summary_runtime_min,
      summary_ready_min: editingShift.summary_ready_min,
      summary_alarm_min: editingShift.summary_alarm_min,
      summary_downtime_min: editingShift.summary_downtime_min,
      summary_notes: editingShift.summary_notes
    }, {
      ...payload,
      reason: shiftEditState.reason.trim() || 'korekta czasu pracy przez kierownika'
    })
    setEditingShift(null)
    setShiftEditState(null)
    setShiftSaving(false)
    await load()
  }

  const recalculateShiftCounters = async (shiftId: string) => {
    const { data, error } = await supabase
      .from('hourly_reports')
      .select('id, hour_start, good_count, reject_count')
      .eq('shift_id', shiftId)
      .is('deleted_at', null)
      .order('hour_start')

    if (error) throw error

    let counterGood = 0
    let counterReject = 0
    const updates = ((data ?? []) as CounterRow[]).map(report => {
      counterGood += report.good_count ?? 0
      counterReject += report.reject_count ?? 0
      return supabase
        .from('hourly_reports')
        .update({
          counter_good: counterGood,
          counter_reject: counterReject,
          total_count: counterGood
        })
        .eq('id', report.id)
    })

    const results = await Promise.all(updates)
    const failed = results.find(result => result.error)
    if (failed?.error) throw failed.error
  }

  const saveEdit = async () => {
    if (!canEdit) return
    if (!editing || !editState) return
    setSaving(true)
    setEditError('')

    const payload = {
      good_count: toInt(editState.good_count),
      reject_count: toInt(editState.reject_count),
      target: editing.target && editing.target > 0 ? editing.target : machineTargetById[editing.machine_id] ?? TARGET,
      downtime_reason: editState.downtime_reason.trim() || null,
      reject_reason: editState.reject_reason.trim() || null,
      downtime_status: editState.downtime_status || null,
      reject_status: editState.reject_status || null,
      notes: editState.notes.trim() || null
    }

    const { error } = await supabase.from('hourly_reports').update(payload).eq('id', editing.id)
    if (!error) {
      try {
        await recalculateShiftCounters(editing.shift_id)
      } catch (counterError) {
        setEditError(counterError instanceof Error
          ? `Korekta zapisana, ale nie udalo sie przeliczyc licznika narastajacego: ${counterError.message}`
          : 'Korekta zapisana, ale nie udalo sie przeliczyc licznika narastajacego.')
        await load()
        setSaving(false)
        return
      }
      await logAudit('manager_report_update', 'hourly_reports', editing.id, {
        good_count: editing.good_count,
        reject_count: editing.reject_count,
        downtime_reason: editing.downtime_reason,
        reject_reason: editing.reject_reason,
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
    if (!canEdit) return
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
      try {
        await recalculateShiftCounters(editing.shift_id)
      } catch (counterError) {
        setEditError(counterError instanceof Error
          ? `Wpis usuniety, ale nie udalo sie przeliczyc licznika narastajacego: ${counterError.message}`
          : 'Wpis usuniety, ale nie udalo sie przeliczyc licznika narastajacego.')
        await load()
        setDeleting(false)
        return
      }
      await logAudit('manager_report_delete', 'hourly_reports', editing.id, {
        good_count: editing.good_count,
        reject_count: editing.reject_count,
        downtime_reason: editing.downtime_reason,
        reject_reason: editing.reject_reason,
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
    compareProductionHours(a.hour_start, b.hour_start)
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
            {selectedRangeLabel} <span className="text-navy-600">|</span> <span className="font-mono text-white">{time}</span>
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

      {activeTab === 'monthly' && (
        <div className="card border-brand/20">
          <div className="card-header">
            <div>
              <div className="card-title">Realizacja miesiaca</div>
              <div className="card-sub">Wykres procentowy: plan idealny, plan faktyczny i porownanie poprzedniego miesiaca.</div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block w-28">
                <span className="label">Miesiac</span>
                <select className="input py-2" value={month} onChange={e => { setMonth(e.target.value); setMode('month') }}>
                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="block w-28">
                <span className="label">Rok</span>
                <input className="input py-2" type="number" value={year} onChange={e => { setYear(e.target.value); setMode('month') }} />
              </label>
              <label className="block w-44">
                <span className="label">Plan sztuk</span>
                <input className="input py-2 font-mono font-bold" type="number" min="0" step="1000" value={monthlyTargetInput} onChange={e => setMonthlyTargetInput(e.target.value)} />
              </label>
              <button type="button" className="btn-primary py-2" onClick={saveMonthlyTarget}>Zapisz</button>
            </div>
          </div>

          {monthlySaveMessage && (
            <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm font-bold text-green-300">
              {monthlySaveMessage}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
            <div className="overflow-hidden rounded-xl border border-navy-700">
              <table className="w-full text-xs">
                <thead className="bg-green-800 text-white">
                  <tr>
                    {['Data', 'Plan [%]', 'Realizacja [%]', 'Plan [szt]', 'Realizacja [szt]'].map(header => (
                      <th key={header} className="px-2 py-2 text-left font-black">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthlyPlan.points.map(point => (
                    <tr key={point.date} className={cn('border-b border-navy-800', point.label.includes('W') ? 'bg-navy-800/70' : 'bg-navy-900')}>
                      <td className="px-2 py-1.5 font-mono font-bold text-white">{point.label}</td>
                      <td className="px-2 py-1.5 font-mono text-green-300">{point.planPct.toLocaleString('pl-PL')}%</td>
                      <td className="px-2 py-1.5 font-mono text-amber-200">{point.actualPct == null ? '-' : `${point.actualPct.toLocaleString('pl-PL')}%`}</td>
                      <td className="px-2 py-1.5 font-mono text-blue-200">{point.plan ? point.plan.toLocaleString('pl-PL') : '-'}</td>
                      <td className="px-2 py-1.5 font-mono text-white">{point.actual == null ? '-' : point.actual.toLocaleString('pl-PL')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-navy-700 bg-navy-900 p-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  { label: 'Cel miesiaca', value: monthlyTarget ? `${monthlyTarget.toLocaleString('pl-PL')} szt` : '-', color: 'text-brand' },
                  { label: 'Jest teraz', value: `${monthlyPlan.actual.toLocaleString('pl-PL')} szt`, color: efficiencyColor(monthlyPlan.realization) },
                  { label: 'Powinno byc', value: monthlyTarget ? `${monthlyPlan.expectedToday.toLocaleString('pl-PL')} szt` : '-', color: 'text-amber-300' },
                  { label: 'Do konca', value: monthlyTarget ? `${monthlyPlan.remaining.toLocaleString('pl-PL')} szt` : '-', color: monthlyPlan.remaining ? 'text-cyan-300' : 'text-green-400' }
                ].map(item => (
                  <div key={item.label} className="rounded-xl border border-navy-700 bg-navy-800 p-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-navy-500">{item.label}</div>
                    <div className={cn('mt-1 font-mono text-lg font-black', item.color)}>{loading ? '...' : item.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 h-[520px]">
                {monthlyTarget > 0
                  ? <Line data={monthlyLineChart} options={MONTHLY_PERCENT_CHART_OPTS as never} />
                  : <div className="flex h-full items-center justify-center text-sm text-navy-500">Wpisz plan miesieczny i zapisz, zeby zobaczyc wykres procentowy.</div>}
              </div>
              {monthlyTarget > 0 && !monthlyPlan.previousHasData && (
                <div className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm font-bold text-amber-200">
                  Realizacja poprzedniego miesiaca ({monthlyPlan.previousLabel}): brak danych.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'production' && (
        <>
      {/* Kafel-bohater OEE (standard przemyslowy: Dostepnosc x Wydajnosc x Jakosc) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="card lg:col-span-1 flex flex-col justify-center items-center py-5">
          <div className="kpi-label">OEE (efektywnosc maszyn)</div>
          <div className={cn('text-5xl font-bold mt-1', kpi.oee == null ? 'text-navy-500' : efficiencyColor(kpi.oee))}>
            {loading ? '...' : kpi.oee == null ? '—' : `${kpi.oee}%`}
          </div>
          <div className="text-xs text-navy-400 mt-1">
            {kpi.oee == null ? 'brak rozliczenia czasu zmian' : `cel world-class: ${WORLD_CLASS_OEE}%`}
          </div>
        </div>
        <div className="lg:col-span-2 grid grid-cols-3 gap-3">
          {[
            { label: 'Dostepnosc', value: kpi.oeeAvailability, sub: 'praca / czas planowany' },
            { label: 'Wydajnosc', value: kpi.oeePerformance, sub: 'tempo vs norma maszyny' },
            { label: 'Jakosc', value: kpi.oeeQuality, sub: 'dobre / wszystkie' }
          ].map(item => (
            <div key={item.label} className="kpi-card flex flex-col justify-center">
              <div className="kpi-label">{item.label}</div>
              <div className={cn('kpi-value', item.value == null ? 'text-navy-500' : efficiencyColor(item.value))}>
                {loading ? '...' : item.value == null ? '—' : `${item.value}%`}
              </div>
              <div className="kpi-sub">{item.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Produkcja', value: `${kpi.totalGood.toLocaleString('pl-PL')} szt`, sub: `cel ${kpi.target.toLocaleString('pl-PL')} szt`, color: 'text-brand' },
          { label: 'Realizacja planu', value: kpi.target ? `${planAttainmentPct(kpi.totalGood, kpi.target)}%` : '-', sub: 'produkcja / cel zmianowy', color: efficiencyColor(planAttainmentPct(kpi.totalGood, kpi.target)) },
          { label: 'Odrzut', value: `${kpi.rejectPct}%`, sub: `${kpi.totalReject.toLocaleString('pl-PL')} szt`, color: kpi.rejectPct > 5 ? 'text-red-400' : kpi.rejectPct > 2 ? 'text-amber-400' : 'text-green-400' },
          { label: 'Wyd. maszyny', value: kpi.machineRate ? `${kpi.machineRate.toLocaleString('pl-PL')} szt/h` : '-', sub: kpi.missingTimeSummaries ? `brakuje czasu: ${kpi.missingTimeSummaries}` : 'produkcja / czas pracy', color: 'text-cyan-400' }
        ].map(item => (
          <div key={item.label} className="kpi-card">
            <div className="kpi-label">{item.label}</div>
            <div className={cn('kpi-value', item.color)}>{loading ? '...' : item.value}</div>
            <div className="kpi-sub">{item.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Czas pracy', value: kpi.summarizedShifts ? minsToHHMM(kpi.runtime) : '-', sub: `z rozliczen: ${kpi.summarizedShifts}`, color: 'text-green-400' },
          { label: 'Wyd. dobrych', value: kpi.goodRate ? `${kpi.goodRate.toLocaleString('pl-PL')} szt/h` : '-', sub: kpi.missingTimeSummaries ? `brakuje czasu: ${kpi.missingTimeSummaries}` : 'dobre / czas pracy', color: 'text-green-400' },
          { label: 'Alarmy', value: kpi.summarizedShifts ? minsToHHMM(kpi.alarm) : '-', sub: 'z konca zmiany', color: kpi.alarm > 60 ? 'text-red-400' : 'text-amber-400' },
          { label: 'Postoje', value: kpi.summarizedShifts ? minsToHHMM(kpi.downtime) : '-', sub: 'z konca zmiany', color: kpi.downtime > 60 ? 'text-red-400' : 'text-amber-400' }
        ].map(item => (
          <div key={item.label} className="kpi-card">
            <div className="kpi-label">{item.label}</div>
            <div className={cn('kpi-value text-xl', item.color)}>{loading ? '...' : item.value}</div>
            <div className="kpi-sub">{item.sub}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Sugestie kierownika</div>
            <div className="card-sub">Wnioski z produkcji, odrzutu, komentarzy i rozliczen konca zmiany</div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {recommendations.map(item => (
            <button
              key={item.title}
              type="button"
              onClick={() => handleRecommendationClick(item)}
              disabled={item.action === 'none'}
              className={cn(
                'rounded-xl border p-3 text-left transition-all',
                item.action !== 'none' && 'cursor-pointer hover:-translate-y-0.5 hover:border-brand/60 hover:bg-navy-800/70',
                item.action === 'none' && 'cursor-default',
                item.tone === 'red' && 'border-red-500/30 bg-red-500/10',
                item.tone === 'amber' && 'border-amber-500/30 bg-amber-500/10',
                item.tone === 'green' && 'border-green-500/30 bg-green-500/10',
                item.tone === 'blue' && 'border-blue-500/30 bg-blue-500/10'
              )}
            >
              <div className="font-bold text-white">{item.title}</div>
              <div className="text-sm text-navy-200 mt-1">{item.body}</div>
              <div className="mt-3 inline-flex items-center rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-1 text-xs font-bold text-brand">
                {item.actionLabel}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div ref={groupsTableRef} className="card xl:col-span-2 scroll-mt-24">
          <div className="card-header">
            <div>
              <div className="card-title">Dzien / zmiana / maszyna</div>
              <div className="card-sub">Produkcja z wpisow, czasy tylko z rozliczenia konca zmiany</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700">
                  {['Rok', 'Mc', 'Dzien', 'Zmiana', 'Maszyna', 'Operatorzy', 'W EPQ', 'Odrzut', 'Wyd. maszyny', 'Produkcja', 'Raporty', 'Czas', 'Status', 'Sugestia', 'Akcja'].map(header => (
                    <th key={header} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 && (
                  <tr><td colSpan={15} className="py-8 text-center text-navy-500">Brak danych dla wybranego zakresu</td></tr>
                )}
                {groups.map(row => {
                  const shift = shiftByGroupKey[row.key]
                  const shiftOperators = shift
                    ? [shift.operator_1?.full_name, shift.operator_2?.full_name].filter(Boolean).join(' / ') || '-'
                    : '-'
                  return (
                    <tr key={row.key} className="border-b border-navy-800 hover:bg-navy-800/50">
                      <td className="py-2 px-3 font-mono text-navy-300">{row.year}</td>
                      <td className="py-2 px-3 font-mono text-navy-300">{row.month}</td>
                      <td className="py-2 px-3 font-mono text-white">{row.day}</td>
                      <td className="py-2 px-3 font-bold text-white">Zmiana {row.shiftType}</td>
                      <td className="py-2 px-3"><span className="status-info text-xs">{row.machineName}</span></td>
                      <td className="py-2 px-3 text-xs text-navy-200 min-w-[180px]">{shiftOperators}</td>
                      <td className={cn('py-2 px-3 font-bold font-mono', efficiencyColor(row.wEpq))}>{row.wEpq || '-'}{row.wEpq ? '%' : ''}</td>
                      <td className={cn('py-2 px-3 font-bold font-mono', row.rejectPct > 5 ? 'text-red-400' : 'text-green-400')}>{row.rejectPct}%</td>
                      <td className="py-2 px-3 font-bold font-mono text-cyan-300">{row.machineRate ? row.machineRate.toLocaleString('pl-PL') : '-'}</td>
                      <td className="py-2 px-3 font-bold font-mono text-white">{row.good.toLocaleString('pl-PL')}</td>
                      <td className="py-2 px-3 font-mono text-navy-200">{row.reports}</td>
                      <td className="py-2 px-3 font-mono text-green-400">{row.hasTimeSummary ? minsToHHMM(row.runtime) : '-'}</td>
                      <td className="py-2 px-3">
                        <span className={cn('text-xs', row.hasTimeSummary ? 'status-ok' : 'status-warn')}>
                          {row.hasTimeSummary ? 'Rozliczone' : 'Brak czasu'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-navy-200 min-w-[220px]">{row.suggestion}</td>
                      <td className="py-2 px-3">
                        {canEdit && shift && <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => openShiftEdit(shift)}>Korekta zmiany</button>}
                      </td>
                    </tr>
                  )
                })}
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
                {canEdit && (
                  <button className="btn-secondary mt-3 w-full text-xs py-1.5" onClick={() => openShiftEdit(shift)}>
                    Korekta zmiany
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header">
            <div><div className="card-title">Przyrost godzinowy</div><div className="card-sub">Produkcja wpisywana w ciagu dnia</div></div>
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Porownanie wydajnosci</div>
              <div className="card-sub">W EPQ i WEPQ TOTAL wedlug automatu</div>
            </div>
          </div>
          <div style={{ height: 240 }}>
            {machineComparison.length
              ? <Bar data={machineEfficiencyChart} options={PERCENT_CHART_OPTS as never} />
              : <div className="flex items-center justify-center h-full text-navy-500 text-sm">Brak danych do porownania</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Porownanie odrzutu</div>
              <div className="card-sub">Odrzut procentowy automat do automatu</div>
            </div>
          </div>
          <div style={{ height: 240 }}>
            {machineComparison.length
              ? <Bar data={machineRejectChart} options={PERCENT_CHART_OPTS as never} />
              : <div className="flex items-center justify-center h-full text-navy-500 text-sm">Brak odrzutu do porownania</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Ranking automatow</div>
              <div className="card-sub">Szybki odczyt: wynik, odrzut, tempo</div>
            </div>
          </div>
          <div className="space-y-2">
            {machineComparison.length === 0 && <div className="py-8 text-center text-navy-500 text-sm">Brak danych w zakresie</div>}
            {machineComparison.map((row, index) => (
              <div key={row.machineId} className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-navy-500">#{index + 1}</div>
                    <div className="font-bold text-white">{row.machineName}</div>
                  </div>
                  <div className={cn('font-mono text-xl font-bold', efficiencyColor(row.wEpq))}>{row.wEpq || '-'}{row.wEpq ? '%' : ''}</div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-navy-500">produkcja</div>
                    <div className="font-mono font-bold text-white">{row.good.toLocaleString('pl-PL')}</div>
                  </div>
                  <div>
                    <div className="text-navy-500">odrzut</div>
                    <div className={cn('font-mono font-bold', row.rejectPct > 5 ? 'text-red-400' : row.rejectPct > 2 ? 'text-amber-400' : 'text-green-400')}>
                      {row.rejectPct}%
                    </div>
                  </div>
                  <div>
                    <div className="text-navy-500">tempo</div>
                    <div className="font-mono font-bold text-cyan-300">{row.machineRate ? row.machineRate.toLocaleString('pl-PL') : '-'}</div>
                    {row.missingTime > 0 && <div className="mt-0.5 text-[10px] text-amber-400">brak czasu</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {shiftForecast.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Prognoza konca aktywnej zmiany</div>
              <div className="card-sub">Szacunek produkcji do konca zmiany na podstawie aktualnego tempa</div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {shiftForecast.map(forecast => (
              <div key={forecast.shiftId} className="rounded-xl border border-navy-700 bg-navy-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-white">{forecast.machineName}</div>
                    <div className="mt-1 text-xs text-navy-400">
                      Zmiana {forecast.shiftType} | wpisane {forecast.hoursWorked}h | pozostalo {forecast.remainingHours}h
                    </div>
                  </div>
                  <div className={cn('font-mono text-xl font-bold', efficiencyColor(forecast.forecastPct))}>
                    {forecast.forecastPct}%
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
                  <div>
                    <div className="text-navy-500">Teraz</div>
                    <div className="font-mono font-bold text-white">{forecast.totalGood.toLocaleString('pl-PL')}</div>
                  </div>
                  <div>
                    <div className="text-navy-500">Tempo</div>
                    <div className="font-mono font-bold text-cyan-300">{forecast.rate.toLocaleString('pl-PL')}/h</div>
                  </div>
                  <div>
                    <div className="text-navy-500">Prognoza</div>
                    <div className={cn('font-mono font-bold', efficiencyColor(forecast.forecastPct))}>
                      {forecast.forecast.toLocaleString('pl-PL')}
                    </div>
                  </div>
                </div>
                <div className="mt-3 h-1.5 bg-navy-800 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', efficiencyBg(forecast.forecastPct))}
                    style={{ width: `${Math.min(forecast.forecastPct, 120)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card xl:col-span-2">
          <div className="card-header">
            <div>
              <div className="card-title">W EPQ godzinowy</div>
              <div className="card-sub">Trend wydajnosci procentowej godzina po godzinie dla wybranego dnia</div>
            </div>
          </div>
          <div style={{ height: 240 }}>
            {wepqHourlyLineChart.labels.length
              ? <Line data={wepqHourlyLineChart} options={PERCENT_CHART_OPTS as never} />
              : <div className="flex items-center justify-center h-full text-navy-500 text-sm">Brak wpisow w tym dniu</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Zmiana W EPQ / godz.</div>
              <div className="card-sub">Czy automat poprawia tempo, czy traci stabilnosc</div>
            </div>
          </div>
          <div className="space-y-3">
            {wepqHourlyDelta.length === 0 && (
              <div className="py-8 text-center text-navy-500 text-sm">Potrzeba minimum dwoch wpisow godzinowych</div>
            )}
            {wepqHourlyDelta.map(machine => (
              <div key={machine.machineId} className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-white">{machine.machineName}</div>
                  <div className={cn(
                    'font-mono text-xl font-bold',
                    machine.avgDelta === null ? 'text-navy-500'
                      : machine.avgDelta > 2 ? 'text-green-400'
                        : machine.avgDelta < -2 ? 'text-red-400'
                          : 'text-amber-400'
                  )}>
                    {machine.avgDelta === null ? '-' : `${machine.avgDelta > 0 ? '+' : ''}${machine.avgDelta}%`}
                  </div>
                </div>
                <div className="mt-2 text-xs text-navy-400">
                  {machine.avgDelta === null
                    ? 'Za malo danych do oceny trendu'
                    : machine.avgDelta > 2
                      ? 'Trend poprawia sie w trakcie zmiany'
                      : machine.avgDelta < -2
                        ? 'Tempo spada. Warto sprawdzic komentarze i odrzut'
                        : 'Tempo jest stabilne'}
                </div>
                {machine.trend.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {machine.trend.map(point => (
                      <span key={`${machine.machineId}-${point.hour}`} className={cn('rounded px-1.5 py-0.5 text-[10px] font-mono text-white', efficiencyBg(point.wepq))}>
                        {hourLabel(point.hour + 1)} {point.wepq}%
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">W EPQ wedlug zmian</div>
              <div className="card-sub">Porownanie zmian I, II i III w aktualnym zakresie</div>
            </div>
          </div>
          <div className="space-y-3">
            {wepqByShift.every(row => row.reports === 0) && (
              <div className="py-8 text-center text-navy-500 text-sm">Brak danych w wybranym zakresie</div>
            )}
            {wepqByShift.filter(row => row.reports > 0).map(row => (
              <div key={row.shift} className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-white">Zmiana {row.shift}</div>
                    <div className="text-xs text-navy-400">
                      {row.reports} wpisow | {row.good.toLocaleString('pl-PL')} szt
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn('font-mono text-xl font-bold', efficiencyColor(row.wepq))}>
                      {row.wepq || '-'}{row.wepq ? '%' : ''}
                    </div>
                    <div className={cn('text-xs font-mono', row.rejectPct > 5 ? 'text-red-400' : 'text-green-400')}>
                      odrz. {row.rejectPct}%
                    </div>
                  </div>
                </div>
                <div className="h-1.5 bg-navy-800 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', efficiencyBg(row.wepq))}
                    style={{ width: `${Math.min(row.wepq, 120)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Pareto komentarzy</div>
              <div className="card-sub">Najczesciej powtarzajace sie wyjasnienia, postoje i przyczyny odrzutu</div>
            </div>
          </div>
          <div className="space-y-2">
            {downtimePareto.length === 0 && (
              <div className="py-8 text-center text-navy-500 text-sm">Brak komentarzy w wybranym zakresie</div>
            )}
            {downtimePareto.map((item, index) => (
              <div key={`${item.label}-${index}`} className="flex items-center gap-3">
                <div className="w-6 shrink-0 text-xs font-bold text-navy-500">#{index + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-navy-200">{item.label}</div>
                  <div className="mt-1 h-1.5 bg-navy-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
                <div className="shrink-0 text-xs font-mono text-amber-400">{item.count}x ({item.pct}%)</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div ref={dayTimelineRef} className="card scroll-mt-24">
        <div className="card-header">
          <div>
            <div className="card-title">Odtworzenie calego dnia</div>
            <div className="card-sub">{selectedDate} | kolejnosc wpisow po maszynie, zmianie i godzinie zakonczenia</div>
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
                setSelectedDate(next > productionDate ? productionDate : next)
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
            const reject = reportRejectPct(report)
            return (
              <div key={report.id} className="bg-navy-900 rounded-xl p-3 border border-navy-700">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-mono text-white font-bold">do {reportEndHourLabel(report)}</div>
                    <div className="mt-0.5 text-[11px] font-mono text-navy-500">blok {reportBlockLabel(report)}</div>
                  </div>
                  <div className={cn('font-mono font-bold', efficiencyColor(eff))}>{eff}%</div>
                </div>
                <div className="text-xs text-navy-400 mt-1">
                  {machineNameById[report.machine_id] ?? '-'} | Zmiana {one(report.shift)?.shift_type ?? '-'} | {one(report.operator)?.full_name ?? '-'}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div><div className="text-xs text-navy-500">szt</div><div className="font-mono font-bold text-white">{report.good_count}</div></div>
                  <div><div className="text-xs text-navy-500">odrz</div><div className="font-mono font-bold text-red-400">{report.reject_count}</div></div>
                  <div><div className="text-xs text-navy-500">odrz %</div><div className={cn('font-mono font-bold', reject > 5 ? 'text-red-400' : 'text-green-400')}>{reject}%</div></div>
                </div>
                {(report.downtime_reason || report.reject_reason || report.notes) && (
                  <div className="mt-3 rounded-lg bg-navy-800 px-3 py-2 text-xs text-navy-300 space-y-1">
                    {report.downtime_reason && (
                      <div>
                        <span className="text-navy-500">Przebieg:</span> {report.downtime_reason}
                        {(report.downtime_station || report.downtime_category) && (
                          <span className="text-navy-500"> ({reportStationLabel(report.downtime_stations, report.downtime_station)} · {problemCategoryLabel('downtime', report.downtime_category)}{report.downtime_status ? ` · ${issueStatusLabel(report.downtime_status)}` : ''})</span>
                        )}
                      </div>
                    )}
                    {report.reject_reason && (
                      <div>
                        <span className="text-navy-500">Uzasadnienie odrzutu:</span> {report.reject_reason}
                        {(report.reject_station || report.reject_category) && (
                          <span className="text-navy-500"> ({reportStationLabel(report.reject_stations, report.reject_station)} · {problemCategoryLabel('reject', report.reject_category)}{report.reject_status ? ` · ${issueStatusLabel(report.reject_status)}` : ''})</span>
                        )}
                      </div>
                    )}
                    {report.notes && <div><span className="text-navy-500">Informacja dodatkowa:</span> {report.notes}</div>}
                  </div>
                )}
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
                    {['Data', 'Do godz.', 'Maszyna', 'Zmiana', 'Operator', 'W EPQ', 'Szt', 'Odrzut', 'Komentarz wyniku', 'Komentarz odrzutu', ...(canEdit ? ['Akcja'] : [])].map(header => (
                  <th key={header} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredReports.length === 0 && (
                <tr><td colSpan={11} className="py-8 text-center text-navy-500">Brak raportow do pokazania</td></tr>
              )}
              {filteredReports.map(report => {
                const eff = reportWepq(report, machineTargetById[report.machine_id] ?? TARGET)
                const reject = reportRejectPct(report)
                return (
                  <tr key={report.id} className="border-b border-navy-800 hover:bg-navy-800/50">
                    <td className="py-2 px-3 font-mono text-xs text-navy-300">{report.report_date}</td>
                    <td className="py-2 px-3">
                      <div className="font-mono text-xs font-bold text-white">{reportEndHourLabel(report)}</div>
                      <div className="font-mono text-[10px] text-navy-500">{reportBlockLabel(report)}</div>
                    </td>
                    <td className="py-2 px-3"><span className="status-info text-xs">{machineNameById[report.machine_id] ?? '-'}</span></td>
                    <td className="py-2 px-3 font-bold text-white">Zmiana {one(report.shift)?.shift_type ?? '-'}</td>
                    <td className="py-2 px-3 text-navy-200 max-w-[150px] truncate">{one(report.operator)?.full_name ?? '-'}</td>
                    <td className={cn('py-2 px-3 font-bold font-mono', efficiencyColor(eff))}>{eff}%</td>
                    <td className="py-2 px-3 font-bold font-mono text-white">{report.good_count}</td>
                    <td className={cn('py-2 px-3 font-mono', reject > 5 ? 'text-red-400' : 'text-green-400')}>{report.reject_count} ({reject}%)</td>
                    <td className="py-2 px-3 text-xs text-navy-300 max-w-[220px]">
                      <div className="truncate">{report.downtime_reason || '-'}</div>
                      {(report.downtime_station || report.downtime_category) && (
                        <div className="text-[10px] text-navy-500 truncate">{reportStationLabel(report.downtime_stations, report.downtime_station)} · {problemCategoryLabel('downtime', report.downtime_category)}</div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-xs text-navy-300 max-w-[220px]">
                      <div className="truncate">{report.reject_reason || '-'}</div>
                      {(report.reject_station || report.reject_category) && (
                        <div className="text-[10px] text-navy-500 truncate">{reportStationLabel(report.reject_stations, report.reject_station)} · {problemCategoryLabel('reject', report.reject_category)}</div>
                      )}
                    </td>
                      {canEdit && (
                        <td className="py-2 px-3">
                          <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => openEdit(report)}>Edytuj</button>
                        </td>
                      )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {activeTab === 'operators' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            {[
              { label: 'Operatorzy w zakresie', value: operatorRanking.length, sub: 'aktywni we wpisach', color: 'text-white' },
              { label: 'Sredni W EPQ', value: operatorRanking.length ? `${pct(operatorRanking.reduce((sum, row) => sum + row.good, 0), operatorRanking.reduce((sum, row) => sum + row.target, 0))}%` : '-', sub: 'wszyscy operatorzy', color: efficiencyColor(operatorRanking.length ? pct(operatorRanking.reduce((sum, row) => sum + row.good, 0), operatorRanking.reduce((sum, row) => sum + row.target, 0)) : 0) },
              { label: 'Sredni odrzut', value: operatorRanking.length ? `${pct1(operatorRanking.reduce((sum, row) => sum + row.reject, 0), operatorRanking.reduce((sum, row) => sum + row.good + row.reject, 0))}%` : '-', sub: 'dla aktualnego filtra', color: 'text-amber-400' },
              { label: 'Wpisy lacznie', value: operatorRanking.reduce((sum, row) => sum + row.reports, 0), sub: 'podstawa rankingu', color: 'text-cyan-300' }
            ].map(item => (
              <div key={item.label} className="kpi-card">
                <div className="kpi-label">{item.label}</div>
                <div className={cn('kpi-value text-xl', item.color)}>{loading ? '...' : item.value}</div>
                <div className="kpi-sub">{item.sub}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Ranking operatorow</div>
                <div className="card-sub">Wynik liczony z aktualnego zakresu, zmiany i maszyny. Ranking uwzglednia W EPQ oraz odrzut.</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-700">
                    {['#', 'Operator', 'W EPQ', 'Produkcja', 'Odrzut', 'Wpisy', 'Srednio / wpis', 'Maszyny', 'Zmiany', 'Sygnały'].map(header => (
                      <th key={header} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {operatorRanking.length === 0 && (
                    <tr><td colSpan={10} className="py-8 text-center text-navy-500">Brak danych operatorow w wybranym zakresie</td></tr>
                  )}
                  {operatorRanking.map((row, index) => (
                    <tr key={row.operatorId} className="border-b border-navy-800 hover:bg-navy-800/50">
                      <td className="py-2 px-3 font-mono font-bold text-navy-400">#{index + 1}</td>
                      <td className="py-2 px-3 font-bold text-white">{row.operatorName}</td>
                      <td className={cn('py-2 px-3 font-mono font-bold', efficiencyColor(row.wEpq))}>{row.wEpq || '-'}{row.wEpq ? '%' : ''}</td>
                      <td className="py-2 px-3 font-mono font-bold text-white">{row.good.toLocaleString('pl-PL')}</td>
                      <td className={cn('py-2 px-3 font-mono font-bold', row.rejectPct > 5 ? 'text-red-400' : row.rejectPct > 2 ? 'text-amber-400' : 'text-green-400')}>
                        {row.reject.toLocaleString('pl-PL')} ({row.rejectPct}%)
                      </td>
                      <td className="py-2 px-3 font-mono text-navy-200">{row.reports}</td>
                      <td className="py-2 px-3 font-mono text-cyan-300">{row.avgPerReport.toLocaleString('pl-PL')}</td>
                      <td className="py-2 px-3 text-xs text-navy-300 min-w-[160px]">{row.machineList || '-'}</td>
                      <td className="py-2 px-3 text-xs text-navy-300">{row.shiftList || '-'}</td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {row.lowOutput > 0 && <span className="status-warn text-xs">{row.lowOutput} niski wynik</span>}
                          {row.highReject > 0 && <span className="status-danger text-xs">{row.highReject} duzy odrzut</span>}
                          {row.lowOutput === 0 && row.highReject === 0 && <span className="status-ok text-xs">stabilnie</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'forecast' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            {[
              { label: 'Faktycznie teraz', value: `${dayForecast.currentGood.toLocaleString('pl-PL')} szt`, sub: `${dayForecast.currentReports} wpisow | odrzut ${dayForecast.currentRejectPct}%`, color: 'text-white' },
              { label: 'Prognoza dnia', value: `${dayForecast.forecastGood.toLocaleString('pl-PL')} szt`, sub: `W EPQ prog. ${dayForecast.forecastWepq}%`, color: efficiencyColor(dayForecast.forecastWepq) },
              { label: 'Prognoza odrzutu', value: `${dayForecast.forecastRejectPct}%`, sub: `${dayForecast.forecastReject.toLocaleString('pl-PL')} szt szac.`, color: dayForecast.forecastRejectPct > 5 ? 'text-red-400' : dayForecast.forecastRejectPct > 2 ? 'text-amber-400' : 'text-green-400' },
              { label: 'Skutecznosc modelu', value: dayForecast.avgAccuracy === null ? '-' : `${dayForecast.avgAccuracy}%`, sub: `${dayForecast.historyDays} dni historii`, color: dayForecast.avgAccuracy === null ? 'text-navy-400' : efficiencyColor(dayForecast.avgAccuracy) }
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
                  <div className="card-title">Prognoza kontra faktyczny wynik</div>
                  <div className="card-sub">Model uczy sie z historycznego udzialu produkcji do aktualnej godziny dnia</div>
                </div>
              </div>
              <div style={{ height: 280 }}>
                <Bar data={{
                  labels: ['Faktycznie teraz', 'Prognoza dnia', 'Norma prognozowana'],
                  datasets: [{
                    label: 'szt',
                    data: [dayForecast.currentGood, dayForecast.forecastGood, dayForecast.forecastTarget],
                    backgroundColor: ['rgba(59,130,246,0.78)', 'rgba(34,197,94,0.78)', 'rgba(245,158,11,0.72)'],
                    borderRadius: 4
                  }]
                }} options={CHART_OPTS as never} />
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Jak liczona jest prognoza</div>
                  <div className="card-sub">Bez zgadywania: biezacy wynik plus wzorzec z historii</div>
                </div>
              </div>
              <div className="space-y-3 text-sm text-navy-200">
                <div className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-navy-500">Aktualny punkt dnia</div>
                  <div className="mt-1 font-mono text-white">
                    {dayForecast.currentHour === null ? 'brak wpisow' : `do ${hourLabel(dayForecast.currentHour + 1)}`}
                  </div>
                </div>
                <div className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-navy-500">Historyczny udzial</div>
                  <div className="mt-1 font-mono text-white">
                    {dayForecast.learnedSharePct === null ? 'brak wzorca' : `${dayForecast.learnedSharePct}% dnia bylo zwykle gotowe w tym momencie`}
                  </div>
                </div>
                <div className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-navy-500">Wniosek</div>
                  <div className="mt-1">
                    {dayForecast.currentGood > 0
                      ? `Jesli tempo utrzyma sie podobnie do historii, dzien powinien zamknac sie okolo ${dayForecast.forecastGood.toLocaleString('pl-PL')} szt.`
                      : 'Brakuje wpisow z wybranego dnia, wiec prognoza opiera sie glownie na sredniej historycznej.'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Kontrola skutecznosci prognozy</div>
                <div className="card-sub">Porownanie prognozy z faktycznym wynikiem na ostatnich dniach historycznych</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-700">
                    {['Data', 'Prognoza', 'Faktycznie', 'Trafnosc'].map(header => (
                      <th key={header} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayForecast.backtests.length === 0 && (
                    <tr><td colSpan={4} className="py-8 text-center text-navy-500">Za malo historii, zeby ocenic skutecznosc</td></tr>
                  )}
                  {dayForecast.backtests.map(item => (
                    <tr key={item.date} className="border-b border-navy-800 hover:bg-navy-800/50">
                      <td className="py-2 px-3 font-mono text-navy-300">{item.date}</td>
                      <td className="py-2 px-3 font-mono text-cyan-300">{item.predicted.toLocaleString('pl-PL')}</td>
                      <td className="py-2 px-3 font-mono text-white">{item.actual.toLocaleString('pl-PL')}</td>
                      <td className={cn('py-2 px-3 font-mono font-bold', efficiencyColor(item.accuracy))}>{item.accuracy}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {editingShift && shiftEditState && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="card-header">
              <div>
                <div className="card-title">Korekta zmiany</div>
                <div className="card-sub">
                  {editingShift.shift_date} | Zmiana {editingShift.shift_type} | {machineNameById[editingShift.machine_id] ?? '-'}
                </div>
              </div>
              <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => { setEditingShift(null); setShiftEditError('') }}>Zamknij</button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <label className="block">
                <span className="text-xs text-navy-400 font-bold uppercase tracking-wider">Operator 1</span>
                <select
                  className="input mt-1"
                  value={shiftEditState.operator1Id}
                  onChange={e => setShiftEditState({ ...shiftEditState, operator1Id: e.target.value })}
                >
                  <option value="">Wybierz operatora</option>
                  {operators.map(operator => <option key={operator.id} value={operator.id}>{operator.full_name}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-navy-400 font-bold uppercase tracking-wider">Operator 2</span>
                <select
                  className="input mt-1"
                  value={shiftEditState.operator2Id}
                  onChange={e => setShiftEditState({ ...shiftEditState, operator2Id: e.target.value })}
                >
                  <option value="">Brak drugiego operatora</option>
                  {operators
                    .filter(operator => operator.id !== shiftEditState.operator1Id)
                    .map(operator => <option key={operator.id} value={operator.id}>{operator.full_name}</option>)}
                </select>
              </label>

              <div className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Rozliczenie czasu zmiany</div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {([
                    ['runtimeMin', 'Czas pracy'],
                    ['readyMin', 'Gotowosc'],
                    ['alarmMin', 'Alarmy'],
                    ['downtimeMin', 'Postoje']
                  ] as const).map(([key, label]) => (
                    <TimeInput
                      key={key}
                      label={label}
                      value={shiftEditState[key]}
                      onChange={value => setShiftEditState({ ...shiftEditState, [key]: value })}
                      compact
                      showDelta={false}
                    />
                  ))}
                </div>
                <div className="mt-2 text-xs text-navy-400">
                  Suma: <span className="font-mono text-white">{minsToHHMM(
                    hhmmTotal(
                      shiftEditState.runtimeMin,
                      shiftEditState.readyMin,
                      shiftEditState.alarmMin,
                      shiftEditState.downtimeMin
                    )
                  )}</span>
                </div>
              </div>

              <label className="block">
                <span className="text-xs text-navy-400 font-bold uppercase tracking-wider">Notatka z rozliczenia</span>
                <textarea
                  className="input mt-1 min-h-[88px]"
                  value={shiftEditState.notes}
                  onChange={e => setShiftEditState({ ...shiftEditState, notes: e.target.value })}
                  placeholder="np. czas dopisany po weryfikacji raportu zmiany"
                />
              </label>

              <label className="block">
                <span className="text-xs text-navy-400 font-bold uppercase tracking-wider">Powod korekty</span>
                <input
                  className="input mt-1"
                  value={shiftEditState.reason}
                  onChange={e => setShiftEditState({ ...shiftEditState, reason: e.target.value })}
                  placeholder="np. operator nie zamknal zmiany"
                />
              </label>
            </div>

            {shiftEditError && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {shiftEditError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setEditingShift(null); setShiftEditError('') }} disabled={shiftSaving}>Anuluj</button>
              <button className="btn-primary" onClick={saveShiftCorrection} disabled={shiftSaving}>
                {shiftSaving ? 'Zapisywanie...' : 'Zapisz korekte zmiany'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && editState && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="card-header">
              <div>
                <div className="card-title">Korekta wpisu kierownika</div>
                <div className="card-sub">
                  {editing.report_date} | do {reportEndHourLabel(editing)} | blok {reportBlockLabel(editing)} | {machineNameById[editing.machine_id] ?? '-'} | Zmiana {one(editing.shift)?.shift_type ?? '-'}
                </div>
              </div>
              <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => { setEditing(null); setEditError('') }}>Zamknij</button>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 mb-3">
              Czasy pracy sa teraz rozliczane na koniec zmiany. Tutaj poprawiasz tylko wynik godzinowy, odrzut i komentarze.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                ['good_count', 'Sztuki dobre'],
                ['reject_count', 'Odrzut']
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
                <span className="text-xs text-navy-400 font-bold uppercase tracking-wider">Komentarz do wyniku</span>
                <input className="input mt-1" value={editState.downtime_reason} onChange={e => setEditState({ ...editState, downtime_reason: e.target.value })} />
                {(editing?.downtime_station || editing?.downtime_category) && (
                  <div className="text-[11px] text-navy-500 mt-1">
                    {reportStationLabel(editing?.downtime_stations, editing?.downtime_station)} · {problemCategoryLabel('downtime', editing?.downtime_category)}
                  </div>
                )}
                <select className="input mt-1 text-xs" value={editState.downtime_status} onChange={e => setEditState({ ...editState, downtime_status: e.target.value })}>
                  <option value="">Status: brak</option>
                  {ISSUE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-navy-400 font-bold uppercase tracking-wider">Komentarz do odrzutu</span>
                <input className="input mt-1" value={editState.reject_reason} onChange={e => setEditState({ ...editState, reject_reason: e.target.value })} />
                {(editing?.reject_station || editing?.reject_category) && (
                  <div className="text-[11px] text-navy-500 mt-1">
                    {reportStationLabel(editing?.reject_stations, editing?.reject_station)} · {problemCategoryLabel('reject', editing?.reject_category)}
                  </div>
                )}
                <select className="input mt-1 text-xs" value={editState.reject_status} onChange={e => setEditState({ ...editState, reject_status: e.target.value })}>
                  <option value="">Status: brak</option>
                  {ISSUE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <label className="block md:col-span-2">
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
