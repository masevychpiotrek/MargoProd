import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { SaFailureReport, SaQualityIssue, SaFailureStatus, SaQualityIssueStatus } from '@/types/database'

const FAILURE_STATUS_LABELS: Record<SaFailureStatus, string> = {
  new: 'Nowe', acknowledged: 'Przyjęte', in_progress: 'W realizacji',
  waiting_for_part: 'Oczekuje na część', resolved: 'Rozwiązane', closed: 'Zamknięte'
}
const QUALITY_STATUS_LABELS: Record<SaQualityIssueStatus, string> = {
  open: 'Otwarte', under_review: 'W analizie', resolved: 'Rozwiązane', closed: 'Zamknięte'
}
const PRIORITY_LABELS: Record<string, string> = { low: 'Niski', medium: 'Średni', high: 'Wysoki', critical: 'Krytyczny' }

const STATUS_COLOR = (s: string) =>
  ['resolved', 'closed'].includes(s) ? 'bg-green-500/15 text-green-300'
    : ['new', 'open'].includes(s) ? 'bg-blue-500/15 text-blue-300'
    : 'bg-amber-500/15 text-amber-300'

async function fetchFailures(operatorId: string) {
  const { data } = await supabase
    .from('sa_failure_reports')
    .select('*, machine:sa_machines(*)')
    .eq('reporter_id', operatorId)
    .order('created_at', { ascending: false })
  return data as SaFailureReport[] ?? []
}
async function fetchQuality(operatorId: string) {
  const { data } = await supabase
    .from('sa_quality_issues')
    .select('*, machine:sa_machines(*), assortment:sa_assortments(*)')
    .eq('reporter_id', operatorId)
    .order('created_at', { ascending: false })
  return data as SaQualityIssue[] ?? []
}

export default function SyringeMyReports() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'failures' | 'quality'>('failures')

  const { data: failures = [], isLoading: lf } = useQuery({
    queryKey: ['sa_my_failures', profile?.id], queryFn: () => fetchFailures(profile!.id), enabled: !!profile?.id, refetchInterval: 30000
  })
  const { data: quality = [], isLoading: lq } = useQuery({
    queryKey: ['sa_my_quality', profile?.id], queryFn: () => fetchQuality(profile!.id), enabled: !!profile?.id, refetchInterval: 30000
  })

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/syringe')} className="text-navy-400 hover:text-white">←</button>
        <h1 className="text-xl font-bold text-white">Moje zgłoszenia</h1>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('failures')} className={`rounded-lg px-4 py-2 text-sm font-bold border ${tab === 'failures' ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-navy-400'}`}>
          Awarie ({failures.length})
        </button>
        <button onClick={() => setTab('quality')} className={`rounded-lg px-4 py-2 text-sm font-bold border ${tab === 'quality' ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-navy-400'}`}>
          Problemy jakości ({quality.length})
        </button>
      </div>

      {tab === 'failures' && (
        lf ? <div className="text-navy-400">Ładowanie...</div> : failures.length === 0 ? (
          <div className="text-center py-12 text-navy-500">Brak zgłoszeń awarii.</div>
        ) : (
          <div className="space-y-2">
            {failures.map(f => (
              <div key={f.id} className="rounded-xl border border-navy-700 bg-navy-800 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium text-white">{(f.machine as { name?: string })?.name ?? 'Automat'}</div>
                    <div className="text-xs text-navy-400 mt-0.5">
                      {new Date(f.created_at).toLocaleString('pl', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {f.component_name && ` · ${f.component_name}`}
                      {f.error_code && ` · kod: ${f.error_code}`}
                    </div>
                    <div className="text-sm text-navy-300 mt-1">{f.symptoms}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${f.priority === 'critical' ? 'bg-red-500/15 text-red-300' : 'bg-navy-700 text-navy-300'}`}>{PRIORITY_LABELS[f.priority]}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR(f.status)}`}>{FAILURE_STATUS_LABELS[f.status]}</span>
                  </div>
                </div>
                {f.resolution_notes && (
                  <div className="mt-2 rounded-lg bg-navy-900 p-2 text-xs text-navy-300">
                    <span className="text-navy-500">Rozwiązanie: </span>{f.resolution_notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'quality' && (
        lq ? <div className="text-navy-400">Ładowanie...</div> : quality.length === 0 ? (
          <div className="text-center py-12 text-navy-500">Brak zgłoszeń jakościowych.</div>
        ) : (
          <div className="space-y-2">
            {quality.map(q => (
              <div key={q.id} className="rounded-xl border border-navy-700 bg-navy-800 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium text-white">{(q.machine as { name?: string })?.name ?? 'Automat'} · {(q.assortment as { name?: string })?.name ?? ''}</div>
                    <div className="text-xs text-navy-400 mt-0.5">
                      {new Date(q.created_at).toLocaleString('pl', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {q.batch_number && ` · partia: ${q.batch_number}`}
                      {q.affected_qty != null && ` · ${q.affected_qty} szt`}
                    </div>
                    <div className="text-sm text-navy-300 mt-1">{q.description}</div>
                    {q.product_separated && <div className="text-xs text-yellow-400 mt-1">Wyrób odseparowany{q.separation_location ? ` · ${q.separation_location}` : ''}</div>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLOR(q.status)}`}>{QUALITY_STATUS_LABELS[q.status]}</span>
                </div>
                {q.resolution_notes && (
                  <div className="mt-2 rounded-lg bg-navy-900 p-2 text-xs text-navy-300">
                    <span className="text-navy-500">Rozwiązanie: </span>{q.resolution_notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
