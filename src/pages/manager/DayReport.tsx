import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { HourlyReport, Machine, ShiftType } from '@/types/database'

const SHIFTS: ShiftType[] = ['I', 'II', 'III']

type ReportWithContext = Omit<HourlyReport, 'operator'> & {
  ready_min?: number
  alarm_min?: number
  operator?: { full_name: string } | { full_name: string }[] | null
  shift?: { shift_type: ShiftType; shift_date?: string } | { shift_type: ShiftType; shift_date?: string }[] | null
}

type ShiftSummary = {
  good: number
  reject: number
  reports: number
  runtime: number
  ready: number
  alarm: number
  downtime: number
  notes: string[]
}

type MachineDayRow = {
  machineId: string
  machineName: string
  shifts: Record<ShiftType, ShiftSummary>
  total: ShiftSummary
}

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function emptySummary(): ShiftSummary {
  return { good: 0, reject: 0, reports: 0, runtime: 0, ready: 0, alarm: 0, downtime: 0, notes: [] }
}

function reportDowntimeMinutes(report: ReportWithContext) {
  const downtime = report.downtime_min + report.failure_min
  const readyAndAlarm = (report.ready_min ?? 0) + (report.alarm_min ?? 0)
  return downtime === readyAndAlarm && report.failure_min === 0 ? 0 : downtime
}

