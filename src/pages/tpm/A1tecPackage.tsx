import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { printDocument, esc } from '@/lib/tpmExport'
import { logIssueHistory } from '@/lib/tpm'
import { A1TEC_REQUIREMENTS, ISSUE_CATEGORY_LABELS, ISSUE_STATUS_LABELS } from '@/types/tpm'
import type { TpmIssue, TpmMedia, TpmParameter, AmResultRow, TpmPmCard, IssueStatus } from '@/types/tpm'

const SUMMARY_TEXT = 'Działania TPM oraz PM były wykonywane i dokumentowane. Pomimo prowadzonych kontroli, przeglądów, regulacji i działań prewencyjnych problem na wskazanej stacji występuje ponownie. Oczekujemy od A1TEC trwałej diagnozy, przekazania standardu ustawienia, procedury kalibracji, procedury diagnostycznej oraz przedstawienia wymaganych zmian mechanicznych, elektrycznych lub programowych.'

async function fetchBundle(issueId: string) {
  const { data: issue } = await supabase
    .from('tpm_issues')
    .select('*, machine:tpm_machines(*), station:tpm_stations(*), reporter:profiles!tpm_issues_reporter_id_fkey(id, full_name)')
    .eq('id', issueId).single()
  if (!issue) return null
  const i = issue as TpmIssue
  const [stationIssues, media, params, amResults, pmCards] = await Promise.all([
    supabase.from('tpm_issues').select('*').eq('station_id', i.station_id).order('report_time', { ascending: false }),
    supabase.from('tpm_media').select('*').eq('issue_id', issueId).is('deleted_at', null),
    supabase.from('tpm_parameters').select('*').eq('station_id', i.station_id).order('created_at', { ascending: false }),
    supabase.from('tpm_am_results').select('*').eq('station_id', i.station_id).eq('result', 'nok').order('created_at', { ascending: false }).limit(50),
    supabase.from('tpm_pm_cards').select('*').eq('station_id', i.station_id).order('planned_date', { ascending: false }).limit(50)
  ])
  return {
    issue: i,
    stationIssues: (stationIssues.data ?? []) as TpmIssue[],
    media: (media.data ?? []) as TpmMedia[],
    params: (params.data ?? []) as TpmParameter[],
    amResults: (amResults.data ?? []) as AmResultRow[],
    pmCards: (pmCards.data ?? []) as TpmPmCard[]
  }
}

