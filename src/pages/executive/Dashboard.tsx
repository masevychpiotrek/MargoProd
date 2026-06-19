import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { cn, compareProductionHours, efficiencyColor, getProductionDate } from '@/lib/utils'
import type { FailureReport, HourlyReport, Machine, Shift, ShiftType } from '@/types/database'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend } from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

const TARGET_PER_HOUR = 3200
const TARGET_PER_SHIFT = 18000
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

const EXECUTIVE_CHART_OPTIONS = {
  ...CHART_OPTIONS,
  scales: {
    y: { beginAtZero: true, position: 'left' as const, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7B89A8' } },
    y1: {
      beginAtZero: true,
      position: 'right' as const,
      grid: { drawOnChartArea: false },
      ticks: { color: '#C9A84C', callback: (value: string | number) => `${value}%` }
    },
    x: { grid: { display: false }, ticks: { color: '#7B89A8' } }
  }
}

type Mode = 'day' | 'range' | 'month'
type ExecutiveTab = 'summary' | 'charts' | 'machines' | 'details'

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

function perHour(piecesCount: number, runtimeMin: number) {
  return runtimeMin > 0 ? Math.round(piecesCount / runtimeMin * 60) : 0
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
    reasons.push('Analizowany zakres osiagnal zalozony poziom realizacji produkcji.')
  } else {
    reasons.push(`Realizacja wyniosla ${params.realization}% wzgledem celu zmianowego.`)
  }
  if (params.weakestMachine && params.weakestMachineEpq > 0 && params.weakestMachineEpq < 85) {
    reasons.push(`Najwieksze odchylenie od celu odnotowano na ${params.weakestMachine}: W EPQ ${params.weakestMachineEpq}%.`)
  }
  if (params.rejectPct > 5) {
    reasons.push('Poziom odrzutu przekroczyl prog kontrolny 5%.')
  }
  if (params.lossMinutes > 0) {
    reasons.push(`Zarejestrowane straty czasu wyniosly ${mins(params.lossMinutes)}.`)
  }
  if (params.criticalFailures > 0) {
    reasons.push(`Odnotowano ${params.criticalFailures} krytyczne zgloszenia techniczne.`)
  }
  if (params.missingSummaries > 0) {
    reasons.push(`Niekompletne rozliczenia zmian: ${params.missingSummaries}.`)
  }
  return reasons.join(' ')
}

