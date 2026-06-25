import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { A1TEC_STATUS_LABELS, A1TEC_REQUIREMENTS } from '@/types/tpm'
import type { TpmA1tecContact, A1tecStatus, TpmIssue } from '@/types/tpm'

async function fetchContacts() {
  const { data } = await supabase
    .from('tpm_a1tec_contacts')
    .select('*, issue:tpm_issues(id, issue_number, station_id, machine_id)')
    .order('created_at', { ascending: false })
  return data as TpmA1tecContact[] ?? []
}

const STATUS_COLOR: Record<string, string> = {
  preparation: 'bg-navy-700 text-navy-300', sent: 'bg-blue-500/15 text-blue-300',
  awaiting_response: 'bg-amber-500/15 text-amber-300', response_received: 'bg-green-500/15 text-green-300',
  awaiting_action: 'bg-amber-500/15 text-amber-300', remote_support: 'bg-cyan-500/15 text-cyan-300',
  visit_planned: 'bg-purple-500/15 text-purple-300', resolved: 'bg-green-500/15 text-green-300',
  closed: 'bg-navy-700 text-navy-400'
}

export default function TpmA1tecRegistry() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<Partial<TpmA1tecContact>>({})
  const [msg, setMsg] = useState('')

  const { data: contacts = [], isLoading } = useQuery({ queryKey: ['tpm_a1tec'], queryFn: fetchContacts, refetchInterval: 60000 })
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const saveMut = useMutation({
    mutationFn: async (id: string) => {
      if (Object.keys(edit).length === 0) return
      const patch = { ...edit }
      if (patch.status === 'closed' && !patch.closed_at) patch.closed_at = new Date().toISOString()
      await supabase.from('tpm_a1tec_contacts').update(patch).eq('id', id)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpm_a1tec'] }); setEdit({}); flash('Zapisano') }
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Rejestr kontaktów z A1TEC</h1>
          <p className="text-navy-400 text-sm">{contacts.length} zgłoszeń do producenta</p>
        </div>
        <button onClick={() => navigate('/tpm/manager')} className="btn-secondary px-4 py-2">← Nadzór</button>
      </div>

      {msg && <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-400">{msg}</div>}

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : contacts.length === 0 ? (
        <div className="text-center py-12 text-navy-500">
          Brak zgłoszeń do A1TEC. Wygeneruj pakiet dowodowy z karty zgłoszenia.
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map(c => {
            const isOpen = open === c.id
            return (
              <div key={c.id} className="rounded-xl border border-navy-700 bg-navy-800 overflow-hidden">
                <button onClick={() => { setOpen(isOpen ? null : c.id); setEdit({}) }} className="w-full p-4 text-left">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-mono text-sm text-white">{c.internal_number ?? '—'}{c.a1tec_number ? ` · A1TEC: ${c.a1tec_number}` : ''}</div>
                      <div className="text-xs text-navy-400 mt-0.5">
                        {(c.issue as TpmIssue)?.issue_number ?? ''} · {c.recipient ?? '—'} · {new Date(c.created_at).toLocaleDateString('pl')}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[c.status]}`}>{A1TEC_STATUS_LABELS[c.status]}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-navy-700 p-4 space-y-3">
                    {c.problem_desc && <div><div className="text-xs text-navy-500">Problem</div><div className="text-sm text-white">{c.problem_desc}</div></div>}
                    {c.requirements.length > 0 && (
                      <div>
                        <div className="text-xs text-navy-500 mb-1">Wymagania</div>
                        <div className="flex flex-wrap gap-1">
                          {c.requirements.map(r => (
                            <span key={r} className="text-xs px-2 py-0.5 rounded-full bg-navy-700 text-navy-300">
                              {r === 'other' ? (c.requirement_other ?? 'Inne') : A1TEC_REQUIREMENTS.find(x => x.code === r)?.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="label">Status</label>
                        <select defaultValue={c.status} onChange={e => setEdit({ ...edit, status: e.target.value as A1tecStatus })} className="input">
                          {Object.entries(A1TEC_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </div>
                      <div><label className="label">Numer zgłoszenia A1TEC</label><input defaultValue={c.a1tec_number ?? ''} onChange={e => setEdit({ ...edit, a1tec_number: e.target.value })} className="input" /></div>
                      <div><label className="label">Data wysłania</label><input type="date" defaultValue={c.sent_date ?? ''} onChange={e => setEdit({ ...edit, sent_date: e.target.value })} className="input" /></div>
                      <div><label className="label">Osoba po stronie A1TEC</label><input defaultValue={c.a1tec_person ?? ''} onChange={e => setEdit({ ...edit, a1tec_person: e.target.value })} className="input" /></div>
                      <div><label className="label">Data odpowiedzi</label><input type="date" defaultValue={c.response_date ?? ''} onChange={e => setEdit({ ...edit, response_date: e.target.value })} className="input" /></div>
                      <div><label className="label">Planowany termin działania</label><input type="date" defaultValue={c.planned_date ?? ''} onChange={e => setEdit({ ...edit, planned_date: e.target.value })} className="input" /></div>
                    </div>
                    <div><label className="label">Treść odpowiedzi A1TEC</label><textarea defaultValue={c.response_text ?? ''} onChange={e => setEdit({ ...edit, response_text: e.target.value })} rows={2} className="input resize-none" /></div>
                    <div><label className="label">Planowane działanie</label><textarea defaultValue={c.planned_action ?? ''} onChange={e => setEdit({ ...edit, planned_action: e.target.value })} rows={2} className="input resize-none" /></div>

                    <div className="flex gap-2">
                      <button onClick={() => saveMut.mutate(c.id)} disabled={Object.keys(edit).length === 0} className="btn-primary px-5 py-2 disabled:opacity-40">💾 Zapisz</button>
                      {(c.issue as TpmIssue)?.id && (
                        <button onClick={() => navigate(`/tpm/issue/${(c.issue as TpmIssue).id}`)} className="btn-secondary px-4 py-2">Otwórz zgłoszenie</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
