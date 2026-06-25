import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ISSUE_STATUS_LABELS, PRIORITY_LABELS, ISSUE_CATEGORY_LABELS } from '@/types/tpm'
import type { TpmIssue, TpmMachine, TpmStation } from '@/types/tpm'

const OPEN_STATUSES = ['new','awaiting_ack','accepted','diagnosing','immediate_done','repairing','awaiting_part','awaiting_manager','observation','testing','escalated_a1tec','resolved','awaiting_approval','reopened']

async function fetchIssues(filters: { status: string; priority: string; machineId: string }) {
  let q = supabase
    .from('tpm_issues')
    .select('*, machine:tpm_machines(*), station:tpm_stations(*), reporter:profiles!tpm_issues_reporter_id_fkey(id, full_name), assignee:profiles!tpm_issues_assigned_to_fkey(id, full_name)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (filters.status === 'open') q = q.in('status', OPEN_STATUSES)
  else if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status)
  if (filters.priority) q = q.eq('priority', filters.priority)
  if (filters.machineId) q = q.eq('machine_id', filters.machineId)

  const { data } = await q
  return data as TpmIssue[] ?? []
}

const PRIORITY_COLOR: Record<string, string> = {
  low: 'bg-navy-700 text-navy-300', normal: 'bg-blue-500/15 text-blue-300',
  high: 'bg-orange-500/15 text-orange-300', critical: 'bg-red-500/15 text-red-300'
}

export default function TpmSpecialistQueue() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [status, setStatus] = useState('open')
  const [priority, setPriority] = useState('')
  const [machineId, setMachineId] = useState('')
  const [search, setSearch] = useState('')

  const { data: machines = [] } = useQuery({
    queryKey: ['tpm_machines'],
    queryFn: async () => { const { data } = await supabase.from('tpm_machines').select('*').order('sort_order'); return data as TpmMachine[] ?? [] }
  })
  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['tpm_queue', status, priority, machineId],
    queryFn: () => fetchIssues({ status, priority, machineId }),
    refetchInterval: 30000
  })

  useEffect(() => {
    const ch = supabase.channel('tpm_queue_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tpm_issues' },
        () => qc.invalidateQueries({ queryKey: ['tpm_queue'] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [qc])

  const filtered = search
    ? issues.filter(i =>
        (i.issue_number ?? '').toLowerCase().includes(search.toLowerCase()) ||
        i.symptom.toLowerCase().includes(search.toLowerCase()) ||
        ((i.station as TpmStation)?.station_number ?? '').toLowerCase().includes(search.toLowerCase()))
    : issues

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Zgłoszenia techniczne</h1>
        <p className="text-navy-400 text-sm">{filtered.length} zgłoszeń</p>
      </div>

      {/* Filtry */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-4 space-y-3">
        <input value={search} onChange={e => setSearch(e.target.value)} className="input" placeholder="Szukaj: numer, objaw, stacja..." />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select value={status} onChange={e => setStatus(e.target.value)} className="input">
            <option value="open">Otwarte</option>
            <option value="all">Wszystkie</option>
            {Object.entries(ISSUE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={priority} onChange={e => setPriority(e.target.value)} className="input">
            <option value="">Priorytet: wszystkie</option>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={machineId} onChange={e => setMachineId(e.target.value)} className="input">
            <option value="">Automat: wszystkie</option>
            {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : (
        <div className="space-y-2">
          {filtered.map(i => (
            <button key={i.id} onClick={() => navigate(`/tpm/issue/${i.id}`)}
              className={`w-full rounded-xl border p-4 text-left transition-all hover:border-navy-500 ${i.priority === 'critical' ? 'border-red-500/40 bg-red-500/5' : 'border-navy-700 bg-navy-800'}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-white">{i.issue_number}</span>
                    {i.is_recurring && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">powtarzalny</span>}
                    {i.a1tec_escalated && <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300">A1TEC</span>}
                  </div>
                  <div className="text-xs text-navy-400 mt-0.5">
                    {i.machine?.code} · {i.station?.station_number} · {ISSUE_CATEGORY_LABELS[i.category] ?? i.category}
                    {i.assignee && ` · ${(i.assignee as { full_name: string }).full_name}`}
                  </div>
                  <div className="text-sm text-navy-300 mt-1 truncate">{i.symptom}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLOR[i.priority]}`}>{PRIORITY_LABELS[i.priority]}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-navy-700 text-navy-300">{ISSUE_STATUS_LABELS[i.status]}</span>
                </div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <div className="text-center py-12 text-navy-500">Brak zgłoszeń spełniających kryteria.</div>}
        </div>
      )}
    </div>
  )
}
