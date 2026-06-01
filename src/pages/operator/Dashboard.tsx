import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { useHourCountdown, useCurrentHourBlock, useClock } from '@/hooks/useClock'
import { useTestMode } from '@/hooks/useTestMode'
import { efficiencyColor, efficiencyBg, formatHourBlock, cn, SHIFT_HOURS, canEnterHourlyReport } from '@/lib/utils'
import type { FailureReport, HourlyReport, Profile, Shift, ShiftType } from '@/types/database'

const TARGET = 2100
const TEST_SLOTS = Array.from({ length: 20 }, (_, i) => i)

type HandoverReport = HourlyReport & {
  operator?: Pick<Profile, 'full_name'> | null
  shift?: Pick<Shift, 'shift_type' | 'shift_date'> | null
}

type HandoverFailure = FailureReport & {
  reporter?: Pick<Profile, 'full_name'> | null
}

type HandoverShift = Shift & {
  operator_1?: Pick<Profile, 'full_name'> | null
  operator_2?: Pick<Profile, 'full_name'> | null
}

const FAILURE_SEVERITY_LABEL: Record<string, string> = {
  low: 'Niska',
  medium: 'Srednia',
  high: 'Wysoka',
  critical: 'Krytyczna'
}

function rejectPct(good: number, reject: number) {
  return good + reject > 0 ? Math.round(reject / (good + reject) * 1000) / 10 : 0
}

