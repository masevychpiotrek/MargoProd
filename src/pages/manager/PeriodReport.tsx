import { useEffect, useMemo, useState } from 'react'
import { Chart } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, BarController, LineController } from 'chart.js'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { FailureReport, HourlyReport, Machine, Shift, ShiftType } from '@/types/database'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, BarController, LineController)

const TARGET_PER_SHIFT = 18000
const SHIFTS: ShiftType[] = ['I', 'II', 'III']

type PeriodMode = 'week' | 'month' | 'range'

type ReportRow = HourlyReport & {
  shift?: { shift_type: ShiftType; shift_date?: string } | { shift_type: ShiftType; shift_date?: string }[] | null
  operator?: { full_name: string } | { full_name: string }[] | null
}

type ShiftRow = Shift & {
  machine?: Pick<Machine, 'id' | 'name' | 'code'> | Pick<Machine, 'id' | 'name' | 'code'>[] | null
}

type FailureRow = FailureReport & {
  machine?: Pick<Machine, 'id' | 'name' | 'code'> | Pick<Machine, 'id' | 'name' | 'code'>[] | null
}

type Group = {
  key: string
  date: string
  shift: ShiftType
  machineId: string
  machineName: string
  good: number
  reject: number
  reports: number
  target: number
  runtime: number
  ready: number
  alarm: number
  downtime: number
  notes: string[]
  lowOutput: number
  highReject: number
}

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10)
}

function today() {
  return iso(new Date())
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return iso(d)
}

