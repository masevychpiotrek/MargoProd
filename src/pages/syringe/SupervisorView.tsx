import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { SaSession, SaMachine, SaMachineStatus } from '@/types/database'

const STATUS_CONFIG: Record<SaMachineStatus, { label: string; dot: string; badge: string }> = {
  production:       { label: 'Produkcja',       dot: 'bg-green-400',  badge: 'bg-green-500/15 text-green-300 border-green-500/30' },
  changeover:       { label: 'Przezbrojenie',   dot: 'bg-yellow-400', badge: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' },
  failure:          { label: 'Awaria',          dot: 'bg-red-400 animate-pulse', badge: 'bg-red-500/15 text-red-300 border-red-500/30' },
  adjustment:       { label: 'Regulacja',       dot: 'bg-orange-400', badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  no_components:    { label: 'Brak komp.',      dot: 'bg-amber-400',  badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  quality_control:  { label: 'Kontrola jk.',   dot: 'bg-blue-400',   badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  planned_stop:     { label: 'Post. plan.',     dot: 'bg-navy-400',   badge: 'bg-navy-700 text-navy-300 border-navy-600' },
  waiting:          { label: 'Oczekiwanie',     dot: 'bg-navy-400',   badge: 'bg-navy-700 text-navy-300 border-navy-600' },
  cleaning:         { label: 'Czyszczenie',     dot: 'bg-cyan-400',   badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  end_of_production:{ label: 'Koniec prod.',    dot: 'bg-navy-500',   badge: 'bg-navy-800 text-navy-400 border-navy-700' },
}

async function fetchMachines() {
  const { data } = await supabase.from('sa_machines').select('*').eq('is_active', true).is('deleted_at', null).order('sort_order')
  return data as SaMachine[] ?? []
}

async function fetchActiveSessions() {
  const { data } = await supabase
    .from('sa_sessions')
    .select(`*, machine:sa_machines(*), operator:profiles!sa_sessions_operator_id_fkey(id, full_name), assortment:sa_assortments(*), order:sa_orders(*)`)
    .is('ended_at', null)
  return data as SaSession[] ?? []
}

async function fetchActiveDowntimes() {
  const { data } = await supabase
    .from('sa_downtime_events')
    .select('session_id, started_at, category:sa_downtime_categories(name)')
    .is('ended_at', null)
  return data ?? []
}

async function fetchActiveFailures() {
  const { data } = await supabase
    .from('sa_failure_reports')
    .select('machine_id, priority, status')
    .not('status', 'in', '(resolved,closed)')
  return data ?? []
}

async function fetchActiveQualityIssues() {
  const { data } = await supabase
    .from('sa_quality_issues')
    .select('machine_id, status')
    .not('status', 'in', '(resolved,closed)')
  return data ?? []
}

function formatDuration(startedAt: string) {
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function SyringeSupervisorView() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [filterStatus, setFilterStatus] = useState<string>('')


  const { data: machines = [] } = useQuery({ queryKey: ['sa_machines'], queryFn: fetchMachines })
  const { data: sessions = [], dataUpdatedAt } = useQuery({
    queryKey: ['sa_supervisor_sessions'],
    queryFn: fetchActiveSessions,
    refetchInterval: 15000
  })
  const { data: downtimes = [] } = useQuery({
    queryKey: ['sa_supervisor_downtimes'],
    queryFn: fetchActiveDowntimes,
    refetchInterval: 15000
  })
  const { data: failures = [] } = useQuery({
    queryKey: ['sa_supervisor_failures'],
    queryFn: fetchActiveFailures,
    refetchInterval: 15000
  })
  const { data: qualityIssues = [] } = useQuery({
    queryKey: ['sa_supervisor_quality'],
    queryFn: fetchActiveQualityIssues,
    refetchInterval: 15000
  })

  // Realtime
  useEffect(() => {
    const ch = supabase.channel('sa_supervisor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sa_sessions' },
        () => {
          qc.invalidateQueries({ queryKey: ['sa_supervisor_sessions'] })
          qc.invalidateQueries({ queryKey: ['sa_supervisor_downtimes'] })
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sa_failure_reports' },
        () => qc.invalidateQueries({ queryKey: ['sa_supervisor_failures'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sa_quality_issues' },
        () => qc.invalidateQueries({ queryKey: ['sa_supervisor_quality'] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [qc])

  const sessionByMachine = new Map(sessions.map(s => [s.machine_id, s]))
  const downtimeBySession = new Map(downtimes.map(d => [d.session_id, d]))
  const failuresByMachine = failures.reduce<Record<string, typeof failures>>((acc, f) => {
    if (!acc[f.machine_id]) acc[f.machine_id] = []
    acc[f.machine_id].push(f)
    return acc
  }, {})
  const qualityByMachine = qualityIssues.reduce<Record<string, number>>((acc, q) => {
    acc[q.machine_id] = (acc[q.machine_id] ?? 0) + 1
    return acc
  }, {})

  const filteredMachines = filterStatus
    ? machines.filter(m => {
        const s = sessionByMachine.get(m.id)
        return s?.machine_status === filterStatus
      })
    : machines

  const stats = {
    total: machines.length,
    active: sessions.filter(s => s.machine_status === 'production').length,
    stopped: sessions.filter(s => ['failure', 'waiting', 'no_components'].includes(s.machine_status)).length,
    noSession: machines.length - sessions.length
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Panel nadzorczy — Automaty strzykawkowe</h1>
          <p className="text-navy-400 text-sm">
            Odświeżono: {new Date(dataUpdatedAt).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
        <button onClick={() => navigate('/syringe/reports')} className="btn-primary px-4 py-2">Raporty i eksport</button>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterStatus('')}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold border transition-all ${!filterStatus ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-navy-400 hover:border-navy-500'}`}
          >
            Wszystkie ({machines.length})
          </button>
          <button
            onClick={() => setFilterStatus('production')}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold border transition-all ${filterStatus === 'production' ? 'border-green-500 bg-green-500/10 text-green-300' : 'border-navy-600 text-navy-400 hover:border-navy-500'}`}
          >
            Produkcja ({stats.active})
          </button>
          <button
            onClick={() => setFilterStatus('failure')}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold border transition-all ${filterStatus === 'failure' ? 'border-red-500 bg-red-500/10 text-red-300' : 'border-navy-600 text-navy-400 hover:border-navy-500'}`}
          >
            Awarie
          </button>
        </div>
      </div>

      {/* Podsumowanie */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Automaty razem', value: stats.total, color: 'text-white' },
          { label: 'W produkcji', value: stats.active, color: 'text-green-400' },
          { label: 'Zatrzymane', value: stats.stopped, color: stats.stopped > 0 ? 'text-red-400' : 'text-white' },
          { label: 'Bez sesji', value: stats.noSession, color: stats.noSession > 0 ? 'text-amber-400' : 'text-white' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-navy-700 bg-navy-800 p-4">
            <div className="text-xs text-navy-400 uppercase tracking-wider">{s.label}</div>
            <div className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Karty automatów */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredMachines.map(machine => {
          const session = sessionByMachine.get(machine.id)
          const downtime = session ? downtimeBySession.get(session.id) : null
          const mFailures = failuresByMachine[machine.id] ?? []
          const mQuality = qualityByMachine[machine.id] ?? 0

          if (!session) {
            return (
              <div key={machine.id} className="rounded-2xl border border-navy-700 bg-navy-800 p-5 opacity-60">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-bold text-white">{machine.name}</div>
                  <div className="w-2 h-2 rounded-full bg-navy-500" />
                </div>
                <div className="text-sm text-navy-500">Brak aktywnej sesji</div>
                <div className="text-xs text-navy-600 mt-1">{machine.code}</div>
              </div>
            )
          }

          const status = session.machine_status
          const cfg = STATUS_CONFIG[status]
          const totalGood = session.total_good ?? 0
          const planQty = session.plan_qty ?? 0
          const planPct = planQty > 0 ? Math.round(totalGood / planQty * 100) : null
          const elapsedH = (Date.now() - new Date(session.started_at).getTime()) / 3600000
          const avgPerHour = elapsedH > 0 && totalGood > 0 ? Math.round(totalGood / elapsedH) : 0

          return (
            <div key={machine.id} className={`rounded-2xl border-2 p-5 space-y-4 ${cfg.badge}`}>
              {/* Nagłówek */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-white text-lg">{machine.name}</div>
                  <div className="text-xs text-navy-400">{machine.code}</div>
                </div>
                <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${cfg.badge}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </div>
              </div>

              {/* Operator i asortyment */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-navy-500 text-xs">Operator</div>
                  <div className="text-white font-medium truncate">{(session.operator as any)?.full_name ?? '—'}</div>
                </div>
                <div>
                  <div className="text-navy-500 text-xs">Asortyment</div>
                  <div className="text-white font-medium">{session.assortment?.name ?? '—'}</div>
                </div>
                <div>
                  <div className="text-navy-500 text-xs">Zmiana</div>
                  <div className="text-white font-medium">{session.shift_type}</div>
                </div>
                <div>
                  <div className="text-navy-500 text-xs">Zlecenie</div>
                  <div className="text-white font-medium text-xs">{session.order?.order_number ?? '—'}</div>
                </div>
              </div>

              {/* KPI */}
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg bg-navy-900/50 p-2 text-center">
                  <div className="text-xs text-navy-500">Plan</div>
                  <div className="font-bold text-white">{planQty > 0 ? planQty.toLocaleString('pl') : '—'}</div>
                </div>
                <div className="rounded-lg bg-navy-900/50 p-2 text-center">
                  <div className="text-xs text-navy-500">Wykonano</div>
                  <div className="font-bold text-green-400">{totalGood.toLocaleString('pl')}</div>
                </div>
                <div className="rounded-lg bg-navy-900/50 p-2 text-center">
                  <div className="text-xs text-navy-500">Plan %</div>
                  <div className={`font-bold ${planPct !== null ? (planPct >= 100 ? 'text-green-400' : planPct >= 80 ? 'text-yellow-400' : 'text-red-400') : 'text-navy-400'}`}>
                    {planPct !== null ? `${planPct}%` : '—'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-navy-900/50 p-2 text-center">
                  <div className="text-xs text-navy-500">Wydajność</div>
                  <div className="font-bold text-white">{avgPerHour > 0 ? `${avgPerHour.toLocaleString('pl')} szt/h` : '—'}</div>
                </div>
                <div className="rounded-lg bg-navy-900/50 p-2 text-center">
                  <div className="text-xs text-navy-500">Braki</div>
                  <div className="font-bold text-red-400">{(session.total_reject ?? 0).toLocaleString('pl')}</div>
                </div>
              </div>

              {/* Przestój */}
              {downtime && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                  Przestój: {(downtime as any).category?.name ?? '—'} · {formatDuration(downtime.started_at)}
                </div>
              )}

              {/* Alerty */}
              {(mFailures.length > 0 || mQuality > 0) && (
                <div className="flex gap-2">
                  {mFailures.length > 0 && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">
                      {mFailures.length} awari{mFailures.length === 1 ? 'a' : 'e'}
                    </div>
                  )}
                  {mQuality > 0 && (
                    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-300">
                      {mQuality} problem{mQuality === 1 ? '' : 'y'} jk.
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
