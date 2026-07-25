import { useEffect, useMemo, useState } from 'react'
import { Chart } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, BarController, LineController } from 'chart.js'
import { supabase } from '@/lib/supabase'
import { cn, getProductionDate } from '@/lib/utils'
import { issueStatusLabel, problemCategoryLabel, reportStationLabel, stationLabel } from '@/lib/issueReports'
import type { PeriodAiStationAllocation } from '@/lib/periodReportAi'
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
  reporter?: { full_name: string } | { full_name: string }[] | null
  assignee?: { full_name: string } | { full_name: string }[] | null
  shift?: { shift_type: ShiftType; shift_date: string } | { shift_type: ShiftType; shift_date: string }[] | null
}

type OperatorIssueKind = 'performance' | 'reject' | 'note' | 'failure'

type OperatorIssue = {
  id: string
  date: string
  sortAt: string
  shift: ShiftType | null
  hour: string | null
  machineId: string
  machineName: string
  kind: OperatorIssueKind
  source: 'Wpis godzinowy' | 'Zgłoszenie awarii'
  title: string
  description: string
  station: string | null
  stations: PeriodAiStationAllocation[]
  action: string | null
  status: string | null
  operator: string | null
  severity: string | null
  photoUrls: string[]
}

type RecurringIssue = {
  key: string
  label: string
  station: string | null
  count: number
  machines: string[]
  lastDate: string
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
  return getProductionDate()
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

function productionBoundaryIso(date: string, hour = 6) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString()
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const FAILURE_CATEGORY_LABELS: Record<string, string> = {
  mechanical_failure: 'Awaria mechaniczna',
  electrical_failure: 'Awaria elektryczna',
  quality_control: 'Problem jakościowy',
  material_shortage: 'Brak materiału',
  process_issue: 'Problem procesu',
  logistics_issue: 'Problem logistyczny',
  changeover: 'Przezbrojenie',
  cleaning: 'Czyszczenie',
  no_operator: 'Brak operatora',
  other: 'Inne'
}

const FAILURE_STATUS_LABELS: Record<string, string> = {
  new: 'Nowe',
  acknowledged: 'Przyjęte',
  in_progress: 'W trakcie',
  unresolved: 'Nierozwiązane',
  resolved: 'Rozwiązane'
}

const SEVERITY_LABELS: Record<string, string> = {
  low: 'Niska',
  medium: 'Średnia',
  high: 'Wysoka',
  critical: 'Krytyczna'
}

function cleanLabel(value: string | null | undefined) {
  if (!value || value === '—') return null
  return value
}

function canonicalStationKey(value: string) {
  const stationNumber = value.match(/(?:^|\b)(?:stacja|st)[\s_-]*(\d{1,3})(?:\b|$)/i)
  if (stationNumber) return `st_${Number(stationNumber[1])}`
  return `area_${value
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)}`
}

function stationAllocations(
  allocations: Array<{ station: string; pct: number }> | null | undefined,
  single: string | null | undefined
): PeriodAiStationAllocation[] {
  if (allocations?.length) {
    return allocations
      .map(item => ({
        key: item.station,
        label: stationLabel(item.station),
        pct: Math.max(0, Math.min(100, Number(item.pct) || 0))
      }))
      .filter(item => item.key && item.label !== '—')
  }

  const label = cleanLabel(stationLabel(single))
  return label && single
    ? [{ key: canonicalStationKey(single), label, pct: 100 }]
    : []
}

function operatorIssuesFromData(reports: ReportRow[], failures: FailureRow[], machines: Machine[]) {
  const machineNames = new Map(machines.map(machine => [machine.id, machine.name]))
  const issues: OperatorIssue[] = []

  reports.forEach(report => {
    const shift = one(report.shift)
    const operator = one(report.operator)?.full_name ?? null
    const machineName = machineNames.get(report.machine_id) ?? 'Maszyna'
    const date = shift?.shift_date ?? report.report_date
    const base = {
      date,
      sortAt: `${date}T${String(report.hour_start).padStart(2, '0')}:00:00`,
      shift: shift?.shift_type ?? null,
      hour: report.hour_block || null,
      machineId: report.machine_id,
      machineName,
      operator,
      severity: null,
      photoUrls: [] as string[]
    }

    if (report.downtime_reason?.trim()) {
      issues.push({
        ...base,
        id: `${report.id}-performance`,
        kind: 'performance',
        source: 'Wpis godzinowy',
        title: cleanLabel(problemCategoryLabel('downtime', report.downtime_problem_name)) ?? 'Przebieg pracy / niska wydajność',
        description: report.downtime_reason.trim(),
        station: cleanLabel(reportStationLabel(report.downtime_stations, report.downtime_station)),
        stations: stationAllocations(report.downtime_stations, report.downtime_station),
        action: report.downtime_action_taken?.trim() || null,
        status: cleanLabel(issueStatusLabel(report.downtime_status))
      })
    }

    if (report.reject_reason?.trim()) {
      issues.push({
        ...base,
        id: `${report.id}-reject`,
        kind: 'reject',
        source: 'Wpis godzinowy',
        title: cleanLabel(problemCategoryLabel('reject', report.reject_problem_name)) ?? 'Podwyższony odrzut',
        description: report.reject_reason.trim(),
        station: cleanLabel(reportStationLabel(report.reject_stations, report.reject_station)),
        stations: stationAllocations(report.reject_stations, report.reject_station),
        action: report.reject_action_taken?.trim() || null,
        status: cleanLabel(issueStatusLabel(report.reject_status))
      })
    }

    if (report.notes?.trim()) {
      issues.push({
        ...base,
        id: `${report.id}-note`,
        kind: 'note',
        source: 'Wpis godzinowy',
        title: 'Dodatkowa informacja operatora',
        description: report.notes.trim(),
        station: null,
        stations: [],
        action: null,
        status: null
      })
    }
  })

  failures.filter(failure => !failure.auto_generated).forEach(failure => {
    const machine = one(failure.machine)
    const shift = one(failure.shift)
    const reporter = one(failure.reporter)
    issues.push({
      id: `${failure.id}-failure`,
      date: shift?.shift_date ?? getProductionDate(new Date(failure.created_at)),
      sortAt: failure.created_at,
      shift: shift?.shift_type ?? null,
      hour: formatTimestamp(failure.created_at),
      machineId: failure.machine_id,
      machineName: machine?.name ?? machineNames.get(failure.machine_id) ?? 'Maszyna',
      kind: 'failure',
      source: 'Zgłoszenie awarii',
      title: FAILURE_CATEGORY_LABELS[failure.category] ?? failure.category,
      description: failure.description.trim(),
      station: failure.station?.trim() || null,
      stations: failure.station?.trim()
        ? [{
            key: canonicalStationKey(failure.station),
            label: cleanLabel(stationLabel(failure.station)) ?? failure.station.trim(),
            pct: 100
          }]
        : [],
      action: failure.resolution_notes?.trim() || null,
      status: FAILURE_STATUS_LABELS[failure.status] ?? failure.status,
      operator: reporter?.full_name ?? null,
      severity: SEVERITY_LABELS[failure.severity] ?? failure.severity,
      photoUrls: failure.photo_urls ?? []
    })
  })

  return issues.sort((a, b) => b.sortAt.localeCompare(a.sortAt))
}

function recurringIssuesFrom(items: OperatorIssue[]) {
  const map = new Map<string, RecurringIssue>()
  items.forEach(item => {
    const station = item.station?.trim() || null
    const key = `${item.title.toLocaleLowerCase('pl-PL')}|${station?.toLocaleLowerCase('pl-PL') ?? ''}`
    const row = map.get(key) ?? {
      key,
      label: item.title,
      station,
      count: 0,
      machines: [],
      lastDate: item.date
    }
    row.count += 1
    if (!row.machines.includes(item.machineName)) row.machines.push(item.machineName)
    if (item.date > row.lastDate) row.lastDate = item.date
    map.set(key, row)
  })
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate))
}