function monthEnd(date: string) {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00`)
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  return iso(d)
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function pieces(value: number) {
  return Math.round(value || 0).toLocaleString('pl-PL')
}

function pct(value: number, base: number) {
  return base > 0 ? Math.round((value / base) * 1000) / 10 : 0
}

function rejectPct(good: number, reject: number) {
  return good + reject > 0 ? Math.round((reject / (good + reject)) * 1000) / 10 : 0
}

function mins(value: number) {
  const total = Math.max(0, Math.round(value || 0))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h && !m) return '00:00'
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function esc(value: string) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}

function emptyGroup(params: Pick<Group, 'key' | 'date' | 'shift' | 'machineId' | 'machineName'>): Group {
  return {
    ...params,
    good: 0,
    reject: 0,
    reports: 0,
    target: TARGET_PER_SHIFT,
    runtime: 0,
    ready: 0,
    alarm: 0,
    downtime: 0,
    notes: [],
    lowOutput: 0,
    highReject: 0
  }
}

function noteFromReport(report: ReportRow) {
  return [
    report.downtime_reason?.trim() ? `Wynik: ${report.downtime_reason.trim()}` : '',
    report.reject_reason?.trim() ? `Odrzut: ${report.reject_reason.trim()}` : '',
    report.notes?.trim() ? `Uwagi: ${report.notes.trim()}` : ''
  ].filter(Boolean).join('. ')
}

function buildRangeLabel(from: string, to: string) {
  if (from === to) return formatDate(from)
  return `${formatDate(from)} - ${formatDate(to)}`
}

function groupData(reports: ReportRow[], shifts: ShiftRow[], machines: Machine[]) {
  const machineName = new Map(machines.map(machine => [machine.id, machine.name]))
  const groups = new Map<string, Group>()

  shifts.forEach(shift => {
    const machine = one(shift.machine)
    const name = machine?.name ?? machineName.get(shift.machine_id) ?? 'Maszyna'
    const key = `${shift.shift_date}|${shift.shift_type}|${shift.machine_id}`
    const group = groups.get(key) ?? emptyGroup({
      key,
      date: shift.shift_date,
      shift: shift.shift_type,
      machineId: shift.machine_id,
      machineName: name
    })
    group.runtime = shift.summary_runtime_min ?? group.runtime
    group.ready = shift.summary_ready_min ?? group.ready
    group.alarm = shift.summary_alarm_min ?? group.alarm
    group.downtime = shift.summary_downtime_min ?? group.downtime
    if (shift.summary_notes?.trim()) group.notes.push(`Podsumowanie zmiany: ${shift.summary_notes.trim()}`)
    groups.set(key, group)
  })

  reports.forEach(report => {
    const shift = one(report.shift)
    const shiftType = shift?.shift_type ?? 'I'
    const date = shift?.shift_date ?? report.report_date
    const key = `${date}|${shiftType}|${report.machine_id}`
    const group = groups.get(key) ?? emptyGroup({
      key,
      date,
      shift: shiftType,
      machineId: report.machine_id,
      machineName: machineName.get(report.machine_id) ?? 'Maszyna'
    })
    group.good += report.good_count ?? 0
    group.reject += report.reject_count ?? 0
    group.reports += 1
    if ((report.good_count ?? 0) > 0 && (report.good_count ?? 0) < 2000) group.lowOutput += 1
    if (rejectPct(report.good_count ?? 0, report.reject_count ?? 0) > 5) group.highReject += 1
    const note = noteFromReport(report)
    if (note) group.notes.push(`${report.hour_block}: ${note}`)
    groups.set(key, group)
  })

  return [...groups.values()].sort((a, b) =>
    a.date.localeCompare(b.date) ||
    SHIFTS.indexOf(a.shift) - SHIFTS.indexOf(b.shift) ||
    a.machineName.localeCompare(b.machineName)
  )
}

function buildEmailHtml(params: {
  from: string
  to: string
  groups: Group[]
  failures: FailureRow[]
  conclusions: string[]
}) {
  const { from, to, groups, failures, conclusions } = params
  const totalGood = groups.reduce((sum, group) => sum + group.good, 0)
  const totalReject = groups.reduce((sum, group) => sum + group.reject, 0)
  const totalTarget = groups.reduce((sum, group) => sum + group.target, 0)
  const totalRuntime = groups.reduce((sum, group) => sum + group.runtime, 0)
  const realization = pct(totalGood, totalTarget)
  const reject = rejectPct(totalGood, totalReject)
  const range = buildRangeLabel(from, to)

  const byMachine = [...new Map(groups.map(group => [group.machineId, group.machineName]))].map(([machineId, name]) => {
    const rows = groups.filter(group => group.machineId === machineId)
    const good = rows.reduce((sum, row) => sum + row.good, 0)
    const rej = rows.reduce((sum, row) => sum + row.reject, 0)
    const target = rows.reduce((sum, row) => sum + row.target, 0)
    return { name, good, rej, target, realization: pct(good, target), reject: rejectPct(good, rej) }
  })

  const rowsHtml = byMachine.map(row => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-weight:bold">${esc(row.name)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${pieces(row.good)} szt</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${pieces(row.target)} szt</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:bold">${row.realization}%</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;color:${row.reject > 5 ? '#dc2626' : '#166534'};font-weight:bold">${row.reject}%</td>
    </tr>
  `).join('')

  const detailRows = groups.map(group => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${esc(formatDate(group.date))}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">Zmiana ${group.shift}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${esc(group.machineName)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${pieces(group.good)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${pct(group.good, group.target)}%</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${rejectPct(group.good, group.reject)}%</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${mins(group.runtime)}</td>
    </tr>
  `).join('')

  const failureRows = failures.slice(0, 12).map(failure => {
    const machine = one(failure.machine)
    return `<li style="margin:0 0 8px"><strong>${esc(machine?.name ?? 'Maszyna')}</strong>: ${esc(failure.description ?? '')}</li>`
  }).join('')

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:980px">
      <div style="background:#1d4ed8;color:white;padding:18px 22px">
        <div style="font-size:20px;font-weight:700">Raport zbiorczy produkcji</div>
        <div style="margin-top:4px;font-size:13px">Okres: ${esc(range)} · MargoLine beta</div>
        <div style="font-size:12px;opacity:.9">Built on data. Driven by precision.</div>
      </div>
      <div style="padding:18px 22px;background:#ffffff;border:1px solid #dbe3ef">
        <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:18px">
          <tr>
            <td style="padding:12px;background:#eff6ff;border-left:4px solid #2563eb"><div style="font-size:11px;color:#64748b;text-transform:uppercase">Produkcja</div><div style="font-size:22px;font-weight:700">${pieces(totalGood)} szt</div></td>
            <td style="padding:12px;background:#f8fafc;border-left:4px solid #0f766e"><div style="font-size:11px;color:#64748b;text-transform:uppercase">Realizacja</div><div style="font-size:22px;font-weight:700">${realization}%</div></td>
            <td style="padding:12px;background:#fff7ed;border-left:4px solid #d97706"><div style="font-size:11px;color:#64748b;text-transform:uppercase">Odrzut</div><div style="font-size:22px;font-weight:700;color:${reject > 5 ? '#dc2626' : '#166534'}">${reject}%</div></td>
            <td style="padding:12px;background:#f8fafc;border-left:4px solid #475569"><div style="font-size:11px;color:#64748b;text-transform:uppercase">Czas pracy</div><div style="font-size:22px;font-weight:700">${mins(totalRuntime)}</div></td>
          </tr>
        </table>
        <h3 style="font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px">Podsumowanie automatow</h3>
        <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px">
          <tr style="background:#1e3a8a;color:white"><th align="left" style="padding:10px">Automat</th><th align="right" style="padding:10px">Produkcja</th><th align="right" style="padding:10px">Cel</th><th align="right" style="padding:10px">Realizacja</th><th align="right" style="padding:10px">Odrzut</th></tr>
          ${rowsHtml}
        </table>
        <h3 style="font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px;margin-top:22px">Wnioski systemowe</h3>
        <ol>${conclusions.map(item => `<li style="margin:0 0 8px">${esc(item)}</li>`).join('')}</ol>
        <h3 style="font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px;margin-top:22px">Przebieg okresu</h3>
        <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:12px">
          <tr style="background:#eaf1fb"><th align="left" style="padding:8px">Data</th><th align="left" style="padding:8px">Zmiana</th><th align="left" style="padding:8px">Automat</th><th align="right" style="padding:8px">Szt.</th><th align="right" style="padding:8px">Real.</th><th align="right" style="padding:8px">Odrzut</th><th align="right" style="padding:8px">Praca</th></tr>
          ${detailRows}
        </table>
        ${failureRows ? `<h3 style="font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px;margin-top:22px">Zdarzenia i alerty</h3><ul>${failureRows}</ul>` : ''}
        <div style="margin-top:24px;padding:12px;background:#eff6ff;color:#1e3a8a;font-size:12px;text-align:right">Dane pochodza z systemu <strong>MargoLine</strong></div>
      </div>
    </div>
  `
}

