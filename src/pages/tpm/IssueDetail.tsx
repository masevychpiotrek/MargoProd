import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { logIssueHistory, uploadTpmMedia, computeDowntime, notifyUsers, getUserIdsByRole } from '@/lib/tpm'
import {
  ISSUE_STATUS_LABELS, PRIORITY_LABELS, ISSUE_CATEGORY_LABELS
} from '@/types/tpm'
import type { TpmIssue, TpmIssueHistory, TpmMedia, IssueStatus, IssuePriority, MediaCategory } from '@/types/tpm'

async function fetchIssue(id: string) {
  const { data } = await supabase
    .from('tpm_issues')
    .select('*, machine:tpm_machines(*), station:tpm_stations(*), reporter:profiles!tpm_issues_reporter_id_fkey(id, full_name), assignee:profiles!tpm_issues_assigned_to_fkey(id, full_name)')
    .eq('id', id)
    .single()
  return data as TpmIssue | null
}
async function fetchHistory(id: string) {
  const { data } = await supabase
    .from('tpm_issue_history')
    .select('*, user:profiles(id, full_name)')
    .eq('issue_id', id)
    .order('created_at', { ascending: false })
  return data as TpmIssueHistory[] ?? []
}
async function fetchMedia(id: string) {
  const { data } = await supabase.from('tpm_media').select('*').eq('issue_id', id).is('deleted_at', null).order('created_at')
  return data as TpmMedia[] ?? []
}
async function fetchSpecialists() {
  const { data } = await supabase.from('profiles').select('id, full_name').eq('role', 'specialist').eq('is_active', true).is('deleted_at', null)
  return data as { id: string; full_name: string }[] ?? []
}

const MEDIA_CATEGORIES: { value: MediaCategory; label: string }[] = [
  { value: 'base_state', label: 'Stan bazowy' }, { value: 'before', label: 'Przed interwencją' },
  { value: 'failure', label: 'Awaria' }, { value: 'during', label: 'Podczas interwencji' },
  { value: 'after', label: 'Po interwencji' }, { value: 'setting', label: 'Ustawienie' },
  { value: 'param_screen', label: 'Ekran parametrów' }, { value: 'damaged_part', label: 'Część uszkodzona' },
  { value: 'test', label: 'Test' }, { value: 'other', label: 'Inne' }
]

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('pl', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
}