function issueKindLabel(kind: OperatorIssueKind) {
  if (kind === 'performance') return 'Przebieg / wydajność'
  if (kind === 'reject') return 'Odrzut'
  if (kind === 'failure') return 'Awaria'
  return 'Uwaga operatora'
}

function issueKindClass(kind: OperatorIssueKind) {
  if (kind === 'reject') return 'border-red-500/35 bg-red-500/10 text-red-300'
  if (kind === 'failure') return 'border-orange-500/35 bg-orange-500/10 text-orange-300'
  if (kind === 'performance') return 'border-amber-500/35 bg-amber-500/10 text-amber-300'
  return 'border-blue-500/35 bg-blue-500/10 text-blue-300'
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
  machineLabel: string
  groups: Group[]
  reports: ReportRow[]
  operatorIssues: OperatorIssue[]
  recurringIssues: RecurringIssue[]
  conclusions: string[]
}) {
  const { from, to, machineLabel, groups, reports, operatorIssues, recurringIssues, conclusions } = params
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

  const dayMap = new Map<string, { date: string; good: number; reject: number; target: number }>()
  groups.forEach(group => {
    const row = dayMap.get(group.date) ?? { date: group.date, good: 0, reject: 0, target: 0 }
    row.good += group.good
    row.reject += group.reject
    row.target += group.target
    dayMap.set(group.date, row)
  })
  const dayStats = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  const dayRows = dayStats.map(day => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${esc(formatDate(day.date))}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${pieces(day.good)} szt</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${pct(day.good, day.target)}%</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;color:${rejectPct(day.good, day.reject) > 5 ? '#dc2626' : '#166534'}">${rejectPct(day.good, day.reject)}%</td>
    </tr>
  `).join('')

  const hourMap = new Map<string, { hourBlock: string; hourStart: number; good: number; reject: number; entries: number }>()
  reports.forEach(report => {
    const hourStart = report.hour_start ?? 0
    const hourBlock = report.hour_block || `Godz. ${hourStart}`
    const row = hourMap.get(hourBlock) ?? { hourBlock, hourStart, good: 0, reject: 0, entries: 0 }
    row.good += report.good_count ?? 0
    row.reject += report.reject_count ?? 0
    row.entries += 1
    hourMap.set(hourBlock, row)
  })
  const hourStats = [...hourMap.values()].sort((a, b) => a.hourStart - b.hourStart)
  const hourRows = hourStats.map(hour => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${esc(hour.hourBlock)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${hour.entries}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${pieces(hour.good)} szt</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${pieces(Math.round(hour.good / hour.entries))} szt</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;color:${rejectPct(hour.good, hour.reject) > 5 ? '#dc2626' : '#166534'}">${rejectPct(hour.good, hour.reject)}%</td>
    </tr>
  `).join('')

  const recurringRows = recurringIssues.slice(0, 10).map(issue => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:bold">${esc(issue.label)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${esc(issue.station ?? '-')}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${esc(issue.machines.join(', '))}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:bold">${issue.count}</td>
    </tr>
  `).join('')

  const operatorIssueRows = operatorIssues.map(issue => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;white-space:nowrap">${esc(formatDate(issue.date))}<br><span style="color:#64748b">${esc(issue.shift ? `Zmiana ${issue.shift}` : 'Bez przypisanej zmiany')}${issue.hour ? ` · ${esc(issue.hour)}` : ''}</span></td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top"><strong>${esc(issue.machineName)}</strong><br><span style="color:#64748b">${esc(issue.source)}</span></td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top"><strong>${esc(issue.title)}</strong>${issue.station ? `<br><span style="color:#64748b">${esc(issue.station)}</span>` : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top">${esc(issue.description)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top">${issue.action ? esc(issue.action) : '-'}${issue.status ? `<br><span style="color:#64748b">Status: ${esc(issue.status)}</span>` : ''}${issue.photoUrls.length ? `<br>${issue.photoUrls.map((url, index) => `<a href="${esc(url)}" style="color:#2563eb">Zdjecie ${index + 1}</a>`).join(' · ')}` : ''}</td>
    </tr>
  `).join('')

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:980px">
      <div style="background:#1d4ed8;color:white;padding:18px 22px">
        <div style="font-size:20px;font-weight:700">Raport zbiorczy produkcji</div>
        <div style="margin-top:4px;font-size:13px">Okres: ${esc(range)} · ${esc(machineLabel)} · MargoLine beta</div>
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
        <h3 style="font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px">Podsumowanie automatów</h3>
        <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px">
          <tr style="background:#1e3a8a;color:white"><th align="left" style="padding:10px">Automat</th><th align="right" style="padding:10px">Produkcja</th><th align="right" style="padding:10px">Cel</th><th align="right" style="padding:10px">Realizacja</th><th align="right" style="padding:10px">Odrzut</th></tr>
          ${rowsHtml}
        </table>
        <h3 style="font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px;margin-top:22px">Wnioski systemowe</h3>
        <ol>${conclusions.map(item => `<li style="margin:0 0 8px">${esc(item)}</li>`).join('')}</ol>
        ${recurringRows ? `
          <h3 style="font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px;margin-top:22px">Najczęściej zgłaszane problemy</h3>
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:12px">
            <tr style="background:#eaf1fb"><th align="left" style="padding:8px">Problem</th><th align="left" style="padding:8px">Stacja / obszar</th><th align="left" style="padding:8px">Automat</th><th align="right" style="padding:8px">Liczba wpisów</th></tr>
            ${recurringRows}
          </table>
        ` : ''}
        <h3 style="font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px;margin-top:22px">Przebieg okresu</h3>
        <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:12px">
          <tr style="background:#eaf1fb"><th align="left" style="padding:8px">Data</th><th align="left" style="padding:8px">Zmiana</th><th align="left" style="padding:8px">Automat</th><th align="right" style="padding:8px">Szt.</th><th align="right" style="padding:8px">Real.</th><th align="right" style="padding:8px">Odrzut</th><th align="right" style="padding:8px">Praca</th></tr>
          ${detailRows}
        </table>
        ${operatorIssueRows ? `
          <h3 style="font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px;margin-top:22px">Problemy i działania zarejestrowane przez operatorów</h3>
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:11px">
            <tr style="background:#1e3a8a;color:white"><th align="left" style="padding:8px">Kiedy</th><th align="left" style="padding:8px">Źródło</th><th align="left" style="padding:8px">Klasyfikacja</th><th align="left" style="padding:8px">Opis operatora</th><th align="left" style="padding:8px">Działanie / status</th></tr>
            ${operatorIssueRows}
          </table>
        ` : ''}
        ${dayRows ? `
          <h3 style="font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px;margin-top:22px">Wydajność dzień po dniu</h3>
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:12px">
            <tr style="background:#eaf1fb"><th align="left" style="padding:8px">Data</th><th align="right" style="padding:8px">Produkcja</th><th align="right" style="padding:8px">Realizacja</th><th align="right" style="padding:8px">Odrzut</th></tr>
            ${dayRows}
          </table>
        ` : ''}
        ${hourRows ? `
          <h3 style="font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px;margin-top:22px">Wydajność godzina po godzinie</h3>
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:12px">
            <tr style="background:#eaf1fb"><th align="left" style="padding:8px">Godzina</th><th align="right" style="padding:8px">Wpisów</th><th align="right" style="padding:8px">Suma dobrych</th><th align="right" style="padding:8px">Śr. na wpis</th><th align="right" style="padding:8px">Odrzut</th></tr>
            ${hourRows}
          </table>
        ` : ''}
        <div style="margin-top:24px;padding:12px;background:#eff6ff;color:#1e3a8a;font-size:12px;text-align:right">Dane pochodzą z systemu <strong>MargoLine</strong></div>
      </div>
    </div>
  `
}

function buildAiExportText(params: {
  from: string
  to: string
  machineLabel: string
  groups: Group[]
  reports: ReportRow[]
  shifts: ShiftRow[]
  operatorIssues: OperatorIssue[]
}) {
  const { from, to, machineLabel, groups, reports, shifts, operatorIssues } = params
  const range = buildRangeLabel(from, to)
  const totalGood = groups.reduce((sum, group) => sum + group.good, 0)
  const totalReject = groups.reduce((sum, group) => sum + group.reject, 0)
  const totalTarget = groups.reduce((sum, group) => sum + group.target, 0)
  const totalRuntime = groups.reduce((sum, group) => sum + group.runtime, 0)
  const totalLoss = groups.reduce((sum, group) => sum + group.alarm + group.downtime, 0)

  const dayMap = new Map<string, { date: string; good: number; reject: number; target: number }>()
  groups.forEach(group => {
    const row = dayMap.get(group.date) ?? { date: group.date, good: 0, reject: 0, target: 0 }
    row.good += group.good
    row.reject += group.reject
    row.target += group.target
    dayMap.set(group.date, row)
  })
  const dayLines = [...dayMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(day => `${formatDate(day.date)}: produkcja ${pieces(day.good)} szt / cel ${pieces(day.target)} szt / realizacja ${pct(day.good, day.target)}% / odrzut ${rejectPct(day.good, day.reject)}%`)

  const hourMap = new Map<string, { hourBlock: string; hourStart: number; good: number; reject: number; entries: number }>()
  reports.forEach(report => {
    const hourStart = report.hour_start ?? 0
    const hourBlock = report.hour_block || `Godz. ${hourStart}`
    const row = hourMap.get(hourBlock) ?? { hourBlock, hourStart, good: 0, reject: 0, entries: 0 }
    row.good += report.good_count ?? 0
    row.reject += report.reject_count ?? 0
    row.entries += 1
    hourMap.set(hourBlock, row)
  })
  const hourLines = [...hourMap.values()]
    .sort((a, b) => a.hourStart - b.hourStart)
    .map(hour => `${hour.hourBlock}: wpisów ${hour.entries}, suma ${pieces(hour.good)} szt, śr. ${pieces(Math.round(hour.good / hour.entries))} szt/wpis, odrzut ${rejectPct(hour.good, hour.reject)}%`)

  const workTimeLines = groups.map(group =>
    `${formatDate(group.date)}, Zmiana ${group.shift}, ${group.machineName}: praca ${mins(group.runtime)}, gotowość ${mins(group.ready)}, alarm ${mins(group.alarm)}, przestój ${mins(group.downtime)}`
  )

  const earlyEndShifts = shifts.filter(shift => shift.ended_early && shift.early_end_reason?.trim())
  const earlyEndLines = earlyEndShifts.map(shift => {
    const machine = one(shift.machine)
    return `${formatDate(shift.shift_date)}, Zmiana ${shift.shift_type}, ${machine?.name ?? 'Maszyna'}: ${shift.early_end_reason?.trim()}`
  })

  const issueLines = operatorIssues.map(issue => [
    `${formatDate(issue.date)}${issue.shift ? ` Zmiana ${issue.shift}` : ''}${issue.hour ? ` ${issue.hour}` : ''} | ${issue.machineName} | ${issueKindLabel(issue.kind)}: ${issue.title}`,
    issue.operator ? `Operator: ${issue.operator}` : null,
    `Opis: ${issue.description}`,
    issue.station ? `Stacja/obszar: ${issue.station}` : null,
    issue.action ? `Działanie: ${issue.action}` : null,
    issue.status ? `Status: ${issue.status}` : null
  ].filter(Boolean).join('\n'))

  return [
    'RAPORT ZBIORCZY - DANE ZRODLOWE (do wklejenia w AI)',
    `Zakres: ${range} | Automat: ${machineLabel}`,
    '',
    '=== PODSUMOWANIE ===',
    `Produkcja: ${pieces(totalGood)} szt / cel ${pieces(totalTarget)} szt (realizacja ${pct(totalGood, totalTarget)}%)`,
    `Odrzut: ${pieces(totalReject)} szt (${rejectPct(totalGood, totalReject)}%)`,
    `Czas pracy: ${mins(totalRuntime)} (straty ${mins(totalLoss)})`,
    `Liczba wpisow godzinowych: ${groups.reduce((sum, group) => sum + group.reports, 0)}`,
    '',
    '=== WYDAJNOSC DZIEN PO DNIU ===',
    ...(dayLines.length ? dayLines : ['Brak danych.']),
    '',
    '=== WYDAJNOSC GODZINA PO GODZINIE ===',
    ...(hourLines.length ? hourLines : ['Brak danych.']),
    '',
    '=== CZASY PRACY (per zmiana) ===',
    ...(workTimeLines.length ? workTimeLines : ['Brak rozliczonych zmian.']),
    '',
    '=== PRZEDWCZESNE ZAKONCZENIA ZMIAN ===',
    ...(earlyEndLines.length ? earlyEndLines : ['Brak przedwczesnych zakonczen zmian w okresie.']),
    '',
    '=== WPISY OPERATOROW (problemy, przyczyny, dzialania) ===',
    ...(issueLines.length ? issueLines.flatMap(line => [line, '---']) : ['Brak wpisow operatorow w okresie.'])
  ].join('\n')
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
  const [selectedMachineId, setSelectedMachineId] = useState('all')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedAi, setCopiedAi] = useState(false)

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
        supabase.from('machines').select('*').is('deleted_at', null).order('code'),
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
          .select(`
            *,
            machine:machines!machine_id(id, name, code),
            reporter:profiles!reporter_id(full_name),
            assignee:profiles!assigned_to(full_name),
            shift:shifts!shift_id(shift_type, shift_date)
          `)
          .gte('created_at', productionBoundaryIso(range.from))
          .lt('created_at', productionBoundaryIso(addDays(range.to, 1)))
          .order('created_at', { ascending: false })
          .limit(500)
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

  const machineLabel = useMemo(
    () => selectedMachineId === 'all'
      ? 'Wszystkie automaty'
      : machines.find(machine => machine.id === selectedMachineId)?.name ?? 'Wybrany automat',
    [machines, selectedMachineId]
  )

  const filteredReports = useMemo(
    () => selectedMachineId === 'all' ? reports : reports.filter(report => report.machine_id === selectedMachineId),
    [reports, selectedMachineId]
  )
  const filteredShifts = useMemo(
    () => selectedMachineId === 'all' ? shifts : shifts.filter(shift => shift.machine_id === selectedMachineId),
    [selectedMachineId, shifts]
  )
  const filteredFailures = useMemo(
    () => selectedMachineId === 'all' ? failures : failures.filter(failure => failure.machine_id === selectedMachineId),
    [failures, selectedMachineId]
  )

  const groups = useMemo(() => groupData(filteredReports, filteredShifts, machines), [filteredReports, filteredShifts, machines])
  const operatorIssues = useMemo(
    () => operatorIssuesFromData(filteredReports, filteredFailures, machines),
    [filteredFailures, filteredReports, machines]
  )
  const recurringIssues = useMemo(() => recurringIssuesFrom(operatorIssues), [operatorIssues])
  const systemAlerts = useMemo(() => filteredFailures.filter(failure => failure.auto_generated), [filteredFailures])
  const manualFailures = useMemo(() => filteredFailures.filter(failure => !failure.auto_generated), [filteredFailures])

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
    if (totals.realization >= 95) list.push(`Realizacja celu w okresie wyniosła ${totals.realization}% - wynik bliski planu.`)
    else if (totals.realization >= 85) list.push(`Realizacja celu w okresie wyniosła ${totals.realization}%. Wymagana kontrola najsłabszych zmian i automatów.`)
    else list.push(`Realizacja celu w okresie wyniosła ${totals.realization}%. Wynik wymaga działań korygujących.`)
    if (totals.rejectPct > 5) list.push(`Odrzut wyniósł ${totals.rejectPct}% i przekroczył próg krytyczny 5%. Priorytetem jest analiza przyczyn jakościowych.`)
    else list.push(`Odrzut wyniósł ${totals.rejectPct}% i pozostaje poniżej progu krytycznego 5%.`)
    if (totals.highReject) list.push(`${totals.highReject} wpisów miało odrzut powyżej 5%.`)
    if (totals.lowOutput) list.push(`${totals.lowOutput} wpisów miało wynik poniżej 2000 szt.`)
    const weakest = byMachine[byMachine.length - 1]
    if (weakest) list.push(`Najsłabszy automat w okresie: ${weakest.name}, realizacja ${pct(weakest.good, weakest.target)}%.`)
    if (operatorIssues.length) list.push(`Operatorzy zarejestrowali ${operatorIssues.length} opisów problemów, działań i uwag dla zakresu: ${machineLabel}.`)
    if (manualFailures.length) {
      const unresolved = manualFailures.filter(failure => failure.status !== 'resolved').length
      list.push(`W module awarii zapisano ${manualFailures.length} zgłoszeń operatorów${unresolved ? `, w tym ${unresolved} bez statusu „rozwiązane”` : ', wszystkie ze statusem „rozwiązane”'}.`)
    }
    if (systemAlerts.length) list.push(`System automatycznie wykrył ${systemAlerts.length} alertów wydajności lub odrzutu.`)
    const recurring = recurringIssues[0]
    if (recurring && recurring.count > 1) {
      list.push(`Najczęściej powtarzał się problem: ${recurring.label}${recurring.station ? ` (${recurring.station})` : ''} - ${recurring.count} wpisów.`)
    }
    return list
  }, [byMachine, groups.length, machineLabel, manualFailures, operatorIssues.length, recurringIssues, systemAlerts.length, totals.highReject, totals.lowOutput, totals.realization, totals.rejectPct])

  const emailHtml = useMemo(() => buildEmailHtml({
    from: range.from,
    to: range.to,
    machineLabel,
    groups,
    reports: filteredReports,
    operatorIssues,
    recurringIssues,
    conclusions
  }), [conclusions, filteredReports, groups, machineLabel, operatorIssues, range.from, range.to, recurringIssues])

  const chartData = useMemo(() => ({
    labels: byDay.map(day => formatDate(day.date).slice(0, 5)),
    datasets: [
      { type: 'bar' as const, label: 'Produkcja', data: byDay.map(day => day.good), backgroundColor: '#3b82f6', borderRadius: 5 },
      { type: 'bar' as const, label: 'Cel', data: byDay.map(day => day.target), backgroundColor: 'rgba(212,175,55,.55)', borderRadius: 5 },
      { type: 'line' as const, label: 'Odrzut %', data: byDay.map(day => rejectPct(day.good, day.reject)), borderColor: '#ef4444', backgroundColor: '#ef4444', yAxisID: 'y1', tension: 0.3 }
    ]
  }), [byDay])

  const aiExportText = useMemo(() => buildAiExportText({
    from: range.from,
    to: range.to,
    machineLabel,
    groups,
    reports: filteredReports,
    shifts: filteredShifts,
    operatorIssues
  }), [filteredReports, filteredShifts, groups, machineLabel, operatorIssues, range.from, range.to])

  async function copyAiExport() {
    try {
      await navigator.clipboard.writeText(aiExportText)
    } catch {
      const el = document.createElement('textarea')
      el.value = aiExportText
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopiedAi(true)
    window.setTimeout(() => setCopiedAi(false), 2500)
  }

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
          <p className="mt-1 text-navy-400">Raport tygodniowy, miesięczny albo za dowolny okres, oparty na danych i opisach operatorów.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={copyAiExport}
            disabled={loading || !operatorIssues.length && !groups.length}
            className="btn-primary flex items-center gap-2 px-5 py-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copiedAi ? 'Skopiowano dane' : 'Kopiuj dane dla AI'}
          </button>
          <button onClick={copyReport} className="btn-secondary px-5 py-3">
            {copied ? 'Skopiowano raport' : 'Kopiuj raport do maila'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="grid gap-4 lg:grid-cols-[1.1fr_2fr_1fr]">
          <div>
            <div className="label">Typ raportu</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['week', 'Tydzień'],
                ['month', 'Miesiąc'],
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
                <span className="label">Miesiąc</span>
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
          <label>
            <span className="label">Automat w raporcie</span>
            <select className="input" value={selectedMachineId} onChange={event => setSelectedMachineId(event.target.value)}>
              <option value="all">Wszystkie automaty</option>
              {machines.map(machine => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
            </select>
            <span className="mt-2 block text-xs text-navy-400">Filtr obejmuje wskaźniki, wykresy, wpisy operatorów i awarie.</span>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="card py-12 text-center text-navy-300">Ładowanie raportu...</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Kpi label="Produkcja" value={`${pieces(totals.good)} szt`} sub={`cel ${pieces(totals.target)} szt`} tone="text-brand" />
            <Kpi label="Realizacja" value={`${totals.realization}%`} sub="produkcja / cel zmian" tone={totals.realization >= 90 ? 'text-green-400' : totals.realization >= 80 ? 'text-amber-400' : 'text-red-400'} />
            <Kpi label="Odrzut" value={`${totals.rejectPct}%`} sub={`${pieces(totals.reject)} szt`} tone={totals.rejectPct > 5 ? 'text-red-400' : 'text-green-400'} />
            <Kpi label="Czas pracy" value={mins(totals.runtime)} sub={`straty ${mins(totals.alarmLoss)}`} tone="text-cyan-300" />
            <Kpi label="Zdarzenia" value={operatorIssues.length} sub={`${manualFailures.length} awarii / ${systemAlerts.length} alertów systemu`} tone={operatorIssues.length ? 'text-amber-400' : 'text-green-400'} />
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Dane dla AI</div>
                <div className="card-sub">Zwykły tekst — wklej w dowolnym czacie AI, żeby dostać własną analizę</div>
              </div>
              <button onClick={copyAiExport} className="btn-secondary px-4 py-2 text-sm">{copiedAi ? 'Skopiowano' : 'Kopiuj'}</button>
            </div>
            <textarea
              readOnly
              value={aiExportText}
              onFocus={event => event.target.select()}
              className="h-64 w-full resize-y rounded-xl border border-navy-700 bg-navy-900 p-3 font-mono text-xs text-navy-200"
            />
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
              <div className="card-sub mb-4">Porównanie względem celu zmianowego</div>
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
              <div className="card-sub mb-4">Dzień, zmiana, automat</div>
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

          <div className="grid gap-5 xl:grid-cols-[0.8fr_1.7fr]">
            <div className="card">
              <div className="card-title">Najczęściej zgłaszane problemy</div>
              <div className="card-sub mb-4">Klasyfikacja na podstawie wpisów operatorów i formularzy awarii</div>
              <div className="space-y-3">
                {recurringIssues.slice(0, 10).map((issue, index) => (
                  <div key={issue.key} className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-white">{issue.label}</div>
                        <div className="mt-1 text-xs text-navy-400">
                          {issue.station ?? 'Bez wskazanej stacji'} · {issue.machines.join(', ')}
                        </div>
                      </div>
                      <div className={cn(
                        'min-w-10 rounded-lg border px-2 py-1 text-center font-mono text-sm font-bold',
                        index === 0 && issue.count > 1
                          ? 'border-red-500/40 bg-red-500/10 text-red-300'
                          : 'border-navy-600 bg-navy-800 text-brand'
                      )}>
                        {issue.count}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-navy-500">Ostatni wpis: {formatDate(issue.lastDate)}</div>
                  </div>
                ))}
                {!recurringIssues.length && <Empty text="Brak opisanych problemów w wybranym zakresie" />}
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="card-header">
                <div>
                  <div className="card-title">Problemy i działania zarejestrowane przez operatorów</div>
                  <div className="card-sub">Pełna chronologia dla: {machineLabel}</div>
                </div>
                <div className="rounded-lg border border-navy-600 bg-navy-900 px-3 py-2 text-sm text-navy-300">
                  <span className="font-mono font-bold text-white">{operatorIssues.length}</span> wpisów
                </div>
              </div>
              <div className="max-h-[680px] space-y-3 overflow-y-auto pr-1">
                {operatorIssues.map(issue => (
                  <div key={issue.id} className="rounded-xl border border-navy-700 bg-navy-900 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('rounded-md border px-2 py-1 text-[11px] font-bold uppercase', issueKindClass(issue.kind))}>
                            {issueKindLabel(issue.kind)}
                          </span>
                          <span className="text-xs text-navy-400">{issue.source}</span>
                          {issue.severity && <span className="text-xs font-bold text-red-300">Pilność: {issue.severity}</span>}
                        </div>
                        <div className="mt-2 text-base font-bold text-white">{issue.title}</div>
                        <div className="mt-1 text-xs text-navy-400">
                          {formatDate(issue.date)}
                          {issue.shift ? ` · Zmiana ${issue.shift}` : ''}
                          {issue.hour ? ` · ${issue.hour}` : ''}
                          {` · ${issue.machineName}`}
                        </div>
                      </div>
                      <div className="text-right text-xs text-navy-400">
                        {issue.operator && <div>Operator: <span className="font-semibold text-navy-200">{issue.operator}</span></div>}
                        {issue.status && <div className="mt-1">Status: <span className="font-semibold text-white">{issue.status}</span></div>}
                      </div>
                    </div>

                    <div className="mt-3 rounded-lg bg-navy-800 px-3 py-3 text-sm leading-relaxed text-navy-100">
                      {issue.description}
                    </div>

                    {(issue.station || issue.action) && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {issue.station && (
                          <div className="rounded-lg border border-navy-700 px-3 py-2 text-xs text-navy-300">
                            <span className="text-navy-500">Stacja / obszar:</span> {issue.station}
                          </div>
                        )}
                        {issue.action && (
                          <div className="rounded-lg border border-navy-700 px-3 py-2 text-xs text-navy-300">
                            <span className="text-navy-500">Podjęte działanie:</span> {issue.action}
                          </div>
                        )}
                      </div>
                    )}

                    {issue.photoUrls.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {issue.photoUrls.map((url, index) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer" className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-300 hover:bg-blue-500/20">
                            Zdjecie {index + 1}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {!operatorIssues.length && <Empty text="Operatorzy nie opisali problemów w wybranym okresie" />}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Gotowy raport do maila</div>
                <div className="card-sub">Podgląd treści kopiowanej do Outlooka</div>
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
