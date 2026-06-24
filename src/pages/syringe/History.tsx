import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { SaSession } from '@/types/database'

async function fetchSessions(operatorId: string, isManager: boolean, limit = 20) {
  let q = supabase
    .from('sa_sessions')
    .select('*, machine:sa_machines(*), operator:profiles!sa_sessions_operator_id_fkey(id, full_name), assortment:sa_assortments(*)')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (!isManager) {
    q = q.eq('operator_id', operatorId)
  }
  const { data } = await q
  return data as SaSession[] ?? []
}

export default function SyringeHistory() {
  const { profile } = useAuthStore()
  const [selected, setSelected] = useState<string | null>(null)
  const isManager = profile?.role === 'manager' || profile?.role === 'admin'

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['sa_history', profile?.id, isManager],
    queryFn: () => fetchSessions(profile!.id, isManager),
    enabled: !!profile?.id
  })

  if (isLoading) return <div className="text-navy-400 text-center py-16">Ładowanie...</div>

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">Historia zmian</h1>

      {sessions.length === 0 && (
        <div className="text-center py-12 text-navy-500">Brak zapisanych zmian.</div>
      )}

      {sessions.map(s => {
        const isOpen = selected === s.id
        const planPct = s.plan_qty && s.plan_qty > 0 && s.total_good !== null
          ? Math.round(s.total_good / s.plan_qty * 100)
          : null
        const ended = !!s.ended_at

        return (
          <div key={s.id} className="rounded-2xl border border-navy-700 bg-navy-800 overflow-hidden">
            <button
              onClick={() => setSelected(isOpen ? null : s.id)}
              className="w-full p-5 text-left"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{s.machine?.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-navy-700 text-navy-300">Zmiana {s.shift_type}</span>
                    {!ended && <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300">Aktywna</span>}
                  </div>
                  <div className="text-sm text-navy-400 mt-1">
                    {new Date(s.started_at).toLocaleDateString('pl', { day: '2-digit', month: '2-digit', year: 'numeric' })} ·
                    {new Date(s.started_at).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
                    {s.ended_at && ` – ${new Date(s.ended_at).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}`}
                    {isManager && <span className="ml-2 text-navy-500">· {(s.operator as any)?.full_name}</span>}
                  </div>
                  <div className="text-xs text-navy-500 mt-0.5">{s.assortment?.name}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-white font-bold">{(s.total_good ?? 0).toLocaleString('pl')} szt</div>
                  {planPct !== null && (
                    <div className={`text-xs ${planPct >= 100 ? 'text-green-400' : planPct >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {planPct}% planu
                    </div>
                  )}
                </div>
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-navy-700 p-5 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  {[
                    { label: 'Dobre', value: (s.total_good ?? 0).toLocaleString('pl'), color: 'text-green-400' },
                    { label: 'Braki', value: (s.total_reject ?? 0).toLocaleString('pl'), color: 'text-red-400' },
                    { label: 'Plan', value: s.plan_qty ? s.plan_qty.toLocaleString('pl') : '—', color: 'text-white' },
                    { label: '% planu', value: planPct !== null ? `${planPct}%` : '—', color: planPct !== null ? (planPct >= 100 ? 'text-green-400' : 'text-amber-400') : 'text-navy-400' },
                    { label: 'Przestoje', value: s.total_downtime_min ? `${s.total_downtime_min} min` : '—', color: 'text-white' },
                    { label: 'Śr. wydajność', value: s.avg_per_hour ? `${Math.round(s.avg_per_hour)} szt/h` : '—', color: 'text-white' },
                    { label: 'Brak tech.', value: (s.total_tech_reject ?? 0).toLocaleString('pl'), color: 'text-white' },
                    { label: 'Brak jakość', value: (s.total_qual_reject ?? 0).toLocaleString('pl'), color: 'text-white' },
                  ].map(item => (
                    <div key={item.label} className="rounded-lg bg-navy-900 p-3">
                      <div className="text-xs text-navy-500">{item.label}</div>
                      <div className={`font-bold ${item.color}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
                {s.summary_notes && (
                  <div className="rounded-lg bg-navy-900 p-3 text-sm text-navy-300">
                    <div className="text-xs text-navy-500 mb-1">Notatki</div>
                    {s.summary_notes}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
