import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ISSUE_STATUS_LABELS } from '@/types/tpm'
import type { TpmIssue, AmChecklist, TpmMachine } from '@/types/tpm'

const OPEN_STATUSES = ['new','awaiting_ack','accepted','diagnosing','immediate_done','repairing','awaiting_part','awaiting_manager','observation','testing','escalated_a1tec','resolved','awaiting_approval','reopened']

async function fetchAll() {
  const [issuesRes, checklistsRes, machinesRes, stationsRes] = await Promise.all([
    supabase.from('tpm_issues').select('*, machine:tpm_machines(*), station:tpm_stations(*)').order('created_at', { ascending: false }).limit(500),
    supabase.from('tpm_am_checklists').select('*').gte('checklist_date', new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0]),
    supabase.from('tpm_machines').select('*').eq('is_active', true),
    supabase.from('tpm_stations').select('*').eq('is_active', true)
  ])
  return {
    issues: (issuesRes.data ?? []) as TpmIssue[],
    checklists: (checklistsRes.data ?? []) as AmChecklist[],
    machines: (machinesRes.data ?? []) as TpmMachine[],
    stations: (stationsRes.data ?? []) as { id: string; station_number: string; machine_id: string }[]
  }
}

function KpiTile({ label, value, color, onClick }: { label: string; value: string | number; color?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`rounded-xl border border-navy-700 bg-navy-800 p-4 text-left ${onClick ? 'hover:border-brand/40 cursor-pointer' : 'cursor-default'}`}>
      <div className="text-xs text-navy-400 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ?? 'text-white'}`}>{value}</div>
    </button>
  )
}