export default function ExecutiveDashboard() {
  const location = useLocation()
  const today = getProductionDate()
  const defaultDate = addDays(today, -1)
  const [mode, setMode] = useState<Mode>('day')
  const [selectedDate, setSelectedDate] = useState(defaultDate)
  const [fromDate, setFromDate] = useState(addDays(defaultDate, -6))
  const [toDate, setToDate] = useState(defaultDate)
  const [month, setMonth] = useState(defaultDate.slice(5, 7))
  const [year, setYear] = useState(defaultDate.slice(0, 4))
  const [machines, setMachines] = useState<Machine[]>([])
  const [reports, setReports] = useState<ReportWithShift[]>([])
  const [shifts, setShifts] = useState<ShiftSummary[]>([])
  const [failures, setFailures] = useState<FailureReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const activeTab: ExecutiveTab = location.pathname.endsWith('/charts')
    ? 'charts'
    : location.pathname.endsWith('/machines')
      ? 'machines'
      : location.pathname.endsWith('/details')
        ? 'details'
        : 'summary'

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
      hasRuntime: boolean
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
        failures: 0,
        hasRuntime: false
      }
    })

    const countedShiftTargets = new Set<string>()

    reports.forEach(report => {
      const shiftType = one(report.shift)?.shift_type ?? shiftFromHour(report.hour_start)
      const summaryKey = `${report.report_date}|${shiftType}|${report.machine_id}`
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
        failures: 0,
        hasRuntime: false
      }
      map[report.machine_id] = machine
      machine.good += report.good_count
      machine.reject += report.reject_count
      machine.reports += 1
      if (!shiftSummaryByKey[summaryKey] && !countedShiftTargets.has(summaryKey)) {
        machine.target += TARGET_PER_SHIFT
        countedShiftTargets.add(summaryKey)
      }
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
      machine.target += TARGET_PER_SHIFT
      if ((shift.summary_runtime_min ?? 0) > 0) machine.hasRuntime = true
    })

    Object.values(map).forEach(machine => {
      if (machine.target === 0 && machine.reports > 0) {
        machine.target = TARGET_PER_SHIFT
      }
    })

    failures.forEach(failure => {
      if (map[failure.machine_id]) map[failure.machine_id].failures += 1
    })

    return Object.values(map).filter(row => row.good || row.reject || row.reports || row.failures)
  }, [failures, machineById, machines, reports, shiftSummaryByKey, shifts])

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
      goodRate: number
      totalRate: number
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
          goodRate: 0,
          totalRate: 0,
          missingSummary: true,
          notes: []
        }
      }
      map[key].good += report.good_count
      map[key].reject += report.reject_count
      map[key].target = TARGET_PER_SHIFT
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
        goodRate: 0,
        totalRate: 0,
        missingSummary: true,
        notes: []
      }
      row.good = shift.summary_good_count ?? row.good
      row.reject = shift.summary_reject_count ?? row.reject
      row.runtime = shift.summary_runtime_min ?? 0
      row.loss = (shift.summary_ready_min ?? 0) + (shift.summary_alarm_min ?? 0) + (shift.summary_downtime_min ?? 0)
      row.target = TARGET_PER_SHIFT
      row.goodRate = perHour(row.good, row.runtime)
      row.totalRate = perHour(row.good + row.reject, row.runtime)
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
    const map: Record<string, { good: number; target: number; reject: number; loss: number }> = {}
    shiftRows.forEach(row => {
      if (!map[row.date]) map[row.date] = { good: 0, target: 0, reject: 0, loss: 0 }
      map[row.date].good += row.good
      map[row.date].target += row.target
      map[row.date].reject += row.reject
      map[row.date].loss += row.loss
    })
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, item]) => ({
        date: date.slice(5),
        fullDate: date,
        good: item.good,
        target: item.target,
        reject: item.reject,
        loss: item.loss,
        realization: pct(item.good, item.target),
        rejectPct: pct1(item.reject, item.good + item.reject)
      }))
  }, [shiftRows])

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
    const goodRate = perHour(good, runtime)
    const totalRate = perHour(good + reject, runtime)
    const rejectPct = pct1(reject, good + reject)
    const realization = pct(good, target)
    const availability = runtime + loss > 0 ? Math.round(runtime / (runtime + loss) * 100) : 0
    const rejectScore = Math.max(0, 100 - Math.round(rejectPct * 10))
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
    const healthScore = Math.max(0, Math.min(100, Math.round(realization * 0.55 + availability * 0.25 + rejectScore * 0.2 - missingSummaries * 3)))
    const riskLevel = healthScore >= 90 ? 'Stabilnie' : healthScore >= 75 ? 'Pod kontrola' : healthScore >= 60 ? 'Podwyzszone ryzyko' : 'Znaczne odchylenie'
    const targetGap = Math.max(0, target - good)
    const targetGapHours = targetGap > 0 ? Math.round(targetGap / TARGET_PER_HOUR * 10) / 10 : 0
    return { good, reject, target, runtime, loss, goodRate, totalRate, targetGap, targetGapHours, rejectPct, realization, availability, healthScore, riskLevel, missingSummaries, criticalFailures, weakest, reasonText }
  }, [failures, machineRows, shiftRows])

  const lossReasons = useMemo(() => {
    const lowOutput = shiftRows
      .filter(row => row.target > 0 && pct(row.good, row.target) < 85)
      .reduce((sum, row) => sum + Math.max(0, row.target - row.good), 0)
    const rejectLoss = kpi.reject
    const timeLoss = Math.round(kpi.loss * TARGET_PER_HOUR / 60)
    const missing = kpi.missingSummaries
    const items = [
      { label: 'Niska wydajnosc', value: lowOutput, detail: 'brakujace sztuki wzgledem celu zmianowego' },
      { label: 'Odrzut', value: rejectLoss, detail: 'sztuki niezgodne' },
      { label: 'Straty czasu', value: timeLoss, detail: `${mins(kpi.loss)} poza praca` },
      { label: 'Braki rozliczen', value: missing, detail: 'zmiany bez czasu pracy' }
    ]
    return items.sort((a, b) => b.value - a.value)
  }, [kpi.loss, kpi.missingSummaries, kpi.reject, shiftRows])

  const recommendations = useMemo(() => {
    const list: string[] = []
    if (kpi.realization < 90 && kpi.weakest) list.push(`Najwieksze odchylenie od celu dotyczy ${kpi.weakest.machineName}.`)
    if (kpi.rejectPct > 5) list.push('Poziom odrzutu przekroczyl prog kontrolny 5%.')
    if (kpi.loss > 120) list.push('Straty czasu przekroczyly 2 godziny w analizowanym zakresie.')
    if (kpi.missingSummaries > 0) list.push('Zakres zawiera niekompletne rozliczenia zmian.')
    if (!list.length) list.push('Wynik procesu pozostaje stabilny w analizowanym zakresie.')
    return list
  }, [kpi])

  const machineAnalysis = useMemo(() => {
    return machineRows.map(row => {
      const goodRate = perHour(row.good, row.runtime)
      const totalRate = perHour(row.good + row.reject, row.runtime)
      const epq = pct(row.good, row.target)
      const rejectPct = pct1(row.reject, row.good + row.reject)
      const gap = Math.max(0, row.target - row.good)
      const lossPieces = Math.round((row.ready + row.alarm + row.downtime) * TARGET_PER_HOUR / 60)
      const focus = !row.hasRuntime
        ? 'Niekompletne rozliczenie czasu pracy ogranicza pelna ocene wskaznikow.'
        : epq < 75
          ? 'Glownym obszarem odchylenia jest tempo procesu oraz dostepnosc maszyny.'
          : rejectPct > 5
            ? 'Glownym obszarem odchylenia jest poziom odrzutu jakosciowego.'
            : lossPieces > 0
              ? 'Na wynik wplynely zarejestrowane straty czasu.'
              : 'Proces pozostaje stabilny w analizowanym zakresie.'
      const verdict = !row.hasRuntime
        ? 'Niepelne dane'
        : epq >= 95 && rejectPct <= 5
          ? 'Stabilny'
          : epq >= 80 && rejectPct <= 5
            ? 'Do obserwacji'
            : 'Odchylenie'
      return {
        ...row,
        goodRate,
        totalRate,
        epq,
        rejectPct,
        gap,
        gapHours: gap > 0 ? Math.round(gap / TARGET_PER_HOUR * 10) / 10 : 0,
        lossPieces,
        focus,
        verdict
      }
    }).sort((a, b) => a.epq - b.epq)
  }, [machineRows])

  const bestMachine = [...machineAnalysis].sort((a, b) => b.epq - a.epq)[0]
  const worstMachine = machineAnalysis[0]

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

  const rateChart = {
    labels: machineAnalysis.map(row => row.machineName),
    datasets: [
      {
        label: 'Dobre szt/h',
        data: machineAnalysis.map(row => row.goodRate),
        backgroundColor: 'rgba(34,197,94,0.72)',
        borderRadius: 4
      },
      {
        label: 'Total szt/h',
        data: machineAnalysis.map(row => row.totalRate),
        backgroundColor: 'rgba(59,130,246,0.72)',
        borderRadius: 4
      },
      {
        type: 'line' as const,
        label: 'Norma 3200 szt/h',
        data: machineAnalysis.map(() => TARGET_PER_HOUR),
        borderColor: '#C9A84C',
        backgroundColor: 'rgba(201,168,76,0.12)',
        tension: 0,
        pointRadius: 0
      }
    ]
  }

  const gapChart = {
    labels: machineAnalysis.map(row => row.machineName),
    datasets: [
      {
        label: 'Brak do celu',
        data: machineAnalysis.map(row => row.gap),
        backgroundColor: 'rgba(239,68,68,0.70)',
        borderRadius: 4
      },
      {
        label: 'Strata czasu w szt.',
        data: machineAnalysis.map(row => row.lossPieces),
        backgroundColor: 'rgba(245,158,11,0.70)',
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

  const executivePeriodChart = {
    labels: dailyTrend.map(item => item.date),
    datasets: [
      {
        type: 'bar' as const,
        label: 'Produkcja',
        data: dailyTrend.map(item => item.good),
        backgroundColor: 'rgba(59,130,246,0.72)',
        borderRadius: 4,
        yAxisID: 'y'
      },
      {
        type: 'bar' as const,
        label: 'Cel',
        data: dailyTrend.map(item => item.target),
        backgroundColor: 'rgba(201,168,76,0.35)',
        borderRadius: 4,
        yAxisID: 'y'
      },
      {
        type: 'line' as const,
        label: 'Realizacja %',
        data: dailyTrend.map(item => item.realization),
        borderColor: '#22C55E',
        backgroundColor: 'rgba(34,197,94,0.15)',
        tension: 0.25,
        yAxisID: 'y1'
      },
      {
        type: 'line' as const,
        label: 'Odrzut %',
        data: dailyTrend.map(item => item.rejectPct),
        borderColor: '#EF4444',
        backgroundColor: 'rgba(239,68,68,0.12)',
        tension: 0.25,
        yAxisID: 'y1'
      }
    ]
  }

  const biggestDailyDrop = dailyTrend
    .filter(item => item.target > 0)
    .sort((a, b) => a.realization - b.realization)[0]

  const executiveSignals = [
    {
      label: 'Ocena procesu',
      value: `${kpi.healthScore}/100`,
      sub: kpi.riskLevel,
      color: kpi.healthScore >= 90 ? 'text-green-400' : kpi.healthScore >= 75 ? 'text-amber-300' : 'text-red-400'
    },
    {
      label: 'Dostepnosc',
      value: kpi.availability ? `${kpi.availability}%` : '-',
      sub: 'praca / caly rozliczony czas',
      color: kpi.availability >= 85 ? 'text-green-400' : kpi.availability >= 70 ? 'text-amber-300' : 'text-red-400'
    },
    {
      label: 'Najsłabszy dzien',
      value: biggestDailyDrop ? `${biggestDailyDrop.realization}%` : '-',
      sub: biggestDailyDrop?.fullDate ?? 'brak danych',
      color: biggestDailyDrop && biggestDailyDrop.realization < 80 ? 'text-red-400' : 'text-amber-300'
    }
  ]

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
          <div className="text-xs font-bold uppercase tracking-widest text-brand">Raport zarządczy</div>
          <h1 className="mt-1 text-3xl font-black text-white">Wynik produkcji i analiza odchyleń</h1>
          <p className="mt-1 max-w-3xl text-sm text-navy-400">
            Cel, wykonanie, jakość, dostępność oraz wpływ zdarzeń technicznych w wybranym zakresie.
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

      {activeTab === 'summary' && (
        <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {executiveSignals.map(item => (
          <div key={item.label} className="rounded-2xl border border-navy-600 bg-navy-800 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400">{item.label}</div>
            <div className={cn('mt-2 text-3xl font-black', item.color)}>{loading ? '...' : item.value}</div>
            <div className="mt-1 text-sm text-navy-400">{item.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        {[
          { label: 'Śr. wydajność zgodna', value: kpi.goodRate ? `${pieces(kpi.goodRate)} szt/h` : '-', sub: 'produkcja zgodna', color: kpi.goodRate >= TARGET_PER_HOUR ? 'text-green-400' : kpi.goodRate >= 2500 ? 'text-amber-300' : 'text-red-400' },
          { label: 'Śr. tempo procesu', value: kpi.totalRate ? `${pieces(kpi.totalRate)} szt/h` : '-', sub: 'produkcja całkowita', color: kpi.totalRate >= TARGET_PER_HOUR ? 'text-green-400' : kpi.totalRate >= 2500 ? 'text-amber-300' : 'text-red-400' },
          { label: 'Odchylenie od celu', value: `${pieces(kpi.targetGap)} szt`, sub: kpi.targetGapHours ? `${kpi.targetGapHours}h potencjalu` : 'cel zrealizowany', color: kpi.targetGap ? 'text-red-400' : 'text-green-400' },
          { label: 'Największe odchylenie', value: worstMachine?.machineName ?? '-', sub: worstMachine ? `${worstMachine.epq}% W EPQ | ${pieces(worstMachine.goodRate)} szt/h` : 'brak danych', color: worstMachine && worstMachine.epq < 80 ? 'text-red-400' : 'text-amber-300' }
        ].map(item => (
          <div key={item.label} className="rounded-2xl border border-navy-600 bg-navy-800 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400">{item.label}</div>
            <div className={cn('mt-2 text-2xl font-black', item.color)}>{loading ? '...' : item.value}</div>
            <div className="mt-1 text-sm text-navy-400">{item.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        {[
          { label: 'Produkcja', value: `${pieces(kpi.good)} szt`, sub: `cel ${pieces(kpi.target)} szt`, color: 'text-brand' },
            { label: 'Realizacja celu', value: `${kpi.realization}%`, sub: 'cel 18 000 szt / zmiana / automat', color: efficiencyColor(kpi.realization) },
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

      <div className="card border-brand/20">
        <div className="card-header">
          <div>
            <div className="card-title">Obraz wybranego okresu</div>
            <div className="card-sub">Zestawienie produkcji, celu, realizacji oraz odrzutu w jednym ujęciu.</div>
          </div>
        </div>
        <div className="h-[360px]">
          <Bar data={executivePeriodChart as never} options={EXECUTIVE_CHART_OPTIONS as never} />
        </div>
      </div>

      <div className="card border-brand/25">
        <div className="card-header">
          <div>
            <div className="card-title">Uzasadnienie wyniku</div>
            <div className="card-sub">Syntetyczne podsumowanie produkcji, jakości, strat czasu i zdarzeń technicznych</div>
          </div>
          <span className={cn('rounded-full px-3 py-1 text-xs font-bold', kpi.realization >= 100 ? 'bg-green-500/10 text-green-300' : kpi.realization >= 90 ? 'bg-amber-500/10 text-amber-300' : 'bg-red-500/10 text-red-300')}>
            {kpi.realization >= 100 ? 'Realizacja celu' : kpi.realization >= 90 ? 'Odchylenie kontrolowane' : 'Odchylenie od celu'}
          </span>
        </div>
        <p className="text-base leading-relaxed text-navy-100">{loading ? 'Ladowanie analizy...' : kpi.reasonText}</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Ranking przyczyn strat</div>
              <div className="card-sub">Najwieksze zrodla odchylenia od celu</div>
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
              <div className="card-sub">Priorytety wynikajace z danych produkcyjnych</div>
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
        </div>
      )}

      {activeTab === 'charts' && (
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card xl:col-span-2">
          <div className="card-header">
            <div>
              <div className="card-title">Średnia wydajność godzinowa automatów</div>
              <div className="card-sub">Dobre szt/h i total szt/h w porównaniu do normy producenta 3200 szt/h</div>
            </div>
          </div>
          <div className="h-[320px]"><Bar data={rateChart as never} options={CHART_OPTIONS as never} /></div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Realizacja vs cel</div>
              <div className="card-sub">Zestawienie automatów względem celu 18 000 szt na zmianę</div>
            </div>
          </div>
          <div className="h-[300px]"><Bar data={machineChart} options={CHART_OPTIONS as never} /></div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Odrzut według automatów</div>
              <div className="card-sub">Prog ostrzegawczy: 5%</div>
            </div>
          </div>
          <div className="h-[300px]"><Bar data={rejectChart} options={CHART_OPTIONS as never} /></div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Odchylenie od celu i wpływ czasu</div>
              <div className="card-sub">Luka produkcyjna oraz wpływ zarejestrowanych strat czasu</div>
            </div>
          </div>
          <div className="h-[300px]"><Bar data={gapChart} options={CHART_OPTIONS as never} /></div>
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

        <div className="card xl:col-span-2">
          <div className="card-header">
            <div>
              <div className="card-title">Przyrost godzinowy</div>
              <div className="card-sub">Rozkład produkcji godzinowej według automatów</div>
            </div>
          </div>
          <div className="h-[360px]"><Bar data={hourlyChart} options={CHART_OPTIONS as never} /></div>
        </div>
      </div>
      )}

      {activeTab === 'machines' && (
      <>
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Ranking przyczyn strat</div>
              <div className="card-sub">Największe źródła odchylenia od celu</div>
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
              <div className="card-sub">Priorytety wynikające z danych produkcyjnych</div>
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
            <div className="card-title">Analiza automatów</div>
            <div className="card-sub">Ocena automatów według tempa, jakości, celu i strat czasu</div>
          </div>
          {bestMachine && (
            <div className="grid gap-2 text-right sm:grid-cols-2">
              <div className="rounded-xl border border-green-500/25 bg-green-500/10 px-3 py-2">
                <div className="text-xs font-bold uppercase tracking-wider text-green-300">Najlepszy automat</div>
                <div className="text-sm font-black text-white">{bestMachine.machineName} | {bestMachine.epq}%</div>
              </div>
              {worstMachine && (
                <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-red-300">Największe odchylenie</div>
                  <div className="text-sm font-black text-white">{worstMachine.machineName} | {worstMachine.epq}%</div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {machineAnalysis.map(row => (
            <div key={row.machineId} className="rounded-2xl border border-navy-700 bg-navy-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-black text-white">{row.machineName}</div>
                  <div className="mt-1 text-sm text-navy-400">
                    {pieces(row.good)} szt | odrzut {row.rejectPct}% | {row.failures} awarii
                  </div>
                </div>
                <span className={cn('rounded-full px-3 py-1 text-xs font-bold', row.epq >= 90 ? 'bg-green-500/10 text-green-300' : row.epq >= 75 ? 'bg-amber-500/10 text-amber-300' : 'bg-red-500/10 text-red-300')}>
                  {row.verdict} | {row.epq}% W EPQ
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-navy-800 p-3">
                  <div className="text-xs uppercase tracking-wider text-navy-500">Dobre szt/h</div>
                  <div className={cn('mt-1 font-mono text-xl font-black', row.goodRate >= TARGET_PER_HOUR ? 'text-green-400' : row.goodRate >= 2500 ? 'text-amber-300' : 'text-red-400')}>{row.goodRate ? pieces(row.goodRate) : '-'}</div>
                </div>
                <div className="rounded-xl bg-navy-800 p-3">
                  <div className="text-xs uppercase tracking-wider text-navy-500">Total szt/h</div>
                  <div className={cn('mt-1 font-mono text-xl font-black', row.totalRate >= TARGET_PER_HOUR ? 'text-green-400' : row.totalRate >= 2500 ? 'text-amber-300' : 'text-red-400')}>{row.totalRate ? pieces(row.totalRate) : '-'}</div>
                </div>
                <div className="rounded-xl bg-navy-800 p-3">
                  <div className="text-xs uppercase tracking-wider text-navy-500">Brak do celu</div>
                  <div className={cn('mt-1 font-mono text-xl font-black', row.gap ? 'text-red-400' : 'text-green-400')}>{pieces(row.gap)}</div>
                  <div className="mt-1 text-xs text-navy-500">{row.gapHours ? `ok. ${row.gapHours}h potencjalu` : 'brak luki'}</div>
                </div>
                <div className="rounded-xl bg-navy-800 p-3">
                  <div className="text-xs uppercase tracking-wider text-navy-500">Straty czasu</div>
                  <div className={cn('mt-1 font-mono text-xl font-black', row.lossPieces ? 'text-amber-300' : 'text-green-400')}>{pieces(row.lossPieces)} szt</div>
                  <div className="mt-1 text-xs text-navy-500">potencjał wg 3200 szt/h</div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-navy-700 bg-navy-800 p-3">
                <div className="text-xs font-bold uppercase tracking-wider text-navy-500">Wniosek</div>
                <p className="mt-1 text-sm leading-relaxed text-navy-100">{row.focus}</p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className={cn('rounded-lg px-3 py-2 font-bold', row.hasRuntime ? 'bg-green-500/10 text-green-300' : 'bg-amber-500/10 text-amber-300')}>
                  {row.hasRuntime ? 'Czas rozliczony' : 'Brak czasu'}
                </div>
                <div className={cn('rounded-lg px-3 py-2 font-bold', row.rejectPct > 5 ? 'bg-red-500/10 text-red-300' : 'bg-green-500/10 text-green-300')}>
                  Odrzut {row.rejectPct}%
                </div>
                <div className={cn('rounded-lg px-3 py-2 font-bold', row.failures ? 'bg-amber-500/10 text-amber-300' : 'bg-green-500/10 text-green-300')}>
                  Awarie {row.failures}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      </>
      )}

      {activeTab === 'details' && (
      <div className="space-y-4">
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
                {['Data', 'Zmiana', 'Maszyna', 'Produkcja', 'Cel', 'Szt/h', 'Total szt/h', 'W EPQ', 'Odrzut', 'Strata czasu', 'Status'].map(header => (
                  <th key={header} className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-navy-400">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shiftRows.length === 0 && (
                <tr><td colSpan={11} className="py-8 text-center text-navy-500">Brak danych w wybranym zakresie</td></tr>
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
                    <td className={cn('px-3 py-2 font-mono font-bold', row.goodRate >= TARGET_PER_HOUR ? 'text-green-400' : row.goodRate >= 2500 ? 'text-amber-300' : 'text-red-400')}>{row.goodRate ? pieces(row.goodRate) : '-'}</td>
                    <td className={cn('px-3 py-2 font-mono font-bold', row.totalRate >= TARGET_PER_HOUR ? 'text-green-400' : row.totalRate >= 2500 ? 'text-amber-300' : 'text-red-400')}>{row.totalRate ? pieces(row.totalRate) : '-'}</td>
                    <td className={cn('px-3 py-2 font-mono font-bold', efficiencyColor(epq))}>{epq}%</td>
                    <td className={cn('px-3 py-2 font-mono font-bold', rejectPct > 5 ? 'text-red-400' : rejectPct > 2 ? 'text-amber-400' : 'text-green-400')}>{rejectPct}%</td>
                    <td className="px-3 py-2 font-mono text-amber-300">{row.loss ? mins(row.loss) : '-'}</td>
                    <td className="px-3 py-2">
                      <span className={cn('rounded-full px-2 py-1 text-xs font-bold', row.missingSummary ? 'bg-amber-500/10 text-amber-300' : epq >= 90 ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300')}>
                        {row.missingSummary ? 'Niekompletne dane' : epq >= 90 ? 'Stabilnie' : 'Odchylenie'}
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
      )}
    </div>
  )
}
