import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { exportXlsx, printDocument, esc, type Sheet } from '@/lib/tpmExport'
import { ISSUE_CATEGORY_LABELS } from '@/types/tpm'
import type { TpmIssue, AmChecklist, TpmPmCard, TpmMachine } from '@/types/tpm'

function rangeFor(type: 'week' | 'month', anchor: string) {
  const d = new Date(anchor)
  if (type === 'month') {
    const from = new Date(d.getFullYear(), d.getMonth(), 1)
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    return { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] }
  }
  const day = (d.getDay() + 6) % 7 // poniedziałek = 0
  const from = new Date(d); from.setDate(d.getDate() - day)
  const to = new Date(from); to.setDate(from.getDate() + 6)
  return { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] }
}

async function fetchData(from: string, to: string) {
  const [issuesRes, amRes, pmRes, machinesRes] = await Promise.all([
    supabase.from('tpm_issues').select('*, machine:tpm_machines(*), station:tpm_stations(*)').gte('report_time', from).lte('report_time', to + 'T23:59:59'),
    supabase.from('tpm_am_checklists').select('*').gte('checklist_date', from).lte('checklist_date', to),
    supabase.from('tpm_pm_cards').select('*, station:tpm_stations(*)').gte('planned_date', from).lte('planned_date', to),
    supabase.from('tpm_machines').select('*').eq('is_active', true)
  ])
  return {
    issues: (issuesRes.data ?? []) as TpmIssue[],
    am: (amRes.data ?? []) as AmChecklist[],
    pm: (pmRes.data ?? []) as TpmPmCard[],
    machines: (machinesRes.data ?? []) as TpmMachine[]
  }
}

function Row({ k, v }: { k: string; v: string | number }) {
  return <div className="flex justify-between py-1.5 border-b border-navy-700 last:border-0"><span className="text-navy-400 text-sm">{k}</span><span className="text-white font-medium text-sm">{v}</span></div>
}

