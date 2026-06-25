import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { TpmIssue, AmChecklist, TpmMachine } from '@/types/tpm'

const OPEN_STATUSES = ['new','awaiting_ack','accepted','diagnosing','immediate_done','repairing','awaiting_part','awaiting_manager','observation','testing','escalated_a1tec','resolved','awaiting_approval','reopened']

async function fetchAll() {
  const [issuesRes, checklistsRes, machinesRes] = await Promise.all([
    supabase.from('tpm_issues').select('*, machine:tpm_machines(*), station:tpm_stations(*)').order('created_at', { ascending: false }).limit(1000),
    supabase.from('tpm_am_checklists').select('*').gte('checklist_date', new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0]),
    supabase.from('tpm_machines').select('*').eq('is_active', true)
  ])
  return {
    issues: (issuesRes.data ?? []) as TpmIssue[],
    checklists: (checklistsRes.data ?? []) as AmChecklist[],
    machines: (machinesRes.data ?? []) as TpmMachine[]
  }
}

function Tile({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-800 p-4">
      <div className="text-xs text-navy-400 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ?? 'text-white'}`}>{value}</div>
    </div>
  )
}

export default function TpmBoardView() {
  const { data, isLoading } = useQuery({ queryKey: ['tpm_board'], queryFn: fetchAll, refetchInterval: 120000 })

  const s = useMemo(() => {
    if (!data) return null
    const { issues, checklists, machines } = data
    const open = issues.filter(i => OPEN_STATUSES.includes(i.status))
    const downtimeTotal = issues.reduce((a, i) => a + (i.downtime_min ?? 0), 0)
    const nokTotal = issues.reduce((a, i) => a + (i.nok_count ?? 0), 0)
    const recurring = issues.filter(i => i.is_recurring).length
    const a1tec = issues.filter(i => i.a1tec_escalated).length
    const expectedAm = machines.length * 3 * 30
    const doneAm = checklists.filter(c => c.status !== 'in_progress').length
    const amPct = expectedAm > 0 ? Math.round(doneAm / expectedAm * 100) : 0

    // Pareto stacji
    const byStation: Record<string, { num: string; count: number; downtime: number }> = {}
    for (const i of issues) {
      const num = (i.station as { station_number?: string })?.station_number ?? '?'
      if (!byStation[num]) byStation[num] = { num, count: 0, downtime: 0 }
      byStation[num].count++
      byStation[num].downtime += i.downtime_min ?? 0
    }
    const pareto = Object.values(byStation).sort((a, b) => b.count - a.count)
    const maxCount = Math.max(1, ...pareto.map(p => p.count))

    const repaired = issues.filter(i => i.intervention_start && i.intervention_end)
    const mttr = repaired.length > 0
      ? Math.round(repaired.reduce((a, i) => a + (new Date(i.intervention_end!).getTime() - new Date(i.intervention_start!).getTime()) / 60000, 0) / repaired.length)
      : 0

    return { total: issues.length, open: open.length, downtimeTotal, nokTotal, recurring, a1tec, amPct, pareto, maxCount, mttr }
  }, [data])

  if (isLoading || !s) return <div className="text-navy-400 text-center py-16">Ładowanie...</div>

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">TPM/PM — Podsumowanie (Zarząd)</h1>
        <p className="text-navy-400 text-sm">Dane zbiorcze IS PRO · ostatnie 30 dni</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Realizacja AM (30 dni)" value={`${s.amPct}%`} color={s.amPct >= 80 ? 'text-green-400' : 'text-amber-400'} />
        <Tile label="Otwarte zgłoszenia" value={s.open} />
        <Tile label="Liczba awarii" value={s.total} />
        <Tile label="Czas postoju (min)" value={s.downtimeTotal} />
        <Tile label="Sztuki NOK" value={s.nokTotal} />
        <Tile label="Problemy powtarzalne" value={s.recurring} color={s.recurring ? 'text-purple-400' : 'text-white'} />
        <Tile label="Przekazane do A1TEC" value={s.a1tec} color={s.a1tec ? 'text-cyan-400' : 'text-white'} />
        <Tile label="MTTR (min)" value={s.mttr} />
      </div>

      {/* Pareto stacji */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-4">Pareto — awarie wg stacji</div>
        {s.pareto.length === 0 ? <p className="text-navy-500 text-sm">Brak danych.</p> : (
          <div className="space-y-2">
            {s.pareto.map(p => (
              <div key={p.num} className="flex items-center gap-3">
                <span className="w-16 text-sm text-white font-medium shrink-0">{p.num}</span>
                <div className="flex-1 h-6 bg-navy-900 rounded overflow-hidden">
                  <div className="h-full bg-brand/60 rounded flex items-center justify-end px-2" style={{ width: `${p.count / s.maxCount * 100}%` }}>
                    <span className="text-xs text-white font-bold">{p.count}</span>
                  </div>
                </div>
                <span className="w-20 text-right text-xs text-navy-400 shrink-0">{p.downtime} min</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-navy-500">
        Dane wyłącznie do podglądu. Edycja danych technicznych dostępna dla Specialist i Kierownika.
      </p>
    </div>
  )
}