export default function TpmManagerDashboard() {
  const navigate = useNavigate()
  const [recurMsg, setRecurMsg] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['tpm_manager_dash'], queryFn: fetchAll, refetchInterval: 60000 })

  const recurMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('tpm_mark_recurring')
      if (error) throw error
      return data as number
    },
    onSuccess: (n) => { setRecurMsg(`Oznaczono powtarzalne: ${n}`); setTimeout(() => setRecurMsg(''), 4000) },
    onError: (e: Error) => { setRecurMsg('Błąd: ' + e.message); setTimeout(() => setRecurMsg(''), 4000) }
  })

  const stats = useMemo(() => {
    if (!data) return null
    const { issues, checklists, machines, stations } = data
    const open = issues.filter(i => OPEN_STATUSES.includes(i.status))
    const critical = open.filter(i => i.priority === 'critical')
    const recurring = issues.filter(i => i.is_recurring && OPEN_STATUSES.includes(i.status))
    const a1tec = issues.filter(i => i.a1tec_escalated && i.status !== 'closed')
    const awaitingApproval = issues.filter(i => i.status === 'awaiting_approval')
    const noReaction = open.filter(i => ['new', 'awaiting_ack'].includes(i.status))
    const noDiagnosis = open.filter(i => !i.diagnosis && ['accepted', 'diagnosing'].includes(i.status))
    const overdue = open.filter(i => i.due_date && new Date(i.due_date) < new Date())
    const ineffective = issues.filter(i => i.verification_result === 'ineffective')

    // czas postoju
    const downtimeTotal = issues.reduce((s, i) => s + (i.downtime_min ?? 0), 0)
    const downtimeIS3 = issues.filter(i => i.machine?.code === 'IS-3').reduce((s, i) => s + (i.downtime_min ?? 0), 0)
    const downtimeIS4 = issues.filter(i => i.machine?.code === 'IS-4').reduce((s, i) => s + (i.downtime_min ?? 0), 0)
    const nokTotal = issues.reduce((s, i) => s + (i.nok_count ?? 0), 0)

    // AM realizacja 7 dni — oczekiwane: machines * 3 zmiany * 7 dni
    const expectedAm = machines.length * 3 * 7
    const doneAm = checklists.filter(c => c.status !== 'in_progress').length
    const amPct = expectedAm > 0 ? Math.round(doneAm / expectedAm * 100) : 0

    // TOP stacje wg liczby awarii
    const byStation: Record<string, { num: string; count: number; downtime: number }> = {}
    for (const i of issues) {
      const key = i.station_id
      const num = (i.station as { station_number?: string })?.station_number ?? '?'
      if (!byStation[key]) byStation[key] = { num, count: 0, downtime: 0 }
      byStation[key].count++
      byStation[key].downtime += i.downtime_min ?? 0
    }
    const topByCount = Object.values(byStation).sort((a, b) => b.count - a.count).slice(0, 5)
    const topByDowntime = Object.values(byStation).sort((a, b) => b.downtime - a.downtime).slice(0, 5)

    // MTTR — średni czas naprawy (intervention_start → intervention_end)
    const repaired = issues.filter(i => i.intervention_start && i.intervention_end)
    const mttr = repaired.length > 0
      ? Math.round(repaired.reduce((s, i) => s + (new Date(i.intervention_end!).getTime() - new Date(i.intervention_start!).getTime()) / 60000, 0) / repaired.length)
      : 0
    // średni czas reakcji (report_time → ack_time)
    const acked = issues.filter(i => i.ack_time)
    const reaction = acked.length > 0
      ? Math.round(acked.reduce((s, i) => s + (new Date(i.ack_time!).getTime() - new Date(i.report_time).getTime()) / 60000, 0) / acked.length)
      : 0
    // MTBF — średni odstęp między awariami (dni), per stacja, uśredniony
    const perStationTimes: Record<string, number[]> = {}
    for (const i of issues) {
      (perStationTimes[i.station_id] ??= []).push(new Date(i.report_time).getTime())
    }
    const intervals: number[] = []
    for (const arr of Object.values(perStationTimes)) {
      if (arr.length < 2) continue
      arr.sort((a, b) => a - b)
      for (let k = 1; k < arr.length; k++) intervals.push(arr[k] - arr[k - 1])
    }
    const mtbf = intervals.length > 0
      ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length / 864e5 * 10) / 10
      : 0

    return {
      total: issues.length, open: open.length, critical, recurring, a1tec, awaitingApproval,
      noReaction, noDiagnosis, overdue, ineffective, amPct, doneAm, expectedAm,
      downtimeTotal, downtimeIS3, downtimeIS4, nokTotal, topByCount, topByDowntime, mttr, mtbf, reaction,
      stationCount: stations.length
    }
  }, [data])

  if (isLoading || !stats) return <div className="text-navy-400 text-center py-16">Ładowanie...</div>

  const goQueue = (status?: string) => navigate(status ? `/tpm/issues?status=${status}` : '/tpm/issues')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">TPM/PM — Nadzór Kierownika</h1>
          <p className="text-navy-400 text-sm">IS PRO · IS-3 i IS-4</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => navigate('/tpm/issues')} className="btn-secondary px-4 py-2">Zgłoszenia</button>
          <button onClick={() => navigate('/tpm/pm')} className="btn-secondary px-4 py-2">Karty PM</button>
          <button onClick={() => navigate('/tpm/parameters')} className="btn-secondary px-4 py-2">Parametry</button>
          <button onClick={() => navigate('/tpm/parts')} className="btn-secondary px-4 py-2">Części</button>
          <button onClick={() => navigate('/tpm/pareto')} className="btn-secondary px-4 py-2">Pareto</button>
          <button onClick={() => navigate('/tpm/reports')} className="btn-secondary px-4 py-2">Raporty</button>
          <button onClick={() => navigate('/tpm/a1tec')} className="btn-secondary px-4 py-2">Rejestr A1TEC</button>
          <button onClick={() => navigate('/tpm/stations')} className="btn-secondary px-4 py-2">Stacje i checklisty</button>
          <button onClick={() => recurMut.mutate()} disabled={recurMut.isPending} className="px-4 py-2 rounded-xl border border-purple-500/40 bg-purple-500/10 text-purple-300 text-sm font-semibold">
            {recurMut.isPending ? 'Analiza...' : 'Wykryj powtarzalne'}
          </button>
        </div>
      </div>

      {recurMsg && <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm text-purple-300">{recurMsg}</div>}

      {/* Panel alertów */}
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-3">Panel alertów</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiTile label="Krytyczne otwarte" value={stats.critical.length} color={stats.critical.length ? 'text-red-400' : 'text-white'} onClick={() => goQueue('all')} />
          <KpiTile label="Bez reakcji" value={stats.noReaction.length} color={stats.noReaction.length ? 'text-orange-400' : 'text-white'} onClick={() => goQueue('new')} />
          <KpiTile label="Bez diagnozy" value={stats.noDiagnosis.length} color={stats.noDiagnosis.length ? 'text-orange-400' : 'text-white'} onClick={() => goQueue('diagnosing')} />
          <KpiTile label="Po terminie" value={stats.overdue.length} color={stats.overdue.length ? 'text-red-400' : 'text-white'} onClick={() => goQueue('all')} />
          <KpiTile label="Powtarzalne" value={stats.recurring.length} color={stats.recurring.length ? 'text-purple-400' : 'text-white'} onClick={() => goQueue('all')} />
          <KpiTile label="Nieskuteczne" value={stats.ineffective.length} color={stats.ineffective.length ? 'text-amber-400' : 'text-white'} onClick={() => goQueue('all')} />
          <KpiTile label="Do zatwierdzenia" value={stats.awaitingApproval.length} color={stats.awaitingApproval.length ? 'text-blue-400' : 'text-white'} onClick={() => goQueue('awaiting_approval')} />
          <KpiTile label="Do A1TEC" value={stats.a1tec.length} color={stats.a1tec.length ? 'text-cyan-400' : 'text-white'} onClick={() => goQueue('escalated_a1tec')} />
        </div>
      </div>

      {/* KPI ogólne */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Realizacja AM (7 dni)" value={`${stats.amPct}%`} color={stats.amPct >= 80 ? 'text-green-400' : 'text-amber-400'} />
        <KpiTile label="Otwarte zgłoszenia" value={stats.open} onClick={() => goQueue()} />
        <KpiTile label="Czas postoju (min)" value={stats.downtimeTotal} />
        <KpiTile label="Sztuki NOK" value={stats.nokTotal} />
        <KpiTile label="Postój IS-3 (min)" value={stats.downtimeIS3} />
        <KpiTile label="Postój IS-4 (min)" value={stats.downtimeIS4} />
        <KpiTile label="MTTR (min)" value={stats.mttr} />
        <KpiTile label="MTBF (dni)" value={stats.mtbf || '—'} />
        <KpiTile label="Śr. czas reakcji (min)" value={stats.reaction} />
      </div>

      {/* TOP stacje */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">TOP 5 stacji — liczba awarii</div>
          {stats.topByCount.length === 0 ? <p className="text-navy-500 text-sm">Brak danych.</p> : stats.topByCount.map((s, idx) => (
            <div key={idx} className="flex items-center justify-between py-2 border-b border-navy-700 last:border-0">
              <span className="text-white font-medium">{s.num}</span>
              <span className="text-navy-300">{s.count} awarii</span>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">TOP 5 stacji — czas postoju</div>
          {stats.topByDowntime.filter(s => s.downtime > 0).length === 0 ? <p className="text-navy-500 text-sm">Brak danych.</p> : stats.topByDowntime.map((s, idx) => (
            <div key={idx} className="flex items-center justify-between py-2 border-b border-navy-700 last:border-0">
              <span className="text-white font-medium">{s.num}</span>
              <span className="text-navy-300">{s.downtime} min</span>
            </div>
          ))}
        </div>
      </div>

      {/* Lista do zatwierdzenia */}
      {stats.awaitingApproval.length > 0 && (
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-3">Oczekują na Twoje zatwierdzenie</div>
          {stats.awaitingApproval.map(i => (
            <button key={i.id} onClick={() => navigate(`/tpm/issue/${i.id}`)} className="w-full flex items-center justify-between py-2 border-b border-navy-700 last:border-0 text-left hover:bg-navy-700/30 px-2 -mx-2 rounded">
              <span className="font-mono text-sm text-white">{i.issue_number}</span>
              <span className="text-xs text-navy-400">{ISSUE_STATUS_LABELS[i.status]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