export default function TpmReports() {
  const navigate = useNavigate()
  const [type, setType] = useState<'week' | 'month'>('week')
  const [anchor, setAnchor] = useState(new Date().toISOString().split('T')[0])
  const { from, to } = rangeFor(type, anchor)

  const { data, isLoading } = useQuery({ queryKey: ['tpm_report', from, to], queryFn: () => fetchData(from, to) })

  const r = useMemo(() => {
    if (!data) return null
    const { issues, am, pm, machines } = data
    const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 864e5) + 1
    const expectedAm = machines.length * 3 * days
    const doneAm = am.filter(c => c.status !== 'in_progress').length
    const amPct = expectedAm > 0 ? Math.round(doneAm / expectedAm * 100) : 0
    const pmDone = pm.filter(c => ['done', 'done_late', 'approved'].includes(c.status)).length
    const pmPct = pm.length > 0 ? Math.round(pmDone / pm.length * 100) : 0
    const pmLate = pm.filter(c => c.status === 'done_late' || (['planned', 'todo'].includes(c.status) && new Date(c.planned_date) < new Date())).length
    const downtime = issues.reduce((s, i) => s + (i.downtime_min ?? 0), 0)
    const nok = issues.reduce((s, i) => s + (i.nok_count ?? 0), 0)
    const recurring = issues.filter(i => i.is_recurring).length
    const a1tec = issues.filter(i => i.a1tec_escalated).length
    const openActions = issues.filter(i => !['closed'].includes(i.status)).length

    const byStation = new Map<string, number>()
    const byCategory = new Map<string, number>()
    for (const i of issues) {
      const st = (i.station as { station_number?: string })?.station_number ?? '—'
      byStation.set(st, (byStation.get(st) ?? 0) + 1)
      const cat = ISSUE_CATEGORY_LABELS[i.category] ?? i.category
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1)
    }
    const topStations = [...byStation.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    const topCategories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

    return { days, expectedAm, doneAm, amPct, pmTotal: pm.length, pmDone, pmPct, pmLate, failures: issues.length, downtime, nok, recurring, a1tec, openActions, topStations, topCategories, issues }
  }, [data, from, to])

  const doXlsx = () => {
    if (!r) return
    const sheets: Sheet[] = [
      { name: 'Podsumowanie', header: ['Wskaźnik', 'Wartość'], rows: [
        ['Zakres', `${from} – ${to}`], ['Realizacja AM %', r.amPct], ['AM wykonane', r.doneAm], ['AM oczekiwane', r.expectedAm],
        ['Realizacja PM %', r.pmPct], ['PM wykonane', r.pmDone], ['PM po terminie', r.pmLate],
        ['Liczba awarii', r.failures], ['Czas postoju (min)', r.downtime], ['Sztuki NOK', r.nok],
        ['Problemy powtarzalne', r.recurring], ['Przekazane do A1TEC', r.a1tec], ['Otwarte działania', r.openActions]
      ]},
      { name: 'Zgłoszenia', header: ['Numer', 'Automat', 'Stacja', 'Kategoria', 'Priorytet', 'Status', 'Postój(min)', 'NOK', 'Data'],
        rows: r.issues.map(i => [i.issue_number, (i.machine as { code?: string })?.code, (i.station as { station_number?: string })?.station_number,
          ISSUE_CATEGORY_LABELS[i.category] ?? i.category, i.priority, i.status, i.downtime_min ?? 0, i.nok_count ?? 0, new Date(i.report_time).toLocaleDateString('pl')]) }
    ]
    exportXlsx(`Raport_TPM_${type}_${from}`, sheets)
  }

  const doPrint = () => {
    if (!r) return
    const title = `Raport ${type === 'week' ? 'tygodniowy' : 'miesięczny'} TPM/PM`
    const html = `
      <h1>${title} — IS PRO</h1>
      <div class="muted">Zakres: ${from} – ${to}</div>
      <h2>1. Realizacja AM i PM</h2>
      <div class="kv">
        <div>Realizacja AM</div><div>${r.amPct}% (${r.doneAm}/${r.expectedAm})</div>
        <div>Realizacja PM</div><div>${r.pmPct}% (${r.pmDone}/${r.pmTotal})</div>
        <div>PM po terminie</div><div>${r.pmLate}</div>
      </div>
      <h2>2. Awarie i skutki</h2>
      <div class="kv">
        <div>Liczba awarii</div><div>${r.failures}</div>
        <div>Czas postoju</div><div>${r.downtime} min</div>
        <div>Sztuki NOK</div><div>${r.nok}</div>
        <div>Problemy powtarzalne</div><div>${r.recurring}</div>
        <div>Przekazane do A1TEC</div><div>${r.a1tec}</div>
        <div>Otwarte działania</div><div>${r.openActions}</div>
      </div>
      <h2>3. Najbardziej awaryjne stacje</h2>
      <table><thead><tr><th>Stacja</th><th>Liczba awarii</th></tr></thead><tbody>
        ${r.topStations.map(([s, c]) => `<tr><td>${esc(s)}</td><td>${c}</td></tr>`).join('') || '<tr><td colspan=2>Brak</td></tr>'}
      </tbody></table>
      <h2>4. Najczęstsze kategorie problemów</h2>
      <table><thead><tr><th>Kategoria</th><th>Liczba</th></tr></thead><tbody>
        ${r.topCategories.map(([s, c]) => `<tr><td>${esc(s)}</td><td>${c}</td></tr>`).join('') || '<tr><td colspan=2>Brak</td></tr>'}
      </tbody></table>
      <h2>5. Wykaz zgłoszeń</h2>
      <table><thead><tr><th>Numer</th><th>Stacja</th><th>Kategoria</th><th>Status</th><th>Postój</th></tr></thead><tbody>
        ${r.issues.map(i => `<tr><td>${esc(i.issue_number)}</td><td>${esc((i.station as { station_number?: string })?.station_number)}</td><td>${esc(ISSUE_CATEGORY_LABELS[i.category] ?? i.category)}</td><td>${esc(i.status)}</td><td>${i.downtime_min ?? 0} min</td></tr>`).join('') || '<tr><td colspan=5>Brak</td></tr>'}
      </tbody></table>
      <div class="muted">Wygenerowano: ${new Date().toLocaleString('pl')} · Margoline MES</div>`
    printDocument(title, html)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Raporty TPM/PM</h1>
          <p className="text-navy-400 text-sm">Tygodniowy i miesięczny materiał dowodowy</p>
        </div>
        <button onClick={() => navigate('/tpm/manager')} className="btn-secondary px-4 py-2">← Nadzór</button>
      </div>

      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          <button onClick={() => setType('week')} className={`rounded-lg px-4 py-2 text-sm font-bold border ${type === 'week' ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-navy-400'}`}>Tygodniowy</button>
          <button onClick={() => setType('month')} className={`rounded-lg px-4 py-2 text-sm font-bold border ${type === 'month' ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-navy-400'}`}>Miesięczny</button>
        </div>
        <div><label className="label">Data w okresie</label><input type="date" value={anchor} onChange={e => setAnchor(e.target.value)} className="input" /></div>
        <div className="text-sm text-navy-400">Zakres: <span className="text-white">{from} – {to}</span></div>
        <div className="flex-1" />
        <div className="flex gap-2">
          <button onClick={doXlsx} className="btn-secondary px-4 py-2">📊 XLSX</button>
          <button onClick={doPrint} className="btn-primary px-4 py-2">🖨 PDF / Druk</button>
        </div>
      </div>

      {isLoading || !r ? <div className="text-navy-400">Ładowanie...</div> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { l: 'Realizacja AM', v: `${r.amPct}%`, c: r.amPct >= 80 ? 'text-green-400' : 'text-amber-400' },
              { l: 'Realizacja PM', v: `${r.pmPct}%`, c: r.pmPct >= 80 ? 'text-green-400' : 'text-amber-400' },
              { l: 'Liczba awarii', v: r.failures },
              { l: 'Czas postoju (min)', v: r.downtime },
              { l: 'Sztuki NOK', v: r.nok },
              { l: 'PM po terminie', v: r.pmLate, c: r.pmLate ? 'text-red-400' : 'text-white' },
              { l: 'Powtarzalne', v: r.recurring, c: r.recurring ? 'text-purple-400' : 'text-white' },
              { l: 'Do A1TEC', v: r.a1tec, c: r.a1tec ? 'text-cyan-400' : 'text-white' },
            ].map(t => (
              <div key={t.l} className="rounded-xl border border-navy-700 bg-navy-800 p-4">
                <div className="text-xs text-navy-400 uppercase tracking-wider">{t.l}</div>
                <div className={`text-2xl font-bold mt-1 ${t.c ?? 'text-white'}`}>{t.v}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">Najbardziej awaryjne stacje</div>
              {r.topStations.length === 0 ? <p className="text-navy-500 text-sm">Brak danych.</p> : r.topStations.map(([s, c]) => <Row key={s} k={s} v={`${c} awarii`} />)}
            </div>
            <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">Najczęstsze kategorie</div>
              {r.topCategories.length === 0 ? <p className="text-navy-500 text-sm">Brak danych.</p> : r.topCategories.map(([s, c]) => <Row key={s} k={s} v={c} />)}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