export default function ManagerPeriodReport() {
  const defaultTo = today()
  const [mode, setMode] = useState<PeriodMode>('week')
  const [from, setFrom] = useState(addDays(defaultTo, -6))
  const [to, setTo] = useState(defaultTo)
  const [month, setMonth] = useState(defaultTo.slice(0, 7))
  const [machines, setMachines] = useState<Machine[]>([])
  const [reports, setReports] = useState<ReportRow[]>([])
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [failures, setFailures] = useState<FailureRow[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const range = useMemo(() => {
    if (mode === 'week') return { from, to }
    if (mode === 'month') return { from: `${month}-01`, to: monthEnd(`${month}-01`) }
    return { from, to }
  }, [from, mode, month, to])

  useEffect(() => {
    if (mode === 'week') {
      setTo(defaultTo)
      setFrom(addDays(defaultTo, -6))
    }
  }, [mode, defaultTo])

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      const [machineRes, reportRes, shiftRes, failureRes] = await Promise.all([
        supabase.from('machines').select('*').eq('is_active', true).is('deleted_at', null).order('code'),
        supabase
          .from('hourly_reports')
          .select('*, operator:profiles!operator_id(full_name), shift:shifts!shift_id(shift_type, shift_date)')
          .gte('report_date', range.from)
          .lte('report_date', range.to)
          .is('deleted_at', null)
          .order('report_date', { ascending: true })
          .order('hour_start', { ascending: true }),
        supabase
          .from('shifts')
          .select('*, machine:machines!machine_id(id, name, code)')
          .gte('shift_date', range.from)
          .lte('shift_date', range.to)
          .order('shift_date', { ascending: true }),
        supabase
          .from('failure_reports')
          .select('*, machine:machines!machine_id(id, name, code)')
          .gte('created_at', `${range.from}T00:00:00`)
          .lte('created_at', `${range.to}T23:59:59`)
          .order('created_at', { ascending: false })
          .limit(200)
      ])
      if (!alive) return
      if (!machineRes.error) setMachines((machineRes.data ?? []) as Machine[])
      if (!reportRes.error) setReports((reportRes.data ?? []) as ReportRow[])
      if (!shiftRes.error) setShifts((shiftRes.data ?? []) as ShiftRow[])
      if (!failureRes.error) setFailures((failureRes.data ?? []) as FailureRow[])
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [range.from, range.to])

  const groups = useMemo(() => groupData(reports, shifts, machines), [machines, reports, shifts])

  const totals = useMemo(() => {
    const good = groups.reduce((sum, group) => sum + group.good, 0)
    const reject = groups.reduce((sum, group) => sum + group.reject, 0)
    const target = groups.reduce((sum, group) => sum + group.target, 0)
    const runtime = groups.reduce((sum, group) => sum + group.runtime, 0)
    const alarmLoss = groups.reduce((sum, group) => sum + group.alarm + group.downtime, 0)
    return {
      good,
      reject,
      target,
      runtime,
      alarmLoss,
      reports: groups.reduce((sum, group) => sum + group.reports, 0),
      realization: pct(good, target),
      rejectPct: rejectPct(good, reject),
      lowOutput: groups.reduce((sum, group) => sum + group.lowOutput, 0),
      highReject: groups.reduce((sum, group) => sum + group.highReject, 0)
    }
  }, [groups])

  const byMachine = useMemo(() => {
    const map = new Map<string, { machineId: string; name: string; good: number; reject: number; target: number; runtime: number; groups: number }>()
    groups.forEach(group => {
      const row = map.get(group.machineId) ?? { machineId: group.machineId, name: group.machineName, good: 0, reject: 0, target: 0, runtime: 0, groups: 0 }
      row.good += group.good
      row.reject += group.reject
      row.target += group.target
      row.runtime += group.runtime
      row.groups += 1
      map.set(group.machineId, row)
    })
    return [...map.values()].sort((a, b) => b.good - a.good)
  }, [groups])

  const byDay = useMemo(() => {
    const map = new Map<string, { date: string; good: number; reject: number; target: number }>()
    groups.forEach(group => {
      const row = map.get(group.date) ?? { date: group.date, good: 0, reject: 0, target: 0 }
      row.good += group.good
      row.reject += group.reject
      row.target += group.target
      map.set(group.date, row)
    })
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [groups])

  const conclusions = useMemo(() => {
    const list: string[] = []
    if (!groups.length) return ['Brak danych produkcyjnych dla wybranego okresu.']
    if (totals.realization >= 95) list.push(`Realizacja celu w okresie wyniosla ${totals.realization}% - wynik bliski planu.`)
    else if (totals.realization >= 85) list.push(`Realizacja celu w okresie wyniosla ${totals.realization}%. Wymagana kontrola najslabszych zmian i automatow.`)
    else list.push(`Realizacja celu w okresie wyniosla ${totals.realization}%. Wynik wymaga dzialan korygujacych.`)
    if (totals.rejectPct > 5) list.push(`Odrzut wyniosl ${totals.rejectPct}% i przekroczyl prog krytyczny 5%. Priorytetem jest analiza przyczyn jakosciowych.`)
    else list.push(`Odrzut wyniosl ${totals.rejectPct}% i pozostaje ponizej progu krytycznego 5%.`)
    if (totals.highReject) list.push(`${totals.highReject} wpisow mialo odrzut powyzej 5%.`)
    if (totals.lowOutput) list.push(`${totals.lowOutput} wpisow mialo wynik ponizej 2000 szt.`)
    const weakest = byMachine[byMachine.length - 1]
    if (weakest) list.push(`Najslabszy automat w okresie: ${weakest.name}, realizacja ${pct(weakest.good, weakest.target)}%.`)
    if (failures.length) list.push(`W okresie odnotowano ${failures.length} zgloszen i alertow w module technicznym.`)
    return list
  }, [byMachine, failures.length, groups.length, totals.highReject, totals.lowOutput, totals.realization, totals.rejectPct])

  const emailHtml = useMemo(() => buildEmailHtml({ from: range.from, to: range.to, groups, failures, conclusions }), [conclusions, failures, groups, range.from, range.to])

  const chartData = useMemo(() => ({
    labels: byDay.map(day => formatDate(day.date).slice(0, 5)),
    datasets: [
      { type: 'bar' as const, label: 'Produkcja', data: byDay.map(day => day.good), backgroundColor: '#3b82f6', borderRadius: 5 },
      { type: 'bar' as const, label: 'Cel', data: byDay.map(day => day.target), backgroundColor: 'rgba(212,175,55,.55)', borderRadius: 5 },
      { type: 'line' as const, label: 'Odrzut %', data: byDay.map(day => rejectPct(day.good, day.reject)), borderColor: '#ef4444', backgroundColor: '#ef4444', yAxisID: 'y1', tension: 0.3 }
    ]
  }), [byDay])

  async function copyReport() {
    const blob = new Blob([emailHtml], { type: 'text/html' })
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })])
      } else {
        await navigator.clipboard.writeText(emailHtml)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      const el = document.createElement('textarea')
      el.value = emailHtml
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    }
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#8FA5CC', boxWidth: 12 } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#8FA5CC' } },
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#8FA5CC' } },
      y1: { beginAtZero: true, position: 'right' as const, grid: { display: false }, ticks: { color: '#f87171', callback: (value: string | number) => `${value}%` } }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Raport zbiorczy</h1>
          <p className="mt-1 text-navy-400">Tygodniowy, miesieczny albo za dowolny okres. Dane liczone bez AI, bez przeklaman.</p>
        </div>
        <button onClick={copyReport} className="btn-primary px-5 py-3">
          {copied ? 'Skopiowano raport' : 'Kopiuj raport do maila'}
        </button>
      </div>

      <div className="card">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <div className="label">Typ raportu</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['week', 'Tydzien'],
                ['month', 'Miesiac'],
                ['range', 'Okres']
              ] as [PeriodMode, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setMode(key)} className={cn('rounded-xl border px-3 py-3 text-sm font-bold', mode === key ? 'border-brand bg-brand/20 text-white' : 'border-navy-700 bg-navy-900 text-navy-300 hover:border-navy-500')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {mode === 'month' ? (
              <label>
                <span className="label">Miesiac</span>
                <input className="input" type="month" value={month} onChange={event => setMonth(event.target.value)} />
              </label>
            ) : (
              <>
                <label>
                  <span className="label">Od</span>
                  <input className="input" type="date" value={from} onChange={event => setFrom(event.target.value)} />
                </label>
                <label>
                  <span className="label">Do</span>
                  <input className="input" type="date" value={to} onChange={event => setTo(event.target.value)} />
                </label>
              </>
            )}
            <div className="rounded-xl border border-navy-700 bg-navy-900 px-4 py-3">
              <div className="label">Zakres</div>
              <div className="font-bold text-white">{buildRangeLabel(range.from, range.to)}</div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card py-12 text-center text-navy-300">Ladowanie raportu...</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Kpi label="Produkcja" value={`${pieces(totals.good)} szt`} sub={`cel ${pieces(totals.target)} szt`} tone="text-brand" />
            <Kpi label="Realizacja" value={`${totals.realization}%`} sub="produkcja / cel zmian" tone={totals.realization >= 90 ? 'text-green-400' : totals.realization >= 80 ? 'text-amber-400' : 'text-red-400'} />
            <Kpi label="Odrzut" value={`${totals.rejectPct}%`} sub={`${pieces(totals.reject)} szt`} tone={totals.rejectPct > 5 ? 'text-red-400' : 'text-green-400'} />
            <Kpi label="Czas pracy" value={mins(totals.runtime)} sub={`straty ${mins(totals.alarmLoss)}`} tone="text-cyan-300" />
            <Kpi label="Alerty" value={failures.length} sub={`${totals.highReject} odrzut / ${totals.lowOutput} niski wynik`} tone={failures.length ? 'text-amber-400' : 'text-green-400'} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Trend okresu</div>
                  <div className="card-sub">Produkcja, cel i odrzut dzien po dniu</div>
                </div>
              </div>
              <div className="h-[360px]">
                {byDay.length ? <Chart type="bar" data={chartData} options={chartOptions} /> : <Empty text="Brak danych do wykresu" />}
              </div>
            </div>

            <div className="card">
              <div className="card-title">Wnioski systemowe</div>
              <div className="card-sub mb-4">Bez generowania liczb przez AI</div>
              <div className="space-y-3">
                {conclusions.map((item, index) => (
                  <div key={item} className="rounded-xl border border-navy-700 bg-navy-900 p-3 text-sm text-navy-100">
                    <span className="mr-2 font-mono text-brand">{index + 1}.</span>{item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="card overflow-hidden">
              <div className="card-title">Automaty w okresie</div>
              <div className="card-sub mb-4">Porownanie wzgledem celu zmianowego</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-navy-400">
                    <tr>{['Automat', 'Produkcja', 'Cel', 'Realizacja', 'Odrzut', 'Praca'].map(header => <th key={header} className="px-3 py-2 text-left">{header}</th>)}</tr>
                  </thead>
                  <tbody>
                    {byMachine.map(row => (
                      <tr key={row.machineId} className="border-t border-navy-800">
                        <td className="px-3 py-3 font-bold text-white">{row.name}</td>
                        <td className="px-3 py-3 font-mono text-brand">{pieces(row.good)}</td>
                        <td className="px-3 py-3 font-mono text-navy-300">{pieces(row.target)}</td>
                        <td className={cn('px-3 py-3 font-mono font-bold', pct(row.good, row.target) >= 90 ? 'text-green-400' : pct(row.good, row.target) >= 80 ? 'text-amber-400' : 'text-red-400')}>{pct(row.good, row.target)}%</td>
                        <td className={cn('px-3 py-3 font-mono font-bold', rejectPct(row.good, row.reject) > 5 ? 'text-red-400' : 'text-green-400')}>{rejectPct(row.good, row.reject)}%</td>
                        <td className="px-3 py-3 font-mono text-cyan-300">{mins(row.runtime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="card-title">Przebieg po zmianach</div>
              <div className="card-sub mb-4">Dzien, zmiana, automat</div>
              <div className="max-h-[460px] overflow-y-auto pr-1">
                {groups.map(group => (
                  <div key={group.key} className="mb-3 rounded-xl border border-navy-700 bg-navy-900 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-bold text-white">{formatDate(group.date)} · Zmiana {group.shift}</div>
                        <div className="text-sm text-navy-400">{group.machineName}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg font-bold text-brand">{pieces(group.good)} szt</div>
                        <div className={cn('text-xs font-bold', rejectPct(group.good, group.reject) > 5 ? 'text-red-300' : 'text-green-300')}>{rejectPct(group.good, group.reject)}% odrzutu</div>
                      </div>
                    </div>
                    {group.notes.length > 0 && (
                      <div className="mt-3 space-y-1 text-xs text-navy-300">
                        {group.notes.slice(0, 3).map(note => <div key={note} className="rounded-lg bg-navy-800 px-3 py-2">{note}</div>)}
                      </div>
                    )}
                  </div>
                ))}
                {!groups.length && <Empty text="Brak zmian w wybranym okresie" />}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Gotowy raport do maila</div>
                <div className="card-sub">Podglad tresci, ktora kopiujesz do Outlooka</div>
              </div>
              <button onClick={copyReport} className="btn-secondary px-4 py-2 text-sm">{copied ? 'Skopiowano' : 'Kopiuj HTML'}</button>
            </div>
            <div className="max-h-[620px] overflow-auto rounded-xl bg-white p-4 text-black">
              <div dangerouslySetInnerHTML={{ __html: emailHtml }} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub: string; tone: string }) {
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className={cn('mt-2 font-mono text-2xl font-bold', tone)}>{value}</div>
      <div className="mt-1 text-sm text-navy-400">{sub}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full min-h-[160px] items-center justify-center rounded-xl border border-navy-700 bg-navy-900 text-navy-500">{text}</div>
}
