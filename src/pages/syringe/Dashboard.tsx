import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSyringeSession } from '@/hooks/useSyringeSession'
import { useSyringeCommand } from '@/hooks/useSyringeCommand'
import { invalidateSyringe } from '@/lib/syringeApi'
import SyringeSessionState from '@/components/shared/SyringeSessionState'
import { syringeRate, stoppedMinutes } from '@/lib/syringeMetrics'
import { isShiftSettlementAssortment } from '@/lib/syringeSettlement'
import { useClock } from '@/hooks/useClock'
import { formatHourBlock, SHIFT_HOURS } from '@/lib/utils'
import type { SaMachineStatus, SaProductionEntry, SaDowntimeEvent, ShiftType } from '@/types/database'

const STATUS_CONFIG: Record<SaMachineStatus, { label: string; color: string; bg: string; border: string }> = {
  production:       { label: 'Produkcja',           color: 'text-green-300',  bg: 'bg-green-500/15',  border: 'border-green-500/40' },
  changeover:       { label: 'Przezbrojenie',        color: 'text-yellow-300', bg: 'bg-yellow-500/15', border: 'border-yellow-500/40' },
  failure:          { label: 'Awaria',               color: 'text-red-300',    bg: 'bg-red-500/15',    border: 'border-red-500/40' },
  adjustment:       { label: 'Regulacja',            color: 'text-orange-300', bg: 'bg-orange-500/15', border: 'border-orange-500/40' },
  no_components:    { label: 'Brak komponentów',    color: 'text-amber-300',  bg: 'bg-amber-500/15',  border: 'border-amber-500/40' },
  quality_control:  { label: 'Kontrola jakości',    color: 'text-blue-300',   bg: 'bg-blue-500/15',   border: 'border-blue-500/40' },
  planned_stop:     { label: 'Planowany postój',    color: 'text-navy-300',   bg: 'bg-navy-700/50',   border: 'border-navy-600' },
  waiting:          { label: 'Oczekiwanie',          color: 'text-navy-300',   bg: 'bg-navy-700/50',   border: 'border-navy-600' },
  cleaning:         { label: 'Czyszczenie',          color: 'text-cyan-300',   bg: 'bg-cyan-500/15',   border: 'border-cyan-500/40' },
  end_of_production:{ label: 'Koniec produkcji',    color: 'text-navy-400',   bg: 'bg-navy-800',      border: 'border-navy-600' }
}

const ALL_STATUSES: SaMachineStatus[] = [
  'production','failure','adjustment','no_components',
  'quality_control','planned_stop','waiting','cleaning'
]

async function fetchStops(sessionId: string) {
  const downtime = await supabase.from('sa_downtime_events').select('started_at, ended_at').eq('session_id', sessionId).throwOnError()
  const changeovers = await supabase.from('sa_changeovers').select('started_at, ended_at').eq('session_id', sessionId).throwOnError()
  return [...(downtime.data ?? []), ...(changeovers.data ?? [])] as { started_at: string; ended_at: string | null }[]
}

async function fetchLastEntries(sessionId: string) {
  const { data, error } = await supabase
    .from('sa_production_entries')
    .select('*')
    .eq('session_id', sessionId)
    .eq('is_cancelled', false)
    .order('recorded_at', { ascending: false })
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(8)
  if (error) throw error
  return data as SaProductionEntry[] ?? []
}

async function fetchActiveDowntime(sessionId: string) {
  const { data, error } = await supabase
    .from('sa_downtime_events')
    .select('*, category:sa_downtime_categories(*)')
    .eq('session_id', sessionId)
    .is('ended_at', null)
    .maybeSingle()
  if (error) throw error
  return data as SaDowntimeEvent | null
}