export default function TpmIssueDetail() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const role = profile?.role
  const canTechnical = role === 'specialist' || role === 'manager' || role === 'admin'
  const canApprove = role === 'manager' || role === 'admin'

  const { data: issue, isLoading } = useQuery({ queryKey: ['tpm_issue', id], queryFn: () => fetchIssue(id!), enabled: !!id })
  const { data: history = [] } = useQuery({ queryKey: ['tpm_issue_history', id], queryFn: () => fetchHistory(id!), enabled: !!id })
  const { data: media = [] } = useQuery({ queryKey: ['tpm_issue_media', id], queryFn: () => fetchMedia(id!), enabled: !!id })
  const { data: specialists = [] } = useQuery({ queryKey: ['tpm_specialists'], queryFn: fetchSpecialists, enabled: canApprove })

  // techniczny formularz
  const [form, setForm] = useState<Partial<TpmIssue>>({})
  const [actionComment, setActionComment] = useState('')
  const [newMediaFile, setNewMediaFile] = useState<File | null>(null)
  const [newMediaCat, setNewMediaCat] = useState<MediaCategory>('during')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (issue) setForm({})
  }, [issue?.id])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }
  const val = <K extends keyof TpmIssue>(k: K): TpmIssue[K] => (form[k] !== undefined ? form[k]! : issue![k])
  const setF = <K extends keyof TpmIssue>(k: K, v: TpmIssue[K]) => setForm(p => ({ ...p, [k]: v }))

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tpm_issue', id] })
    qc.invalidateQueries({ queryKey: ['tpm_issue_history', id] })
    qc.invalidateQueries({ queryKey: ['tpm_queue'] })
  }

  const saveTechMut = useMutation({
    mutationFn: async () => {
      if (!issue || !profile) return
      if (Object.keys(form).length === 0) return
      const { error } = await supabase.from('tpm_issues').update(form).eq('id', issue.id)
      if (error) throw error
      await logIssueHistory({ issueId: issue.id, userId: profile.id, action: 'edited',
        comment: 'Aktualizacja danych technicznych: ' + Object.keys(form).join(', ') })
    },
    onSuccess: () => { setForm({}); refresh(); flash('Zapisano') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })

  const transition = useMutation({
    mutationFn: async (opts: { status?: IssueStatus; patch?: Partial<TpmIssue>; action: string; comment?: string }) => {
      if (!issue || !profile) return
      const patch: Partial<TpmIssue> = { ...opts.patch }
      if (opts.status) patch.status = opts.status
      const { error } = await supabase.from('tpm_issues').update(patch).eq('id', issue.id)
      if (error) throw error
      await logIssueHistory({
        issueId: issue.id, userId: profile.id, action: opts.action,
        oldStatus: issue.status, newStatus: opts.status ?? issue.status,
        comment: opts.comment ?? actionComment ?? null
      })
    },
    onSuccess: () => { setActionComment(''); refresh(); flash('Zaktualizowano status') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })

  const addMediaMut = useMutation({
    mutationFn: async () => {
      if (!newMediaFile || !issue || !profile) return
      const url = await uploadTpmMedia(newMediaFile, 'issue')
      if (!url) throw new Error('Nie udało się przesłać pliku.')
      await supabase.from('tpm_media').insert({
        machine_id: issue.machine_id, station_id: issue.station_id, issue_id: issue.id,
        url, media_type: newMediaFile.type.startsWith('video') ? 'video' : 'photo',
        category: newMediaCat, author_id: profile.id
      })
      await logIssueHistory({ issueId: issue.id, userId: profile.id, action: 'media_added', comment: `Dodano materiał: ${newMediaCat}` })
    },
    onSuccess: () => { setNewMediaFile(null); qc.invalidateQueries({ queryKey: ['tpm_issue_media', id] }); refresh(); flash('Dodano materiał') },
    onError: (e: Error) => flash('Błąd: ' + e.message)
  })

  if (isLoading || !issue) return <div className="text-navy-400 text-center py-16">Ładowanie...</div>

  const isCritical = issue.priority === 'critical'
  const downtime = issue.downtime_min ?? computeDowntime(issue.stop_time, issue.resume_time)

  // Walidacja propozycji zamknięcia
  function closeBlockers(): string[] {
    const b: string[] = []
    if (!issue!.diagnosis?.trim()) b.push('diagnoza')
    if (!issue!.root_cause_action?.trim() && !issue!.immediate_action?.trim()) b.push('działanie')
    if (!issue!.test_result?.trim()) b.push('test po naprawie')
    if (isCritical && issue!.verification_result !== 'effective') b.push('skuteczna weryfikacja działania')
    return b
  }

  const PRIORITY_COLOR: Record<string, string> = {
    low: 'bg-navy-700 text-navy-300', normal: 'bg-blue-500/15 text-blue-300',
    high: 'bg-orange-500/15 text-orange-300', critical: 'bg-red-500/15 text-red-300'
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-10">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-navy-400 hover:text-white">←</button>
        <div className="flex-1">
          <div className="font-mono text-lg text-white">{issue.issue_number}</div>
          <div className="text-xs text-navy-400">{issue.machine?.name} · {issue.station?.station_number} · {ISSUE_CATEGORY_LABELS[issue.category] ?? issue.category}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLOR[issue.priority]}`}>{PRIORITY_LABELS[issue.priority]}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-navy-700 text-navy-300">{ISSUE_STATUS_LABELS[issue.status]}</span>
        </div>
      </div>

      {msg && <div className="rounded-xl border border-brand/30 bg-brand/10 px-4 py-2 text-sm text-brand">{msg}</div>}

      {(issue.is_recurring || issue.a1tec_escalated) && (
        <div className="flex gap-2">
          {issue.is_recurring && <span className="text-xs px-2.5 py-1 rounded-full bg-purple-500/15 text-purple-300">Problem powtarzalny</span>}
          {issue.a1tec_escalated && <span className="text-xs px-2.5 py-1 rounded-full bg-cyan-500/15 text-cyan-300">Przekazane do A1TEC</span>}
        </div>
      )}

      {/* Objaw */}
      <Section title="Zgłoszenie">
        <Field label="Objaw" value={issue.symptom} />
        <Field label="Działanie Operatora" value={issue.operator_action} />
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Zgłaszający" value={(issue.reporter as { full_name?: string })?.full_name} />
          <Field label="Zmiana" value={issue.shift_type} />
          <Field label="Podzespół" value={issue.component} />
          <Field label="Automat zatrzymany" value={issue.machine_stopped ? 'Tak' : 'Nie'} />
        </div>
      </Section>

      {/* Czasy */}
      <Section title="Czasy i postój">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Field label="Wystąpienie" value={fmt(issue.problem_time)} />
          <Field label="Zgłoszenie" value={fmt(issue.report_time)} />
          <Field label="Zatrzymanie" value={fmt(issue.stop_time)} />
          <Field label="Przyjęcie" value={fmt(issue.ack_time)} />
          <Field label="Start interwencji" value={fmt(issue.intervention_start)} />
          <Field label="Koniec interwencji" value={fmt(issue.intervention_end)} />
          <Field label="Wznowienie" value={fmt(issue.resume_time)} />
          <Field label="Czas postoju" value={downtime !== null ? `${downtime} min` : '—'} />
          <Field label="Sztuki NOK" value={issue.nok_count?.toString()} />
        </div>
      </Section>

      {/* Działania techniczne — edytowalne przez Specialist/Kierownik */}
      <Section title="Działania techniczne (Specialist)">
        {canTechnical ? (
          <div className="space-y-3">
            {([
              ['diagnosis', 'Diagnoza'],
              ['immediate_action', 'Działanie doraźne'],
              ['probable_cause', 'Prawdopodobna przyczyna'],
              ['confirmed_cause', 'Potwierdzona przyczyna'],
              ['root_cause_action', 'Działanie przyczynowe'],
              ['production_impact', 'Wpływ na produkcję'],
            ] as [keyof TpmIssue, string][]).map(([k, label]) => (
              <div key={k}>
                <label className="label">{label}</label>
                <textarea value={(val(k) as string) ?? ''} onChange={e => setF(k, e.target.value as never)} rows={2}
                  className="input resize-none" />
              </div>
            ))}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div><label className="label">Czas postoju (min)</label><input type="number" value={(val('downtime_min') as number) ?? ''} onChange={e => setF('downtime_min', (parseInt(e.target.value) || null) as never)} className="input" /></div>
              <div><label className="label">Sztuki NOK</label><input type="number" value={(val('nok_count') as number) ?? ''} onChange={e => setF('nok_count', (parseInt(e.target.value) || null) as never)} className="input" /></div>
              <div><label className="label">Wymienione/użyte części</label><input value={(val('component') as string) ?? ''} onChange={e => setF('component', e.target.value as never)} className="input" placeholder="opis części" /></div>
            </div>
            {Object.keys(form).length > 0 && (
              <button onClick={() => saveTechMut.mutate()} disabled={saveTechMut.isPending} className="btn-primary px-5 py-2">💾 Zapisz dane techniczne</button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Field label="Diagnoza" value={issue.diagnosis} />
            <Field label="Działanie doraźne" value={issue.immediate_action} />
            <Field label="Działanie przyczynowe" value={issue.root_cause_action} />
          </div>
        )}
      </Section>

      {/* Test po naprawie */}
      {canTechnical && (
        <Section title="Test po naprawie">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Cykle</label><input type="number" value={(val('test_cycles') as number) ?? ''} onChange={e => setF('test_cycles', (parseInt(e.target.value) || null) as never)} className="input" /></div>
            <div><label className="label">Sztuki OK</label><input type="number" value={(val('test_ok') as number) ?? ''} onChange={e => setF('test_ok', (parseInt(e.target.value) || null) as never)} className="input" /></div>
            <div><label className="label">Sztuki NOK</label><input type="number" value={(val('test_nok') as number) ?? ''} onChange={e => setF('test_nok', (parseInt(e.target.value) || null) as never)} className="input" /></div>
          </div>
          <div className="mt-3"><label className="label">Wynik testu</label><input value={(val('test_result') as string) ?? ''} onChange={e => setF('test_result', e.target.value as never)} className="input" placeholder="np. Stabilna praca, brak NOK" /></div>
        </Section>
      )}

      {/* Weryfikacja skuteczności */}
      <Section title="Weryfikacja skuteczności">
        {canTechnical ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Termin weryfikacji</label><input type="date" value={(val('verification_due') as string) ?? ''} onChange={e => setF('verification_due', e.target.value as never)} className="input" /></div>
              <div>
                <label className="label">Wynik</label>
                <select value={(val('verification_result') as string) ?? ''} onChange={e => setF('verification_result', (e.target.value || null) as never)} className="input">
                  <option value="">— nie zweryfikowano —</option>
                  <option value="effective">Skuteczne</option>
                  <option value="ineffective">Nieskuteczne</option>
                </select>
              </div>
            </div>
            <div><label className="label">Komentarz weryfikacji</label><textarea value={(val('verification_notes') as string) ?? ''} onChange={e => setF('verification_notes', e.target.value as never)} rows={2} className="input resize-none" /></div>
            {val('verification_result') === 'ineffective' && (
              <p className="text-xs text-amber-400">Działanie nieskuteczne — rozważ ponowne otwarcie zgłoszenia lub eskalację do A1TEC.</p>
            )}
            {Object.keys(form).length > 0 && (
              <button onClick={() => saveTechMut.mutate()} disabled={saveTechMut.isPending} className="btn-primary px-5 py-2">💾 Zapisz</button>
            )}
          </div>
        ) : (
          <Field label="Wynik" value={issue.verification_result === 'effective' ? 'Skuteczne' : issue.verification_result === 'ineffective' ? 'Nieskuteczne' : 'Brak'} />
        )}
      </Section>

      {/* Media */}
      <Section title={`Zdjęcia i filmy (${media.length})`}>
        {media.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            {media.map(m => (
              <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-navy-700">
                {m.media_type === 'video'
                  ? <div className="aspect-video bg-navy-900 flex items-center justify-center text-navy-400 text-xs">🎬 Film</div>
                  : <img src={m.url} alt={m.description ?? ''} className="aspect-video object-cover w-full" />}
                <div className="px-2 py-1 text-xs text-navy-400 bg-navy-800">{MEDIA_CATEGORIES.find(c => c.value === m.category)?.label}</div>
              </a>
            ))}
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <input type="file" accept="image/*,video/*" capture="environment" onChange={e => setNewMediaFile(e.target.files?.[0] ?? null)} className="text-sm text-navy-400" />
          <select value={newMediaCat} onChange={e => setNewMediaCat(e.target.value as MediaCategory)} className="input max-w-[200px]">
            {MEDIA_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <button onClick={() => addMediaMut.mutate()} disabled={!newMediaFile || addMediaMut.isPending} className="btn-secondary px-4 py-2 disabled:opacity-40">Dodaj</button>
        </div>
      </Section>

      {/* AKCJE */}
      {canTechnical && (
        <Section title="Akcje techniczne (Specialist)">
          <div className="space-y-3">
            <textarea value={actionComment} onChange={e => setActionComment(e.target.value)} rows={2} className="input resize-none" placeholder="Komentarz do zmiany statusu (opcjonalny)..." />
            <div className="flex flex-wrap gap-2">
              {['new', 'awaiting_ack', 'reopened'].includes(issue.status) && (
                <button onClick={() => transition.mutate({ status: 'accepted', patch: { ack_time: new Date().toISOString() }, action: 'accepted' })} className="btn-primary px-4 py-2">Przyjmij zgłoszenie</button>
              )}
              {!issue.intervention_start && (
                <button onClick={() => transition.mutate({ status: 'diagnosing', patch: { intervention_start: new Date().toISOString() }, action: 'intervention_start' })} className="btn-secondary px-4 py-2">Rozpocznij interwencję</button>
              )}
              <button onClick={() => transition.mutate({ status: 'immediate_done', action: 'status_change' })} className="btn-secondary px-4 py-2">Działanie doraźne</button>
              <button onClick={() => transition.mutate({ status: 'repairing', action: 'status_change' })} className="btn-secondary px-4 py-2">W naprawie</button>
              <button onClick={() => transition.mutate({ status: 'awaiting_part', patch: { needs_part: true }, action: 'status_change' })} className="btn-secondary px-4 py-2">Oczekuje na część</button>
              <button onClick={() => transition.mutate({ status: 'testing', action: 'status_change' })} className="btn-secondary px-4 py-2">Test po naprawie</button>
              <button onClick={() => transition.mutate({ status: 'observation', action: 'status_change' })} className="btn-secondary px-4 py-2">Obserwacja</button>
              {!issue.intervention_end && (
                <button onClick={() => transition.mutate({ patch: { intervention_end: new Date().toISOString() }, action: 'intervention_end', comment: 'Zakończono interwencję' })} className="btn-secondary px-4 py-2">Zakończ interwencję</button>
              )}
              <button onClick={async () => {
                const mgr = await getUserIdsByRole(['manager'])
                await notifyUsers(mgr, `Eskalacja A1TEC: ${issue.issue_number}`, issue.symptom.slice(0, 80), issue.machine_id)
                transition.mutate({ status: 'escalated_a1tec', patch: { a1tec_escalated: true }, action: 'escalate_a1tec', comment: 'Oznaczono potrzebę kontaktu z A1TEC' })
              }} className="px-4 py-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-sm font-semibold">Eskaluj do A1TEC</button>
            </div>

            {/* Propozycja zamknięcia */}
            <div className="border-t border-navy-700 pt-3">
              {(() => {
                const blockers = closeBlockers()
                return (
                  <div className="space-y-2">
                    {blockers.length > 0 && (
                      <p className="text-xs text-amber-400">Aby zaproponować zamknięcie, uzupełnij: {blockers.join(', ')}.</p>
                    )}
                    <button
                      onClick={async () => {
                        const mgr = await getUserIdsByRole(['manager'])
                        await notifyUsers(mgr, `Do zatwierdzenia: ${issue.issue_number}`, 'Specialist proponuje zamknięcie zgłoszenia.', issue.machine_id)
                        transition.mutate({ status: 'awaiting_approval', patch: { proposed_close: true, proposed_close_by: profile!.id, status: 'awaiting_approval' }, action: 'propose_close', comment: 'Propozycja zamknięcia' })
                      }}
                      disabled={blockers.length > 0 || issue.status === 'awaiting_approval'}
                      className="btn-primary px-5 py-2 disabled:opacity-40"
                    >
                      Zaproponuj zamknięcie → Kierownik
                    </button>
                  </div>
                )
              })()}
            </div>
          </div>
        </Section>
      )}

      {/* AKCJE KIEROWNIKA */}
      {canApprove && (
        <Section title="Nadzór (Kierownik)">
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Przypisz Specialist</label>
                <select value={issue.assigned_to ?? ''} onChange={e => transition.mutate({ patch: { assigned_to: e.target.value || null }, action: 'assign', comment: 'Przypisano' })} className="input">
                  <option value="">— nieprzypisane —</option>
                  {specialists.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Priorytet</label>
                <select value={issue.priority} onChange={e => transition.mutate({ patch: { priority: e.target.value as IssuePriority }, action: 'priority_change', comment: `Priorytet → ${PRIORITY_LABELS[e.target.value as IssuePriority]}` })} className="input">
                  {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Termin działania</label>
                <input type="date" value={issue.due_date ?? ''} onChange={e => transition.mutate({ patch: { due_date: e.target.value || null }, action: 'due_change' })} className="input" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={() => transition.mutate({ patch: { is_recurring: !issue.is_recurring }, action: 'mark_recurring', comment: issue.is_recurring ? 'Odznaczono powtarzalny' : 'Oznaczono jako powtarzalny' })}
                className={`px-4 py-2 rounded-xl border text-sm font-semibold ${issue.is_recurring ? 'border-purple-500/40 bg-purple-500/10 text-purple-300' : 'border-navy-600 text-navy-300'}`}>
                {issue.is_recurring ? 'Powtarzalny ✓' : 'Oznacz powtarzalny'}
              </button>
              <button onClick={() => transition.mutate({ status: 'reopened', action: 'reopen', comment: actionComment || 'Ponowne otwarcie' })}
                className="px-4 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm font-semibold">Otwórz ponownie</button>
              <button onClick={() => navigate(`/tpm/a1tec/new/${issue.id}`)}
                className="px-4 py-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-sm font-semibold">Generuj pakiet dowodowy A1TEC</button>
            </div>

            {/* Zatwierdzenie zamknięcia */}
            <div className="border-t border-navy-700 pt-3 space-y-2">
              {(() => {
                const blockers = closeBlockers()
                return (
                  <>
                    {blockers.length > 0 && <p className="text-xs text-amber-400">Wymagane przed zamknięciem: {blockers.join(', ')}.</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => transition.mutate({ status: 'closed', patch: { approved_by: profile!.id, approved_at: new Date().toISOString(), closed_at: new Date().toISOString(), status: 'closed' }, action: 'approve_close', comment: actionComment || 'Zatwierdzono zamknięcie' })}
                        disabled={blockers.length > 0}
                        className="btn-primary px-5 py-2 disabled:opacity-40"
                      >
                        Zatwierdź zamknięcie
                      </button>
                      {issue.status === 'awaiting_approval' && (
                        <button onClick={() => transition.mutate({ status: 'reopened', action: 'reject_close', comment: actionComment || 'Odrzucono propozycję zamknięcia' })}
                          className="btn-secondary px-5 py-2">Odrzuć propozycję</button>
                      )}
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        </Section>
      )}

      {/* Historia */}
      <Section title={`Historia zmian (${history.length})`}>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {history.map(h => (
            <div key={h.id} className="text-sm border-l-2 border-navy-600 pl-3 py-1">
              <div className="text-navy-300">
                <span className="text-white font-medium">{(h.user as { full_name?: string })?.full_name ?? 'System'}</span>
                {' · '}{h.action}
                {h.old_status && h.new_status && h.old_status !== h.new_status && (
                  <> · {ISSUE_STATUS_LABELS[h.old_status as IssueStatus] ?? h.old_status} → {ISSUE_STATUS_LABELS[h.new_status as IssueStatus] ?? h.new_status}</>
                )}
              </div>
              {h.comment && <div className="text-xs text-navy-400">{h.comment}</div>}
              <div className="text-xs text-navy-600">{fmt(h.created_at)}</div>
            </div>
          ))}
          {history.length === 0 && <div className="text-navy-500 text-sm">Brak wpisów.</div>}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
      <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">{title}</div>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="mb-2">
      <div className="text-xs text-navy-500">{label}</div>
      <div className="text-sm text-white whitespace-pre-wrap">{value || '—'}</div>
    </div>
  )
}