function mins(value: number) {
  const rounded = Math.max(0, Math.round(value || 0))
  if (!rounded) return '-'
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`
}

function pieces(value: number) {
  return value.toLocaleString('pl-PL')
}

function noteText(report: ReportWithContext) {
  return [report.downtime_reason, report.notes]
    .map(value => value?.trim())
    .filter(Boolean)
    .join(' - ')
}

export default function ManagerDayReport() {
  const [date, setDate] = useState(todayIso())
  const [machines, setMachines] = useState<Machine[]>([])
  const [reports, setReports] = useState<ReportWithContext[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const loadSeq = useRef(0)

  useEffect(() => {
    load()
  }, [date])

  useEffect(() => {
    const channel = supabase.channel(`manager-day-report-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .subscribe()

    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') load()
    }

    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', refreshOnFocus)

    return () => {
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', refreshOnFocus)
      supabase.removeChannel(channel)
    }
  }, [date])

  const load = async () => {
    const requestId = ++loadSeq.current
    setLoading(true)
    setError('')

    const [mRes, rRes] = await Promise.all([
      supabase.from('machines').select('*').eq('is_active', true).order('code'),
      supabase
        .from('hourly_reports')
        .select('*, operator:profiles!operator_id(full_name), shift:shifts!shift_id(shift_type, shift_date)')
        .eq('report_date', date)
        .is('deleted_at', null)
        .order('machine_id')
        .order('hour_start')
    ])

    if (requestId !== loadSeq.current) return

    if (mRes.error || rRes.error) {
      setError(mRes.error?.message || rRes.error?.message || 'Nie udalo sie zaladowac raportu dnia.')
    } else {
      setMachines((mRes.data ?? []) as Machine[])
      setReports((rRes.data ?? []) as ReportWithContext[])
    }

    setLoading(false)
  }

  const machineNameById = useMemo(
    () => Object.fromEntries(machines.map(machine => [machine.id, machine.name])),
    [machines]
  )

  const rows = useMemo(() => {
    const byMachine = new Map<string, MachineDayRow>()

    machines.forEach(machine => {
      byMachine.set(machine.id, {
        machineId: machine.id,
        machineName: machine.name,
        shifts: { I: emptySummary(), II: emptySummary(), III: emptySummary() },
        total: emptySummary()
      })
    })

    reports.forEach(report => {
      const shiftType = one(report.shift)?.shift_type
      if (!shiftType || !SHIFTS.includes(shiftType)) return

      const row = byMachine.get(report.machine_id) ?? {
        machineId: report.machine_id,
        machineName: machineNameById[report.machine_id] ?? 'Nieznana maszyna',
        shifts: { I: emptySummary(), II: emptySummary(), III: emptySummary() },
        total: emptySummary()
      }
      byMachine.set(report.machine_id, row)

      const shift = row.shifts[shiftType]
      const summaries = [shift, row.total]
      summaries.forEach(summary => {
        summary.good += report.good_count
        summary.reject += report.reject_count
        summary.reports += 1
        summary.runtime += report.runtime_min
        summary.ready += report.ready_min ?? 0
        summary.alarm += report.alarm_min ?? 0
        summary.downtime += reportDowntimeMinutes(report)
      })

      const note = noteText(report)
      if (note) {
        const entry = `${report.hour_block}: ${note}`
        shift.notes.push(entry)
        row.total.notes.push(`Zmiana ${shiftType}, ${entry}`)
      }
    })

    return Array.from(byMachine.values()).sort((a, b) => a.machineName.localeCompare(b.machineName))
  }, [machineNameById, machines, reports])

  const totals = useMemo(() => {
    return reports.reduce((acc, report) => {
      acc.good += report.good_count
      acc.reject += report.reject_count
      acc.reports += 1
      acc.runtime += report.runtime_min
      acc.ready += report.ready_min ?? 0
      acc.alarm += report.alarm_min ?? 0
      acc.downtime += reportDowntimeMinutes(report)
      return acc
    }, emptySummary())
  }, [reports])

  const shiftTotals = useMemo(() => {
    const result: Record<ShiftType, ShiftSummary> = { I: emptySummary(), II: emptySummary(), III: emptySummary() }
    rows.forEach(row => {
      SHIFTS.forEach(shift => {
        result[shift].good += row.shifts[shift].good
        result[shift].reject += row.shifts[shift].reject
        result[shift].reports += row.shifts[shift].reports
        result[shift].runtime += row.shifts[shift].runtime
        result[shift].ready += row.shifts[shift].ready
        result[shift].alarm += row.shifts[shift].alarm
        result[shift].downtime += row.shifts[shift].downtime
      })
    })
    return result
  }, [rows])

  const eventsByShift = useMemo(() => {
    const result: Record<ShiftType, { machine: string; hour: string; text: string; operator: string }[]> = { I: [], II: [], III: [] }
    reports.forEach(report => {
      const shiftType = one(report.shift)?.shift_type
      const text = noteText(report)
      if (!shiftType || !SHIFTS.includes(shiftType) || !text) return
      result[shiftType].push({
        machine: machineNameById[report.machine_id] ?? '-',
        hour: report.hour_block,
        text,
        operator: one(report.operator)?.full_name ?? '-'
      })
    })
    return result
  }, [machineNameById, reports])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Raport dnia</h1>
          <p className="text-navy-400 mt-1">Produkcja, odrzut i przebieg zmian w jednym widoku</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary text-xs py-2 px-3" onClick={() => setDate(addDays(date, -1))}>Poprzedni dzien</button>
          <input className="input w-[170px]" type="date" value={date} onChange={e => setDate(e.target.value)} />
          <button className="btn-secondary text-xs py-2 px-3" onClick={() => setDate(addDays(date, 1))}>Nastepny dzien</button>
          <button className="btn-primary text-xs py-2 px-3" onClick={load}>{loading ? 'Odswiezam...' : 'Odswiez'}</button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Produkcja lacznie', value: `${pieces(totals.good)} szt`, color: 'text-brand' },
          { label: 'Odrzut lacznie', value: `${pieces(totals.reject)} szt`, color: totals.reject ? 'text-red-400' : 'text-green-400' },
          { label: 'Wpisy', value: `${totals.reports}`, color: 'text-white' },
          { label: 'Czas pracy', value: mins(totals.runtime), color: 'text-green-400' },
          { label: 'Alarm + postoj', value: mins(totals.alarm + totals.downtime), color: totals.alarm + totals.downtime ? 'text-amber-400' : 'text-green-400' }
        ].map(item => (
          <div key={item.label} className="kpi-card">
            <div className="kpi-label">{item.label}</div>
            <div className={cn('kpi-value text-xl', item.color)}>{loading ? '...' : item.value}</div>
            <div className="kpi-sub">{date}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Produkcja wedlug zmian</div>
            <div className="card-sub">Kazda maszyna osobno, trzy zmiany i suma dnia</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                <th className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider">Automat</th>
                {SHIFTS.map(shift => (
                  <th key={shift} className="text-center py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider">Zmiana {shift}</th>
                ))}
                <th className="text-center py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider">Lacznie</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-navy-500">Brak danych dla wybranego dnia</td></tr>
              )}
              {rows.map(row => (
                <tr key={row.machineId} className="border-b border-navy-800">
                  <td className="py-3 px-3 font-bold text-white">{row.machineName}</td>
                  {SHIFTS.map(shift => (
                    <td key={shift} className="py-3 px-3 text-center">
                      {row.shifts[shift].reports ? (
                        <div>
                          <div className="font-mono text-lg font-bold text-white">{pieces(row.shifts[shift].good)} szt</div>
                          <div className="mt-1 text-xs text-navy-400">
                            odrzut <span className="font-mono text-red-300">{pieces(row.shifts[shift].reject)}</span>
                            {' '}| wpisy {row.shifts[shift].reports}
                          </div>
                        </div>
                      ) : (
                        <span className="italic text-navy-500">Brak produkcji</span>
                      )}
                    </td>
                  ))}
                  <td className="py-3 px-3 text-center bg-brand/10">
                    <div className="font-mono text-xl font-bold text-brand">{pieces(row.total.good)} szt</div>
                    <div className="mt-1 text-xs text-navy-300">odrzut {pieces(row.total.reject)} | wpisy {row.total.reports}</div>
                  </td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-navy-800/70">
                  <td className="py-3 px-3 font-bold text-white">Lacznie</td>
                  {SHIFTS.map(shift => (
                    <td key={shift} className="py-3 px-3 text-center">
                      <div className="font-mono text-lg font-bold text-white">{pieces(shiftTotals[shift].good)} szt</div>
                      <div className="mt-1 text-xs text-navy-400">odrzut {pieces(shiftTotals[shift].reject)}</div>
                    </td>
                  ))}
                  <td className="py-3 px-3 text-center bg-brand/20">
                    <div className="font-mono text-xl font-bold text-brand">{pieces(totals.good)} szt</div>
                    <div className="mt-1 text-xs text-navy-300">odrzut {pieces(totals.reject)}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {SHIFTS.map(shift => (
          <div key={shift} className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Zmiana {shift}</div>
                <div className="card-sub">
                  {pieces(shiftTotals[shift].good)} szt | odrzut {pieces(shiftTotals[shift].reject)} | praca {mins(shiftTotals[shift].runtime)}
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {eventsByShift[shift].length === 0 && (
                <div className="rounded-xl border border-navy-700 bg-navy-900 p-4 text-sm italic text-navy-500">
                  Brak zdarzen do odnotowania.
                </div>
              )}
              {eventsByShift[shift].map((event, index) => (
                <div key={`${event.machine}-${event.hour}-${index}`} className="rounded-xl border border-navy-700 bg-navy-900 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-white">{event.machine}</div>
                    <div className="font-mono text-xs text-navy-400">{event.hour}</div>
                  </div>
                  <div className="mt-1 text-xs text-navy-500">{event.operator}</div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-navy-200">{event.text}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Pelny przebieg dnia</div>
            <div className="card-sub">Wszystkie wpisy godzinowe bez ucinania uwag</div>
          </div>
        </div>
        <div className="space-y-2">
          {reports.length === 0 && <div className="py-8 text-center text-navy-500">Brak wpisow w wybranym dniu</div>}
          {reports.map(report => {
            const shiftType = one(report.shift)?.shift_type ?? '-'
            const text = noteText(report)
            return (
              <div key={report.id} className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-[130px_1fr_110px_110px_120px] md:items-center">
                  <div className="font-mono text-sm font-bold text-white">{report.hour_block}</div>
                  <div>
                    <div className="font-bold text-white">{machineNameById[report.machine_id] ?? '-'}</div>
                    <div className="text-xs text-navy-500">Zmiana {shiftType} | {one(report.operator)?.full_name ?? '-'}</div>
                  </div>
                  <div className="font-mono font-bold text-green-300">{pieces(report.good_count)} szt</div>
                  <div className="font-mono text-red-300">odrz. {pieces(report.reject_count)}</div>
                  <div className="font-mono text-navy-300">praca {mins(report.runtime_min)}</div>
                </div>
                {text && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-navy-800 px-3 py-2 text-sm leading-relaxed text-navy-200">{text}</p>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