function minsToHHMM(mins?: number | null) {
  const value = Math.max(0, Math.round(mins ?? 0))
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

export default function OperatorDashboard() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { activeShift, activeMachine, isLoading: shiftLoading, loadActiveShift } = useShiftStore()
  const testMode = useTestMode()
  const { display: countdown, isUrgent } = useHourCountdown()
  const hourBlock = useCurrentHourBlock()
  const { now, hour, time, date } = useClock()
  const [reports, setReports] = useState<HourlyReport[]>([])
  const [handoverReports, setHandoverReports] = useState<HandoverReport[]>([])
  const [handoverFailures, setHandoverFailures] = useState<HandoverFailure[]>([])
  const [handoverShifts, setHandoverShifts] = useState<HandoverShift[]>([])
  const [handoverLoading, setHandoverLoading] = useState(false)
  const reportsRequestSeq = useRef(0)
  const handoverRequestSeq = useRef(0)

  useEffect(() => {
    // Auto-detect shift for operator_2
    const { loadActiveShift } = useShiftStore.getState()
    loadActiveShift()
  }, [])

  useEffect(() => {
    if (activeShift) loadReports()
  }, [activeShift])

  useEffect(() => {
    if (activeMachine?.id) loadHandover()
    else {
      setHandoverReports([])
      setHandoverFailures([])
      setHandoverShifts([])
    }
  }, [activeMachine?.id, activeShift?.id])

  useEffect(() => {
    if (!activeShift) return

    const channel = supabase
      .channel(`operator-dashboard-${activeShift.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'hourly_reports',
        filter: `shift_id=eq.${activeShift.id}`
      }, loadReports)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'shifts',
        filter: `id=eq.${activeShift.id}`
      }, loadActiveShift)
      .subscribe()

    const fallback = window.setInterval(() => {
      loadReports()
      loadActiveShift()
    }, 45000)
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') {
        loadReports()
        loadActiveShift()
      }
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)

    return () => {
      window.clearInterval(fallback)
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
      supabase.removeChannel(channel)
    }
  }, [activeShift?.id, loadActiveShift])

  useEffect(() => {
    if (!activeMachine?.id) return

    const channel = supabase
      .channel(`operator-handover-${activeMachine.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'hourly_reports',
        filter: `machine_id=eq.${activeMachine.id}`
      }, loadHandover)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'failure_reports',
        filter: `machine_id=eq.${activeMachine.id}`
      }, loadHandover)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'shifts',
        filter: `machine_id=eq.${activeMachine.id}`
      }, loadHandover)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeMachine?.id, activeShift?.id])

  const loadReports = async () => {
    if (!activeShift) return
    const requestId = ++reportsRequestSeq.current
    const shiftId = activeShift.id
    const shiftType = activeShift.shift_type as ShiftType
    const { data, error } = await supabase
      .from('hourly_reports').select('*')
      .eq('shift_id', shiftId).is('deleted_at', null).order('hour_start')
    if (error || requestId !== reportsRequestSeq.current) return
    if (data) {
      const hours = testMode ? TEST_SLOTS : SHIFT_HOURS[shiftType]
      setReports((data as HourlyReport[]).sort((a, b) => hours.indexOf(a.hour_start) - hours.indexOf(b.hour_start)))
    }
  }

  const loadHandover = async () => {
    if (!activeMachine?.id) return
    const requestId = ++handoverRequestSeq.current
    setHandoverLoading(true)

    const [reportRes, failureRes, shiftRes] = await Promise.all([
      supabase
        .from('hourly_reports')
        .select('*, operator:profiles!operator_id(full_name), shift:shifts!shift_id(shift_type, shift_date)')
        .eq('machine_id', activeMachine.id)
        .is('deleted_at', null)
        .order('submitted_at', { ascending: false })
        .limit(8),
      supabase
        .from('failure_reports')
        .select('*, reporter:profiles!reporter_id(full_name)')
        .eq('machine_id', activeMachine.id)
        .order('created_at', { ascending: false })
        .limit(6),
      supabase
        .from('shifts')
        .select('*, operator_1:profiles!operator_1_id(full_name), operator_2:profiles!operator_2_id(full_name)')
        .eq('machine_id', activeMachine.id)
        .order('started_at', { ascending: false })
        .limit(5)
    ])

    if (requestId !== handoverRequestSeq.current) return
    if (!reportRes.error) {
      setHandoverReports(((reportRes.data ?? []) as HandoverReport[]).filter(report => report.shift_id !== activeShift?.id).slice(0, 6))
    }
    if (!failureRes.error) setHandoverFailures((failureRes.data ?? []) as HandoverFailure[])
    if (!shiftRes.error) {
      setHandoverShifts(((shiftRes.data ?? []) as HandoverShift[]).filter(shift => shift.id !== activeShift?.id).slice(0, 3))
    }
    setHandoverLoading(false)
  }

  const currentSlot = testMode ? Math.floor(new Date().getMinutes() / 3) : hour
  const shiftHours = activeShift ? (testMode ? TEST_SLOTS : SHIFT_HOURS[activeShift.shift_type as ShiftType]) : []
  const currentHourBelongsToShift = testMode || shiftHours.includes(hour)
  const currentHourReported = currentHourBelongsToShift && reports.some(r => r.hour_start === currentSlot)
  const reportedHours = reports.map(r => r.hour_start)
  const firstOpenMissingHour = activeShift
    ? shiftHours.find(h => !reportedHours.includes(h) && (testMode || canEnterHourlyReport(activeShift.shift_date, activeShift.shift_type, h, now)))
    : undefined
  const reminderBlock = firstOpenMissingHour !== undefined
    ? (testMode ? hourBlock : formatHourBlock(firstOpenMissingHour))
    : hourBlock
  const showCurrentHourReminder = firstOpenMissingHour !== undefined
  const visibleActiveShift = !shiftLoading &&
    activeShift &&
    !activeShift.ended_at &&
    profile &&
    (activeShift.operator_1_id === profile.id || activeShift.operator_2_id === profile.id)
      ? activeShift
      : null
  const totalGood = reports.reduce((s, r) => s + r.good_count, 0)
  const totalReject = reports.reduce((s, r) => s + r.reject_count, 0)
  const avgEff = reports.length > 0
    ? Math.round(reports.reduce((s, r) => s + Number(r.efficiency_pct), 0) / reports.length) : 0

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Welcome */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white">Witaj, {profile?.full_name?.split(' ')[0]}!</h1>
        <p className="text-sm sm:text-base text-navy-400 mt-1">{date} · {time}</p>
      </div>

      {/* No active shift */}
      {!visibleActiveShift && (
        <div className="card text-center py-10">
          <div className="text-5xl mb-4">🏭</div>
          <h2 className="text-xl font-bold text-white mb-2">Brak aktywnej zmiany</h2>
          <p className="text-navy-400 mb-6">Rozpocznij zmianę żeby móc wpisywać wyniki godzinowe</p>
          <button onClick={() => navigate('/operator/shift')} className="btn-primary px-8 py-3">
            🚀 Rozpocznij zmianę
          </button>
        </div>
      )}

      {/* Active shift */}
      {visibleActiveShift && (
        <>
          {/* Alert - report due */}
          {showCurrentHourReminder && (
            <div className={cn('rounded-2xl p-4 border', isUrgent
              ? 'bg-red-500/10 border-red-500/30 animate-pulse'
              : 'bg-amber-500/10 border-amber-500/30'
            )}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className={cn('font-bold text-base sm:text-lg', isUrgent ? 'text-red-400' : 'text-amber-400')}>
                    {isUrgent ? '⚠ CZAS NA WPIS GODZINY!' : '⏰ Pamiętaj o wpisaniu wyniku'}
                  </div>
                  <div className="text-sm text-navy-300 mt-0.5">
                    Raport za godzinę <span className="font-bold text-white">{reminderBlock}</span> nie został jeszcze wpisany
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  <div className={cn('text-2xl sm:text-3xl font-bold font-mono', isUrgent ? 'text-red-400' : 'text-white')}>
                    {countdown}
                  </div>
                  <div className="text-xs text-navy-400">do końca godziny</div>
                </div>
              </div>
              <button onClick={() => navigate('/operator/report')} className="btn-primary w-full mt-3 py-3">
                ✏️ Wpisz teraz
              </button>
            </div>
          )}

          {currentHourBelongsToShift && currentHourReported && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">✅</span>
                <div>
                  <div className="font-bold text-green-400">Raport za {hourBlock} wpisany</div>
                  <div className="text-sm text-navy-400">Następny raport za <span className="font-bold text-white font-mono">{countdown}</span></div>
                </div>
              </div>
            </div>
          )}

          {!currentHourBelongsToShift && (
            <div className="bg-navy-800 border border-amber-500/30 rounded-2xl p-4">
              <div className="font-bold text-amber-400">Poza godzinami tej zmiany</div>
              <div className="text-sm text-navy-300 mt-1">
                Aktualna godzina {formatHourBlock(hour)} nie należy do zmiany {visibleActiveShift.shift_type}. Nie będę przypominać o raporcie za obcy przedział.
              </div>
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="kpi-card" style={{ '--before-bg': 'var(--brand)' } as React.CSSProperties}>
              <div className="kpi-label">Produkcja łącznie</div>
              <div className="kpi-value">{totalGood.toLocaleString('pl-PL')}</div>
              <div className="kpi-sub">szt. tej zmiany</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Śr. efektywność</div>
              <div className={cn('kpi-value', efficiencyColor(avgEff))}>{avgEff > 0 ? avgEff + '%' : '—'}</div>
              <div className="kpi-sub">vs target {TARGET} szt/h</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Odrzut łącznie</div>
              <div className="kpi-value text-red-400">{totalReject}</div>
              <div className="kpi-sub">szt. tej zmiany</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Raportów</div>
              <div className="kpi-value">{reports.length}</div>
              <div className="kpi-sub">z {activeMachine?.name}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <div>
                <div className="card-title">Przekazanie zmiany</div>
                <div className="card-sub">Co dzialo sie ostatnio na maszynie {activeMachine?.name}</div>
              </div>
              <button onClick={loadHandover} className="btn-secondary text-xs py-2 px-3 sm:py-1.5">
                {handoverLoading ? 'Odswiezam...' : 'Odswiez'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              <div className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                <div className="mb-2 text-sm font-bold text-white">Ostatnie wyniki</div>
                <div className="space-y-2">
                  {handoverReports.length === 0 && <div className="py-4 text-sm text-navy-500">Brak poprzednich wpisow dla tej maszyny</div>}
                  {handoverReports.map(report => {
                    const reject = rejectPct(report.good_count, report.reject_count)
                    return (
                      <div key={report.id} className="rounded-lg bg-navy-800 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-mono text-xs font-bold text-white">{report.hour_block}</div>
                          <div className={cn('font-mono text-xs font-bold', efficiencyColor(Number(report.efficiency_pct)))}>{Number(report.efficiency_pct)}%</div>
                        </div>
                        <div className="mt-1 text-xs text-navy-400">
                          Zmiana {report.shift?.shift_type ?? '-'} | {report.operator?.full_name ?? 'operator'}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-navy-500">szt:</span> <span className="font-mono font-bold text-white">{report.good_count.toLocaleString('pl-PL')}</span></div>
                          <div><span className="text-navy-500">odrz:</span> <span className={cn('font-mono font-bold', reject > 5 ? 'text-red-400' : 'text-green-400')}>{reject}%</span></div>
                        </div>
                        {(report.downtime_reason || report.reject_reason || report.notes) && (
                          <div className="mt-2 text-xs text-navy-300">
                            {report.downtime_reason && <div><span className="text-navy-500">Wynik:</span> {report.downtime_reason}</div>}
                            {report.reject_reason && <div><span className="text-navy-500">Odrzut:</span> {report.reject_reason}</div>}
                            {report.notes && <div><span className="text-navy-500">Uwagi:</span> {report.notes}</div>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                <div className="mb-2 text-sm font-bold text-white">Awarie i problemy</div>
                <div className="space-y-2">
                  {handoverFailures.length === 0 && <div className="py-4 text-sm text-navy-500">Brak zgloszen awarii dla tej maszyny</div>}
                  {handoverFailures.map(failure => (
                    <div key={failure.id} className="rounded-lg bg-navy-800 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-bold text-white">{failure.station || 'Bez stacji'}</div>
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', failure.status === 'resolved' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400')}>
                          {failure.status === 'resolved' ? 'zamkniete' : 'otwarte'}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-navy-400">
                        {FAILURE_SEVERITY_LABEL[failure.severity] ?? failure.severity} | {new Date(failure.created_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="mt-2 text-xs text-navy-300">{failure.description}</div>
                      {failure.resolution_notes && <div className="mt-2 text-xs text-green-300">Rozwiazanie: {failure.resolution_notes}</div>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                <div className="mb-2 text-sm font-bold text-white">Poprzednie zmiany</div>
                <div className="space-y-2">
                  {handoverShifts.length === 0 && <div className="py-4 text-sm text-navy-500">Brak poprzednich zmian do pokazania</div>}
                  {handoverShifts.map(shift => {
                    const operators = [shift.operator_1?.full_name, shift.operator_2?.full_name].filter(Boolean).join(' / ') || 'Brak operatorow'
                    return (
                      <div key={shift.id} className="rounded-lg bg-navy-800 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-bold text-white">Zmiana {shift.shift_type}</div>
                          <div className="font-mono text-xs text-navy-300">{shift.shift_date}</div>
                        </div>
                        <div className="mt-1 text-xs text-navy-400">{operators}</div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-navy-500">produkcja:</span> <span className="font-mono font-bold text-white">{(shift.summary_good_count ?? 0).toLocaleString('pl-PL')}</span></div>
                          <div><span className="text-navy-500">odrzut:</span> <span className="font-mono font-bold text-red-400">{(shift.summary_reject_count ?? 0).toLocaleString('pl-PL')}</span></div>
                          <div><span className="text-navy-500">praca:</span> <span className="font-mono font-bold text-green-400">{minsToHHMM(shift.summary_runtime_min)}</span></div>
                          <div><span className="text-navy-500">alarm:</span> <span className="font-mono font-bold text-amber-400">{minsToHHMM(shift.summary_alarm_min)}</span></div>
                        </div>
                        {(shift.summary_notes || shift.notes) && (
                          <div className="mt-2 text-xs text-navy-300">{shift.summary_notes || shift.notes}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Reports list */}
          <div className="card">
            <div className="card-header flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <div className="card-title">Raporty tej zmiany</div>
                <div className="card-sub">{activeMachine?.name} · Zmiana {visibleActiveShift.shift_type}</div>
              </div>
              <button onClick={() => navigate('/operator/report')} className="btn-primary text-xs py-2 px-3 sm:py-1.5">
                + Nowy raport
              </button>
            </div>
            {reports.length === 0 ? (
              <div className="text-center py-8 text-navy-500">Brak raportów — zacznij wpisywać wyniki!</div>
            ) : (
              <div className="space-y-2">
                {reports.map(r => {
                  const eff = Number(r.efficiency_pct)
                  return (
                    <div key={r.id} className="bg-navy-900 rounded-xl p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                      <div className="font-mono text-sm text-navy-400 sm:w-24 sm:flex-shrink-0">{r.hour_block}</div>
                      <div className="flex-1">
                        <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', efficiencyBg(eff))}
                            style={{ width: `${Math.min(eff, 100)}%` }} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:contents">
                        <div className="font-bold text-white font-mono sm:w-20 sm:text-right">
                          {r.good_count.toLocaleString('pl-PL')} szt
                        </div>
                        <div className={cn('font-bold text-sm sm:w-12 sm:text-right', efficiencyColor(eff))}>
                          {eff}%
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
