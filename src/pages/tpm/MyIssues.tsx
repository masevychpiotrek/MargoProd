import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { ISSUE_STATUS_LABELS, PRIORITY_LABELS } from '@/types/tpm'
import type { TpmIssue } from '@/types/tpm'

async function fetchMyIssues(operatorId: string) {
  const { data } = await supabase
    .from('tpm_issues')
    .select('*, machine:tpm_machines(*), station:tpm_stations(*)')
    .eq('reporter_id', operatorId)
    .order('created_at', { ascending: false })
  return data as TpmIssue[] ?? []
}

const PRIORITY_COLOR: Record<string, string> = {
  low: 'bg-navy-700 text-navy-300', normal: 'bg-blue-500/15 text-blue-300',
  high: 'bg-orange-500/15 text-orange-300', critical: 'bg-red-500/15 text-red-300'
}

export default function TpmMyIssues() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['tpm_my_issues_all', profile?.id],
    queryFn: () => fetchMyIssues(profile!.id),
    enabled: !!profile?.id
  })

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/tpm')} className="text-navy-400 hover:text-white">←</button>
        <h1 className="text-xl font-bold text-white">Moje zgłoszenia</h1>
      </div>

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : issues.length === 0 ? (
        <div className="text-center py-12 text-navy-500">Brak zgłoszeń.</div>
      ) : (
        <div className="space-y-2">
          {issues.map(i => (
            <button key={i.id} onClick={() => navigate(`/tpm/issue/${i.id}`)}
              className="w-full rounded-xl border border-navy-700 bg-navy-800 p-4 text-left hover:border-navy-600 transition-all">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-mono text-sm text-white">{i.issue_number}</div>
                  <div className="text-xs text-navy-400 mt-0.5">{i.machine?.code} · {i.station?.station_number} · {new Date(i.created_at).toLocaleDateString('pl')}</div>
                  <div className="text-sm text-navy-300 mt-1">{i.symptom.slice(0, 70)}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLOR[i.priority]}`}>{PRIORITY_LABELS[i.priority]}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-navy-700 text-navy-300">{ISSUE_STATUS_LABELS[i.status]}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