function formatDuration(startedAt: string, nowMs: number = Date.now()) {
  const diff = Math.floor((nowMs - new Date(startedAt).getTime()) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return `${h}h ${m}m`
}

function KpiCard({ label, value, sub, highlight, danger }: { label: string; value: string | number; sub?: string; highlight?: boolean; danger?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${danger ? 'border-red-500/30 bg-red-500/5' : highlight ? 'border-brand/30 bg-brand/5' : 'border-navy-700 bg-navy-800'}`}>
      <div className="text-xs text-navy-400 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${danger ? 'text-red-400' : highlight ? 'text-brand' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-navy-500 mt-1">{sub}</div>}
    </div>
  )
}

export default function SyringeDashboard() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const command = useSyringeCommand()
  const { now } = useClock()
  const [showStatusPicker, setShowStatusPicker] = useState(false)

  const { data: session, isLoading, error: sessionError, refetch: refetchSession } = useSyringeSession()
  const { data: stops = [], error: stopsError } = useQuery({ queryKey: ['sa_session_stops', session?.id], queryFn: () => fetchStops(session!.id), enabled: !!session?.id, refetchInterval: 10000 })

  const { data: entries = [], error: entriesError } = useQuery({
    queryKey: ['sa_entries', session?.id],
    queryFn: () => fetchLastEntries(session!.id),
    enabled: !!session?.id,
    refetchInterval: 60000
  })

  const { data: activeDowntime, error: downtimeError } = useQuery({
    queryKey: ['sa_active_downtime', session?.id],
    queryFn: () => fetchActiveDowntime(session!.id),
    enabled: !!session?.id,
    refetchInterval: 15000
  })

  const statusMutation = useMutation({
    mutationFn: async (status: SaMachineStatus) => {
      if (!session) return
      await command('status', { session_id: session.id, status })
    },
    onSuccess: () => {
      void invalidateSyringe(qc)
      setShowStatusPicker(false)
    }
  })

  // Realtime subscription
  useEffect(() => {
    if (!session?.id) return
    const ch = supabase.channel(`sa_session_${session.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sa_sessions', filter: `id=eq.${session.id}` },
        () => qc.invalidateQueries({ queryKey: ['sa_my_session'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sa_production_entries', filter: `session_id=eq.${session.id}` },
        () => qc.invalidateQueries({ queryKey: ['sa_entries', session.id] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sa_downtime_events', filter: `session_id=eq.${session.id}` },
        () => qc.invalidateQueries({ queryKey: ['sa_active_downtime', session.id] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [session?.id, qc])

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-navy-400">Ładowanie...</div>
  }

  const loadError = entriesError || downtimeError
  if (loadError) return <div role="alert" className="p-5 text-red-400">
    Nie udało się odczytać danych: {loadError.message}
    <button className="btn-secondary ml-2" onClick={() => window.location.reload()}>Ponów odczyt</button>
  </div>

  if (!session || sessionError) {
    return <SyringeSessionState loading={isLoading} error={sessionError} retry={refetchSession} />
  }

  const statusCfg = STATUS_CONFIG[session.machine_status]
  const isShiftSettlementMode = isShiftSettlementAssortment(session.assortment?.code)
  const lastEntry = entries[0]
  const entryCount = entries.length
  const totalGood = session.total_good ?? 0
  const totalReject = session.total_reject ?? 0
  const totalProduced = session.total_produced ?? 0
  const planQty = session.plan_qty ?? 0
  const planPct = planQty > 0 ? Math.round(totalGood / planQty * 100) : null
  const rejectPct = totalProduced > 0 ? (totalReject / totalProduced * 100).toFixed(1) : '0.0'
  const elapsedMs = Date.now() - new Date(session.started_at).getTime()
  const avgPerHour = syringeRate(totalGood, elapsedMs)

  // Czas pracy vs przestojów i wydajność do nominalnej automatu.
  const elapsedMin = Math.floor(elapsedMs / 60000)
  const downtimeMin = stoppedMinutes(stops, session.started_at, now.getTime())
  const activeMin = Math.max(0, elapsedMin - downtimeMin)
  const fmtMin = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`
  const nominal = session.machine?.nominal_per_hour ?? 0
  const effPct = nominal > 0 && avgPerHour !== null ? Math.round(avgPerHour / nominal * 100) : null

  // Cele zmianowe na asortyment
  const shiftTarget = session.assortment?.shift_target_qty ?? null
  const rejectTargetPct = session.assortment?.reject_target_pct ?? null
  const rejectPctNum = totalProduced > 0 ? totalReject / totalProduced * 100 : 0

  // Przypomnienie o wpisie co 1h
  const lastEntryAt = lastEntry ? new Date(lastEntry.recorded_at).getTime() : new Date(session.started_at).getTime()
  const minSinceEntry = Math.floor((Date.now() - lastEntryAt) / 60000)
  const entryDue = !isShiftSettlementMode && minSinceEntry >= 60
  const entryLimit = isShiftSettlementMode ? 1 : 8
  const currentHourNo = isShiftSettlementMode ? 1 : Math.min(entryLimit, entryCount + 1)
  const remainingEntryCount = Math.max(0, entryLimit - entryCount)
  const shiftHours = SHIFT_HOURS[session.shift_type as ShiftType] ?? []
  const currentHourStart = shiftHours[Math.min(Math.max(0, currentHourNo - 1), Math.max(0, shiftHours.length - 1))]
  const currentHourBlock = currentHourStart !== undefined ? formatHourBlock(currentHourStart) : null
  const missingBlockLabels = isShiftSettlementMode
    ? []
    : shiftHours.slice(Math.min(entryCount, shiftHours.length)).map(formatHourBlock)

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {(statusMutation.error || stopsError) && <p role="alert" className="text-red-400">{statusMutation.error?.message || stopsError?.message}</p>}
      {/* Nagłówek */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">{session.machine?.name}</h1>
          <p className="text-navy-400 text-sm">
            Zmiana {session.shift_type} · {session.assortment?.name} ·
            Czas: {formatDuration(session.started_at, now.getTime())}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowStatusPicker(true)}
            className={`rounded-xl border-2 px-4 py-2 text-sm font-bold ${statusCfg.border} ${statusCfg.bg} ${statusCfg.color} transition-all`}
          >
            {statusCfg.label} ▾
          </button>
        </div>
      </div>

      {/* Przypomnienie o wpisie produkcyjnym co 1h */}
      {entryDue && !activeDowntime && (
        <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/10 p-4 flex items-center justify-between gap-4">
          <div>
            <div className="font-bold text-amber-300">Czas na wpis produkcyjny</div>
            <div className="text-sm text-amber-200 mt-0.5">
              Od ostatniego wpisu minęło {fmtMin(minSinceEntry)}. Wpisuj wynik co ok. 1h.
            </div>
          </div>
          <button
            onClick={() => navigate('/syringe/entry')}
            className="shrink-0 rounded-xl border border-amber-500/40 bg-amber-500/20 px-4 py-2 text-sm font-bold text-amber-300"
          >
            Wpisz produkcję
          </button>
        </div>
      )}

      {isShiftSettlementMode && !lastEntry && !activeDowntime && (
        <div className="rounded-xl border-2 border-brand/35 bg-brand/10 p-4 flex items-center justify-between gap-4">
          <div>
            <div className="font-bold text-brand">Rozliczenie na koniec zmiany</div>
            <div className="text-sm text-navy-200 mt-0.5">
              Dla tego asortymentu wynik wpisujesz raz: dobre sztuki, braki i kategorie braków.
            </div>
          </div>
          <button
            onClick={() => navigate('/syringe/entry')}
            className="shrink-0 rounded-xl border border-brand/40 bg-brand/20 px-4 py-2 text-sm font-bold text-brand"
          >
            Wpisz rozliczenie
          </button>
        </div>
      )}

      {/* Ostrzeżenie o aktywnym przestoju */}
      {activeDowntime && (
        <div className="rounded-xl border-2 border-red-500/40 bg-red-500/10 p-4 flex items-center justify-between gap-4">
          <div>
            <div className="font-bold text-red-300">Aktywny przestój</div>
            <div className="text-sm text-red-200 mt-0.5">
              {(activeDowntime as any).category?.name ?? 'Nieznana kategoria'} · trwa: {formatDuration(activeDowntime.started_at, now.getTime())}
            </div>
          </div>
          <button
            onClick={() => navigate('/syringe/downtime')}
            className="shrink-0 rounded-xl border border-red-500/40 bg-red-500/20 px-4 py-2 text-sm font-bold text-red-300"
          >
            Zakończ przestój
          </button>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Wyprodukowano" value={totalProduced.toLocaleString('pl')} sub="sztuk łącznie" />
        <KpiCard label="Sztuki dobre" value={totalGood.toLocaleString('pl')} highlight />
        <KpiCard
          label="Braki"
          value={totalReject.toLocaleString('pl')}
          sub={rejectTargetPct !== null ? `${rejectPct}% (cel: ${rejectTargetPct}%)` : `${rejectPct}%`}
          danger={rejectTargetPct !== null && rejectPctNum > rejectTargetPct}
        />
        <KpiCard
          label="Realizacja planu"
          value={planPct !== null ? `${planPct}%` : '—'}
          sub={planQty > 0 ? `Plan: ${planQty.toLocaleString('pl')} szt` : shiftTarget ? `Cel linii: ${shiftTarget.toLocaleString('pl')} szt` : 'Brak planu'}
          highlight={planPct !== null && planPct >= 100}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Wydajność" value={avgPerHour?.toLocaleString('pl') ?? '—'} sub={effPct !== null ? `${effPct}% nominalnej · szt/h` : 'szt/h średnia'} highlight={effPct !== null && effPct >= 95} />
        <KpiCard
          label="Wydajność nominalna"
          value={nominal ? nominal.toLocaleString('pl') : '—'}
          sub="szt/h"
        />
        <KpiCard
          label={isShiftSettlementMode ? 'Rozliczenie' : 'Licznik godzin'}
          value={isShiftSettlementMode ? '1/1' : `${currentHourNo}/${entryLimit}`}
          sub={isShiftSettlementMode ? 'wpis na koniec zmiany' : `${currentHourBlock ?? 'blok godziny'} · zostało ${remainingEntryCount}`}
          highlight={!isShiftSettlementMode && entryDue}
        />
        <KpiCard label="Czas przestojów" value={fmtMin(downtimeMin)} sub={elapsedMin > 0 ? `${Math.round(downtimeMin / elapsedMin * 100)}% zmiany` : ''} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <KpiCard label="Czas aktywnej pracy" value={fmtMin(activeMin)} sub={`z ${fmtMin(elapsedMin)} zmiany`} />
        <KpiCard
          label="Od ostatniego wpisu"
          value={fmtMin(minSinceEntry)}
          sub={isShiftSettlementMode ? 'rozliczenie końcowe' : entryDue ? 'wpis jest należny' : `do wpisu ok. ${Math.max(0, 60 - minSinceEntry)} min`}
          highlight={!isShiftSettlementMode && entryDue}
        />
      </div>

      {missingBlockLabels.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-navy-800 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-amber-300">Brakujące bloki</div>
              <div className="mt-1 text-sm text-navy-300">
                Te wpisy trzeba jeszcze uzupełnić przed normalnym zamknięciem zmiany.
              </div>
            </div>
            <button
              onClick={() => navigate('/syringe/entry')}
              disabled={!!activeDowntime}
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-bold text-amber-200 disabled:opacity-40"
            >
              Wpisz produkcję
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {missingBlockLabels.map(label => (
              <span key={label} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-100">
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Pozostało"
          value={planQty > 0 ? Math.max(0, planQty - totalGood).toLocaleString('pl') : '—'}
          sub="szt do planu"
        />
        <KpiCard
          label="Zlecenie"
          value={session.order ? session.order.order_number : '—'}
          sub={session.order ? `Cel: ${session.order.target_qty.toLocaleString('pl')} szt` : 'Brak zlecenia'}
        />
        <KpiCard label="Braki techn." value={(session.total_tech_reject ?? 0).toLocaleString('pl')} sub="sztuk" />
        <KpiCard label="Braki jakość" value={(session.total_qual_reject ?? 0).toLocaleString('pl')} sub="sztuk" />
      </div>

      {/* Pasek wydajności do nominalnej */}
      {effPct !== null && (
        <div className="rounded-xl border border-navy-700 bg-navy-800 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-navy-400">Wydajność względem nominalnej</span>
            <span className={`font-bold ${effPct >= 95 ? 'text-green-400' : effPct >= 75 ? 'text-yellow-400' : 'text-red-400'}`}>{effPct}%</span>
          </div>
          <div className="h-3 bg-navy-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${effPct >= 95 ? 'bg-green-500' : effPct >= 75 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, effPct)}%` }}
            />
          </div>
          <div className="text-xs text-navy-500">{avgPerHour?.toLocaleString('pl') ?? '—'} / {nominal.toLocaleString('pl')} szt/h</div>
        </div>
      )}

      {/* Pasek planu */}
      {planPct !== null && (
        <div className="rounded-xl border border-navy-700 bg-navy-800 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-navy-400">Realizacja planu</span>
            <span className={`font-bold ${planPct >= 100 ? 'text-green-400' : planPct >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
              {planPct}%
            </span>
          </div>
          <div className="h-3 bg-navy-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${planPct >= 100 ? 'bg-green-500' : planPct >= 80 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, planPct)}%` }}
            />
          </div>
          <div className="text-xs text-navy-500">
            {totalGood.toLocaleString('pl')} / {planQty.toLocaleString('pl')} szt
          </div>
        </div>
      )}

      {/* Ostatni wpis */}
      {lastEntry && (
        <div className="rounded-xl border border-navy-700 bg-navy-800 p-4">
          <div className="flex flex-wrap justify-between gap-3 mb-3">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400">
              {isShiftSettlementMode ? 'Rozliczenie zmiany' : 'Ostatni wpis produkcyjny'}
            </div>
            <button className="btn-secondary" onClick={() => navigate('/syringe/entry?edit=last')}>Popraw ostatni wpis</button>
          </div>
          <div className={`grid grid-cols-2 ${isShiftSettlementMode ? 'sm:grid-cols-4' : 'sm:grid-cols-5'} gap-3 text-sm`}>
            <div>
              <div className="text-navy-500">Godzina</div>
              <div className="text-white font-medium">{new Date(lastEntry.recorded_at).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            {!isShiftSettlementMode && (
              <>
                <div>
                  <div className="text-navy-500">Licznik druk</div>
                  <div className="text-white font-medium">{(lastEntry.counter_print_value ?? lastEntry.counter_value).toLocaleString('pl')}</div>
                </div>
                <div>
                  <div className="text-navy-500">Licznik montaż</div>
                  <div className="text-white font-medium">{(lastEntry.counter_assembly_value ?? lastEntry.counter_value).toLocaleString('pl')}</div>
                </div>
              </>
            )}
            {isShiftSettlementMode && (
              <div>
                <div className="text-navy-500">Dobre</div>
                <div className="text-white font-medium">{lastEntry.good_qty.toLocaleString('pl')}</div>
              </div>
            )}
            <div>
              <div className="text-navy-500">Braki</div>
              <div className="text-white font-medium">{lastEntry.reject_qty.toLocaleString('pl')}</div>
            </div>
            <div>
              <div className="text-navy-500">{isShiftSettlementMode ? 'Razem' : 'Wydajność'}</div>
              <div className="text-white font-medium">
                {isShiftSettlementMode ? lastEntry.produced_qty.toLocaleString('pl') : lastEntry.per_hour !== null ? `${Math.round(lastEntry.per_hour).toLocaleString('pl')} szt/h` : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Główne akcje */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <button
          onClick={() => navigate('/syringe/entry')}
          disabled={!!activeDowntime}
          className="rounded-2xl border-2 border-brand bg-brand/10 p-5 text-left transition-all hover:bg-brand/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <div className="text-brand text-2xl mb-2">+</div>
          <div className="font-bold text-white">{isShiftSettlementMode ? 'Rozlicz zmianę' : 'Wpisz produkcję'}</div>
          <div className="text-xs text-navy-400 mt-1">{isShiftSettlementMode ? 'Dobre sztuki i braki' : 'Stan licznika i braki'}</div>
        </button>

        <button
          onClick={() => navigate('/syringe/downtime')}
          className={`rounded-2xl border-2 p-5 text-left transition-all ${
            activeDowntime
              ? 'border-red-500/50 bg-red-500/10 hover:bg-red-500/20'
              : 'border-navy-600 bg-navy-800 hover:border-navy-500'
          }`}
        >
          <div className={`text-2xl mb-2 ${activeDowntime ? 'text-red-400' : 'text-navy-400'}`}>
            {activeDowntime ? '⏹' : '⏸'}
          </div>
          <div className="font-bold text-white">{activeDowntime ? 'Zakończ przestój' : 'Rozpocznij przestój'}</div>
          <div className="text-xs text-navy-400 mt-1">Rejestracja przestojów</div>
        </button>

        <button
          onClick={() => navigate('/syringe/failure')}
          className="rounded-2xl border-2 border-navy-600 bg-navy-800 p-5 text-left transition-all hover:border-red-500/40 hover:bg-red-500/5"
        >
          <div className="text-red-400 text-2xl mb-2">⚠</div>
          <div className="font-bold text-white">Zgłoś awarię</div>
          <div className="text-xs text-navy-400 mt-1">Formularz awarii</div>
        </button>

        <button
          onClick={() => navigate('/syringe/quality')}
          className="rounded-2xl border-2 border-navy-600 bg-navy-800 p-5 text-left transition-all hover:border-yellow-500/40 hover:bg-yellow-500/5"
        >
          <div className="text-yellow-400 text-2xl mb-2">◆</div>
          <div className="font-bold text-white">Problem jakości</div>
          <div className="text-xs text-navy-400 mt-1">Zgłoszenie jakościowe</div>
        </button>

        <button
          onClick={() => navigate('/syringe/components')}
          className="rounded-2xl border-2 border-navy-600 bg-navy-800 p-5 text-left transition-all hover:border-navy-500"
        >
          <div className="text-navy-400 text-2xl mb-2">◉</div>
          <div className="font-bold text-white">Komponenty</div>
          <div className="text-xs text-navy-400 mt-1">Zmiana partii</div>
        </button>

        <button
          onClick={() => navigate('/syringe/changeover')}
          className="rounded-2xl border-2 border-navy-600 bg-navy-800 p-5 text-left transition-all hover:border-yellow-500/40 hover:bg-yellow-500/5"
        >
          <div className="text-yellow-300 text-2xl mb-2">⇄</div>
          <div className="font-bold text-white">Przezbrojenie</div>
          <div className="text-xs text-navy-400 mt-1">Zmiana asortymentu</div>
        </button>

        <button
          onClick={() => navigate('/syringe/my-reports')}
          className="rounded-2xl border-2 border-navy-600 bg-navy-800 p-5 text-left transition-all hover:border-navy-500"
        >
          <div className="text-navy-400 text-2xl mb-2">☰</div>
          <div className="font-bold text-white">Moje zgłoszenia</div>
          <div className="text-xs text-navy-400 mt-1">Status awarii i jakości</div>
        </button>
      </div>

      {/* Zakończenie zmiany */}
      <div className="pt-2">
        <button
          onClick={() => navigate('/syringe/handover')}
          className="w-full rounded-2xl border-2 border-navy-600 bg-navy-800 p-4 text-center font-bold text-navy-300 hover:border-navy-500 hover:text-white transition-all"
        >
          Zamknij zmianę →
        </button>
      </div>

      {/* Modal wyboru statusu */}
      {showStatusPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-700 rounded-2xl p-5 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <div className="font-bold text-white">Status automatu</div>
              <button onClick={() => setShowStatusPicker(false)} className="text-navy-400 hover:text-white text-xl">×</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {statusMutation.error && <p role="alert" className="col-span-2 text-red-400">{statusMutation.error.message}</p>}
              {ALL_STATUSES.map(s => {
                const cfg = STATUS_CONFIG[s]
                return (
                  <button
                    key={s}
                    onClick={() => {
                      if (s === 'production') statusMutation.mutate(s)
                      else navigate(s === 'failure' ? '/syringe/failure' : s === 'quality_control' ? '/syringe/quality' : '/syringe/downtime')
                    }}
                    disabled={statusMutation.isPending}
                    className={`rounded-xl border-2 px-3 py-3 text-sm font-bold text-left transition-all ${
                      session.machine_status === s
                        ? `${cfg.border} ${cfg.bg} ${cfg.color}`
                        : 'border-navy-600 text-navy-300 hover:border-navy-500'
                    }`}
                  >
                    {cfg.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
