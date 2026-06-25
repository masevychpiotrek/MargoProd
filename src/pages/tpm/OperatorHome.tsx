import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { currentShift } from '@/lib/tpm'
import type { TpmMachine, AmChecklist, TpmIssue } from '@/types/tpm'
import { ISSUE_STATUS_LABELS } from '@/types/tpm'

async function fetchMachines() {
  const { data } = await supabase.from('tpm_machines').select('*').eq('is_active', true).order('sort_order')
  return data as TpmMachine[] ?? []
}

async function fetchTodayChecklists(operatorId: string) {
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('tpm_am_checklists')
    .select('*, machine:tpm_machines(*)')
    .eq('operator_id', operatorId)
    .eq('checklist_date', today)
    .order('created_at', { ascending: false })
  return data as AmChecklist[] ?? []
}

async function fetchMyIssues(operatorId: string) {
  const { data } = await supabase
    .from('tpm_issues')
    .select('*, machine:tpm_machines(*), station:tpm_stations(*)')
    .eq('reporter_id', operatorId)
    .order('created_at', { ascending: false })
    .limit(5)
  return data as TpmIssue[] ?? []
}

export default function TpmOperatorHome() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const shift = currentShift()

  const { data: machines = [] } = useQuery({ queryKey: ['tpm_machines'], queryFn: fetchMachines })
  const { data: todayChecklists = [] } = useQuery({
    queryKey: ['tpm_today_checklists', profile?.id],
    queryFn: () => fetchTodayChecklists(profile!.id),
    enabled: !!profile?.id
  })
  const { data: myIssues = [] } = useQuery({
    queryKey: ['tpm_my_issues', profile?.id],
    queryFn: () => fetchMyIssues(profile!.id),
    enabled: !!profile?.id
  })

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">TPM / PM — IS PRO</h1>
        <p className="text-navy-400 text-sm mt-1">Obsługa autonomiczna AM · Zmiana {shift} · {profile?.full_name}</p>
      </div>

      {/* Główne akcje */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => navigate('/tpm/checklist')}
          className="rounded-2xl border-2 border-brand bg-brand/10 p-6 text-left hover:bg-brand/20 transition-all"
        >
          <div className="text-3xl mb-2">📋</div>
          <div className="font-bold text-white text-lg">Wykonaj checklistę AM</div>
          <div className="text-sm text-navy-400 mt-1">Kontrola autonomiczna stacji</div>
        </button>
        <button
          onClick={() => navigate('/tpm/report')}
          className="rounded-2xl border-2 border-red-500/50 bg-red-500/10 p-6 text-left hover:bg-red-500/20 transition-all"
        >
          <div className="text-3xl mb-2">⚠️</div>
          <div className="font-bold text-white text-lg">Zgłoś awarię</div>
          <div className="text-sm text-navy-400 mt-1">Rejestracja problemu technicznego</div>
        </button>
      </div>

      {/* Checklisty dzisiaj */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">Twoje checklisty dzisiaj</div>
        {machines.map(m => {
          const done = todayChecklists.find(c => c.machine_id === m.id && c.status !== 'in_progress')
          const inProgress = todayChecklists.find(c => c.machine_id === m.id && c.status === 'in_progress')
          return (
            <div key={m.id} className="flex items-center justify-between py-2 border-b border-navy-700 last:border-0">
              <div className="font-medium text-white">{m.name} <span className="text-xs text-navy-500 font-mono">{m.code}</span></div>
              {done ? (
                <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/15 text-green-300">✓ Wykonana ({done.nok_count} NOK)</span>
              ) : inProgress ? (
                <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300">Rozpoczęta</span>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded-full bg-navy-700 text-navy-400">Brak</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Moje zgłoszenia */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Moje ostatnie zgłoszenia</div>
          <button onClick={() => navigate('/tpm/my-issues')} className="text-xs text-brand hover:underline">Wszystkie →</button>
        </div>
        {myIssues.length === 0 ? (
          <p className="text-navy-500 text-sm">Brak zgłoszeń.</p>
        ) : myIssues.map(i => (
          <button
            key={i.id}
            onClick={() => navigate(`/tpm/issue/${i.id}`)}
            className="w-full flex items-center justify-between py-2.5 border-b border-navy-700 last:border-0 text-left hover:bg-navy-700/30 px-2 -mx-2 rounded"
          >
            <div>
              <div className="font-mono text-sm text-white">{i.issue_number}</div>
              <div className="text-xs text-navy-400">{i.station?.station_number} · {i.symptom.slice(0, 40)}</div>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-navy-700 text-navy-300 shrink-0">{ISSUE_STATUS_LABELS[i.status]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