export default function TpmA1tecPackage() {
  const { issueId } = useParams<{ issueId: string }>()
  const { profile } = useAuthStore()
  const navigate = useNavigate()

  const [reqs, setReqs] = useState<string[]>([])
  const [reqOther, setReqOther] = useState('')
  const [recipient, setRecipient] = useState('A1TEC Service')
  const [msg, setMsg] = useState('')

  const { data, isLoading } = useQuery({ queryKey: ['tpm_a1tec_bundle', issueId], queryFn: () => fetchBundle(issueId!), enabled: !!issueId })

  const toggleReq = (code: string) => setReqs(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])

  function buildHtml(): string {
    if (!data) return ''
    const { issue, stationIssues, media, params, amResults, pmCards } = data
    const reqLabels = reqs.map(c => c === 'other' ? `Inne: ${reqOther}` : A1TEC_REQUIREMENTS.find(r => r.code === c)?.label).filter(Boolean)
    const downtimeTotal = stationIssues.reduce((s, i) => s + (i.downtime_min ?? 0), 0)
    const nokTotal = stationIssues.reduce((s, i) => s + (i.nok_count ?? 0), 0)
    const recurred = stationIssues.length > 1

    return `
      <h1>Pakiet dowodowy A1TEC</h1>
      <div class="muted">Automat: ${esc(issue.machine?.name)} · Stacja: ${esc(issue.station?.station_number)} · Zgłoszenie: ${esc(issue.issue_number)}</div>
      <div class="muted">Wygenerowano: ${new Date().toLocaleString('pl')} · ${esc(profile?.full_name)}</div>

      <h2>1–3. Automat, stacja, funkcja</h2>
      <div class="kv">
        <div>Automat</div><div>${esc(issue.machine?.name)} (${esc(issue.machine?.code)})</div>
        <div>Numer stacji</div><div>${esc(issue.station?.station_number)} — ${esc(issue.station?.name)}</div>
        <div>Opis funkcji stacji</div><div>${esc(issue.station?.function_desc) || '—'}</div>
      </div>

      <h2>4–6. Problem, daty i liczba wystąpień</h2>
      <div class="kv">
        <div>Opis problemu</div><div>${esc(issue.symptom)}</div>
        <div>Kategoria</div><div>${esc(ISSUE_CATEGORY_LABELS[issue.category] ?? issue.category)}</div>
        <div>Liczba wystąpień na stacji</div><div>${stationIssues.length}</div>
        <div>Pierwsze / ostatnie</div><div>${stationIssues.length ? `${new Date(stationIssues[stationIssues.length - 1].report_time).toLocaleDateString('pl')} – ${new Date(stationIssues[0].report_time).toLocaleDateString('pl')}` : '—'}</div>
      </div>

      <h2>7. Historia checklist AM (NOK na stacji)</h2>
      <table><thead><tr><th>Data</th><th>Wynik</th><th>Komentarz</th></tr></thead><tbody>
      ${amResults.map(a => `<tr><td>${new Date(a.created_at).toLocaleDateString('pl')}</td><td>NOK</td><td>${esc(a.comment)}</td></tr>`).join('') || '<tr><td colspan=3>Brak wpisów NOK</td></tr>'}
      </tbody></table>

      <h2>8. Historia przeglądów PM</h2>
      <table><thead><tr><th>Numer</th><th>Plan</th><th>Wykonano</th><th>Status</th></tr></thead><tbody>
      ${pmCards.map(p => `<tr><td>${esc(p.card_number)}</td><td>${new Date(p.planned_date).toLocaleDateString('pl')}</td><td>${p.actual_date ? new Date(p.actual_date).toLocaleDateString('pl') : '—'}</td><td>${esc(p.status)}</td></tr>`).join('') || '<tr><td colspan=4>Brak</td></tr>'}
      </tbody></table>

      <h2>9–10. Historia awarii i interwencji</h2>
      <table><thead><tr><th>Numer</th><th>Data</th><th>Objaw</th><th>Diagnoza</th><th>Działanie</th><th>Postój</th></tr></thead><tbody>
      ${stationIssues.map(i => `<tr><td>${esc(i.issue_number)}</td><td>${new Date(i.report_time).toLocaleDateString('pl')}</td><td>${esc(i.symptom)}</td><td>${esc(i.diagnosis) || '—'}</td><td>${esc(i.root_cause_action || i.immediate_action) || '—'}</td><td>${i.downtime_min ?? 0} min</td></tr>`).join('')}
      </tbody></table>

      <h2>11. Zdjęcia i filmy</h2>
      ${media.length ? media.map(m => m.media_type === 'photo' ? `<img src="${esc(m.url)}" />` : `<div>🎬 ${esc(m.url)}</div>`).join('') : '<div class="muted">Brak materiałów</div>'}

      <h2>12–13. Parametry przed i po regulacjach</h2>
      <table><thead><tr><th>Data</th><th>Parametr</th><th>Przed</th><th>Po</th><th>Zakres</th><th>Powód</th></tr></thead><tbody>
      ${params.map(p => `<tr><td>${new Date(p.created_at).toLocaleDateString('pl')}</td><td>${esc(p.param_name)}</td><td>${esc(p.value_before)}</td><td>${esc(p.value_after)} ${esc(p.unit)}</td><td>${esc(p.approved_range)}</td><td>${esc(p.reason)}</td></tr>`).join('') || '<tr><td colspan=6>Brak</td></tr>'}
      </tbody></table>

      <h2>14–18. Części, działania, testy, weryfikacja</h2>
      <div class="kv">
        <div>Wymienione/użyte części (bieżące)</div><div>${esc(issue.component) || '—'}</div>
        <div>Działanie doraźne</div><div>${esc(issue.immediate_action) || '—'}</div>
        <div>Działanie przyczynowe</div><div>${esc(issue.root_cause_action) || '—'}</div>
        <div>Wynik testu</div><div>${esc(issue.test_result) || '—'} (cykle: ${issue.test_cycles ?? '—'}, OK: ${issue.test_ok ?? '—'}, NOK: ${issue.test_nok ?? '—'})</div>
        <div>Weryfikacja skuteczności</div><div>${issue.verification_result === 'effective' ? 'Skuteczne' : issue.verification_result === 'ineffective' ? 'Nieskuteczne' : 'Brak'}</div>
        <div>Czy problem wystąpił ponownie</div><div>${recurred ? 'TAK' : 'Nie'}</div>
      </div>

      <h2>19–21. Wpływ na produkcję</h2>
      <div class="kv">
        <div>Łączny czas postoju (stacja)</div><div>${downtimeTotal} min</div>
        <div>Łączna liczba sztuk NOK</div><div>${nokTotal}</div>
        <div>Aktualny status zgłoszenia</div><div>${esc(ISSUE_STATUS_LABELS[issue.status as IssueStatus])}</div>
      </div>

      <h2>24. Wymagania kierowane do A1TEC</h2>
      <ul>${reqLabels.map(l => `<li>${esc(l)}</li>`).join('') || '<li>—</li>'}</ul>

      <h2>Podsumowanie</h2>
      <div class="summary">${esc(SUMMARY_TEXT)}</div>

      <div class="muted" style="margin-top:24px">Margoline MES · Pakiet dowodowy TPM/PM dla A1TEC</div>`
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!data || !profile) throw new Error('Brak danych.')
      const { error } = await supabase.from('tpm_a1tec_contacts').insert({
        issue_id: data.issue.id,
        internal_number: data.issue.issue_number,
        sender_id: profile.id,
        recipient,
        problem_desc: data.issue.symptom,
        attachments: data.media.map(m => m.url),
        requirements: reqs,
        requirement_other: reqs.includes('other') ? reqOther : null,
        status: 'preparation'
      })
      if (error) throw error
      if (!data.issue.a1tec_escalated) {
        await supabase.from('tpm_issues').update({ a1tec_escalated: true, status: 'escalated_a1tec' }).eq('id', data.issue.id)
        await logIssueHistory({ issueId: data.issue.id, userId: profile.id, action: 'a1tec_package', newStatus: 'escalated_a1tec', comment: 'Wygenerowano pakiet dowodowy A1TEC' })
      }
    },
    onSuccess: () => { setMsg('Zapisano w rejestrze A1TEC'); printDocument('Pakiet dowodowy A1TEC', buildHtml()) },
    onError: (e: Error) => setMsg('Błąd: ' + e.message)
  })

  if (isLoading || !data) return <div className="text-navy-400 text-center py-16">Ładowanie...</div>

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-2">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-navy-400 hover:text-white">←</button>
        <div>
          <h1 className="text-xl font-bold text-white">Pakiet dowodowy A1TEC</h1>
          <p className="text-navy-400 text-sm">{data.issue.issue_number} · {data.issue.station?.station_number}</p>
        </div>
      </div>

      {msg && <div className="rounded-xl border border-brand/30 bg-brand/10 px-4 py-2 text-sm text-brand">{msg}</div>}

      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Odbiorca</div>
        <input value={recipient} onChange={e => setRecipient(e.target.value)} className="input" placeholder="np. A1TEC Service" />
      </div>

      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Wymagania kierowane do A1TEC</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {A1TEC_REQUIREMENTS.map(req => (
            <label key={req.code} className="flex items-center gap-2 cursor-pointer text-sm text-navy-300">
              <input type="checkbox" checked={reqs.includes(req.code)} onChange={() => toggleReq(req.code)} className="w-4 h-4 accent-brand" />
              {req.label}
            </label>
          ))}
        </div>
        {reqs.includes('other') && (
          <input value={reqOther} onChange={e => setReqOther(e.target.value)} className="input" placeholder={'Opis dla „Inne” (wymagany)'} />
        )}
      </div>

      <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4 text-sm text-navy-300">
        Pakiet zbierze automatycznie: historię checklist AM (NOK), przeglądy PM, historię awarii i interwencji,
        zdjęcia/filmy, parametry przed/po, części, testy, weryfikację, czas postoju, sztuki NOK oraz wymagania i podsumowanie.
      </div>

      <button
        onClick={() => { if (reqs.includes('other') && !reqOther.trim()) { setMsg('Uzupełnij opis dla „Inne".'); return } saveMut.mutate() }}
        disabled={saveMut.isPending}
        className="w-full py-4 rounded-2xl bg-brand text-navy-900 font-bold text-lg disabled:opacity-40 hover:bg-brand/90 transition-all"
      >
        {saveMut.isPending ? 'Generowanie...' : 'Zapisz w rejestrze i generuj pakiet (PDF)'}
      </button>
    </div>
  )
}
