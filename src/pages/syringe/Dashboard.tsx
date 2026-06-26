import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { SaSession, SaMachineStatus, SaProductionEntry, SaDowntimeEvent } from '@/types/database'

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
  'production','changeover','failure','adjustment','no_components',
  'quality_control','planned_stop','waiting','cleaning','end_of_production'
]

async function fetchMySession(operatorId: string) {
  const { data } = await supabase
    .from('sa_sessions')
    .select(`*, machine:sa_machines(*), assortment:sa_assortments(*), order:sa_orders(*)`)
    .eq('operator_id', operatorId)
    .is('ended_at', null)
    .maybeSingle()
  return data as SaSession | null
}

async function fetchLastEntries(sessionId: string) {
  const { data } = await supabase
    .from('sa_production_entries')
    .select('*')
    .eq('session_id', sessionId)
    .eq('is_cancelled', false)
    .order('recorded_at', { ascending: false })
    .limit(5)
  return data as SaProductionEntry[] ?? []
}

async function fetchActiveDowntime(sessionId: string) {
  const { data } = await supabase
    .from('sa_downtime_events')
    .select('*, category:sa_downtime_categories(*)')
    .eq('session_id', sessionId)
    .is('ended_at', null)
    .maybeSingle()
  return data as SaDowntimeEvent | null
}

function formatDuration(startedAt: string) {
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return `${h}h ${m}m`
}

function KpiCard({ label, value, sub, highlight }: { label: string; value: string | number; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'border-brand/30 bg-brand/5' : 'border-navy-700 bg-navy-800'}`}>
      <div className="text-xs text-navy-400 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${highlight ? 'text-brand' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-navy-500 mt-1">{sub}</div>}
    </div>
  )
}

export default function SyringeDashboard() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showStatusPicker, setShowStatusPicker] = useState(false)

  const { data: session, isLoading } = useQuery({
    queryKey: ['sa_my_session', profile?.id],
    queryFn: () => fetchMySession(profile!.id),
    enabled: !!profile?.id,
    refetchInterval: 30000
  })

  const { data: entries = [] } = useQuery({
    queryKey: ['sa_entries', session?.id],
    queryFn: () => fetchLastEntries(session!.id),
    enabled: !!session?.id,
    refetchInterval: 60000
  })

  const { data: activeDowntime } = useQuery({
    queryKey: ['sa_active_downtime', session?.id],
    queryFn: () => fetchActiveDowntime(session!.id),
    enabled: !!session?.id,
    refetchInterval: 15000
  })

  const statusMutation = useMutation({
    mutationFn: async (status: SaMachineStatus) => {
      if (!session) return
      await supabase.from('sa_sessions').update({ machine_status: status }).eq('id', session.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_my_session'] })
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

  if (!session) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-navy-800 border border-navy-700 flex items-center justify-center mx-auto">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-navy-500">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Brak aktywnej sesji</h2>
          <p className="text-navy-400 text-sm mt-2">Rozpocznij zmianę, aby przejść do rejestracji produkcji.</p>
        </div>
        <button onClick={() => navigate('/syringe/start')} className="btn-primary px-8 py-3 text-lg">
          Rozpocznij zmianę
        </button>
      </div>
    )
  }

  const statusCfg = STATUS_CONFIG[session.machine_status]
  const lastEntry = entries[0]
  const totalGood = session.total_good ?? 0
  const totalReject = session.total_reject ?? 0
  const totalProduced = session.total_produced ?? 0
  const planQty = session.plan_qty ?? 0
  const planPct = planQty > 0 ? Math.min(100, Math.round(totalGood / planQty * 100)) : null
  const rejectPct = totalProduced > 0 ? (totalReject / totalProduced * 100).toFixed(1) : '0.0'
  const elapsedMs = Date.now() - new Date(session.started_at).getTime()
  const elapsedH = elapsedMs / 3600000
  const avgPerHour = elapsedH > 0 ? Math.round(totalGood / elapsedH) : 0

  // Czas pracy vs przestojów i wydajność do nominalnej
  const elapsedMin = Math.floor(elapsedMs / 60000)
  const downtimeMin = session.total_downtime_min ?? 0
  const activeMin = Math.max(0, elapsedMin - downtimeMin)
  const fmtMin = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`
  const nominal = session.assortment?.nominal_per_hour ?? 0
  const effPct = nominal > 0 ? Math.round(avgPerHour / nominal * 100) : null

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Nagłówek */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">{session.machine?.name}</h1>
          <p className="text-navy-400 text-sm">
            Zmiana {session.shift_type} · {session.assortment?.name} ·
            Czas: {formatDuration(session.started_at)}
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

      {/* Ostrzeżenie o aktywnym przestoju */}
      {activeDowntime && (
        <div className="rounded-xl border-2 border-red-500/40 bg-red-500/10 p-4 flex items-center justify-between gap-4">
          <div>
            <div className="font-bold text-red-300">Aktywny przestój</div>
            <div className="text-sm text-red-200 mt-0.5">
              {(activeDowntime as any).category?.name ?? 'Nieznana kategoria'} · trwa: {formatDuration(activeDowntime.started_at)}
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
        <KpiCard label="Braki" value={totalReject.toLocaleString('pl')} sub={`${rejectPct}%`} />
        <KpiCard
          label="Realizacja planu"
          value={planPct !== null ? `${planPct}%` : '—'}
          sub={planQty > 0 ? `Plan: ${planQty.toLocaleString('pl')} szt` : 'Brak planu'}
          highlight={planPct !== null && planPct >= 100}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Wydajność" value={`${avgPerHour.toLocaleString('pl')}`} sub={effPct !== null ? `${effPct}% nominalnej` : 'szt/h średnia'} highlight={effPct !== null && effPct >= 95} />
        <KpiCard
          label="Wydajność nominalna"
          value={nominal ? nominal.toLocaleString('pl') : '—'}
          sub="szt/h"
        />
        <KpiCard label="Czas aktywnej pracy" value={fmtMin(activeMin)} sub={`z ${fmtMin(elapsedMin)} zmiany`} />
        <KpiCard label="Czas przestojów" value={fmtMin(downtimeMin)} sub={elapsedMin > 0 ? `${Math.round(downtimeMin / elapsedMin * 100)}% zmiany` : ''} />
      </div>

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
          <div className="text-xs text-navy-500">{avgPerHour.toLocaleString('pl')} / {nominal.toLocaleString('pl')} szt/h</div>
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
          <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">Ostatni wpis produkcyjny</div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-navy-500">Godzina</div>
              <div className="text-white font-medium">{new Date(lastEntry.recorded_at).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <div>
              <div className="text-navy-500">Licznik</div>
              <div className="text-white font-medium">{lastEntry.counter_value.toLocaleString('pl')}</div>
            </div>
            <div>
              <div className="text-navy-500">Wydajność</div>
              <div className="text-white font-medium">{lastEntry.per_hour ? `${Math.round(lastEntry.per_hour).toLocaleString('pl')} szt/h` : '—'}</div>
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
          <div className="font-bold text-white">Wpisz produkcję</div>
          <div className="text-xs text-navy-400 mt-1">Stan licznika i braki</div>
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
          Przekaż zmianę i zakończ →
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
              {ALL_STATUSES.map(s => {
                const cfg = STATUS_CONFIG[s]
                return (
                  <button
                    key={s}
                    onClick={() => statusMutation.mutate(s)}
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
