import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { exportXlsx, exportCsv, printDocument, esc, type Sheet } from '@/lib/tpmExport'
import type { SaSession } from '@/types/database'

type PeriodType = 'day' | 'week' | 'month'

function rangeFor(type: PeriodType, anchor: string) {
  const d = new Date(anchor)
  if (type === 'month') {
    return {
      from: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0],
      to: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
    }
  }
  if (type === 'week') {
    const day = (d.getDay() + 6) % 7
    const from = new Date(d); from.setDate(d.getDate() - day)
    const to = new Date(from); to.setDate(from.getDate() + 6)
    return { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] }
  }
  return { from: anchor, to: anchor }
}

async function fetchSessions(from: string, to: string) {
  const { data } = await supabase
    .from('sa_sessions')
    .select('*, machine:sa_machines(*), assortment:sa_assortments(*), operator:profiles!sa_sessions_operator_id_fkey(id, full_name)')
    .gte('session_date', from).lte('session_date', to)
    .order('session_date', { ascending: false })
  return data as SaSession[] ?? []
}
async function fetchDowntime(from: string, to: string) {
  const { data } = await supabase
    .from('sa_downtime_events')
    .select('duration_min, started_at, category:sa_downtime_categories(name)')
    .gte('started_at', from).lte('started_at', to + 'T23:59:59')
  return data ?? []
}
async function fetchDefects(from: string, to: string) {
  const { data } = await supabase
    .from('sa_defect_entries')
    .select('qty, created_at, category:sa_defect_categories(name)')
    .gte('created_at', from).lte('created_at', to + 'T23:59:59')
  return data ?? []
}

function groupSum<T>(items: T[], keyFn: (i: T) => string, valFn: (i: T) => number) {
  const m = new Map<string, number>()
  for (const i of items) m.set(keyFn(i), (m.get(keyFn(i)) ?? 0) + valFn(i))
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export default function SyringeReports() {
  const navigate = useNavigate()
  const [type, setType] = useState<PeriodType>('day')
  const [anchor, setAnchor] = useState(new Date().toISOString().split('T')[0])
  const [shift, setShift] = useState<string>('')
  const { from, to } = rangeFor(type, anchor)

  const { data: sessions = [], isLoading } = useQuery({ queryKey: ['sa_report_sessions', from, to], queryFn: () => fetchSessions(from, to) })
  const { data: downtime = [] } = useQuery({ queryKey: ['sa_report_downtime', from, to], queryFn: () => fetchDowntime(from, to) })
  const { data: defects = [] } = useQuery({ queryKey: ['sa_report_defects', from, to], queryFn: () => fetchDefects(from, to) })

  const filteredSessions = shift ? sessions.filter(s => s.shift_type === shift) : sessions

  const r = useMemo(() => {
    const s = filteredSessions
    const produced = s.reduce((a, x) => a + (x.total_produced ?? 0), 0)
    const good = s.reduce((a, x) => a + (x.total_good ?? 0), 0)
    const reject = s.reduce((a, x) => a + (x.total_reject ?? 0), 0)
    const planned = s.reduce((a, x) => a + (x.plan_qty ?? 0), 0)
    const downMin = s.reduce((a, x) => a + (x.total_downtime_min ?? 0), 0)
    const planPct = planned > 0 ? Math.round(good / planned * 100) : null
    const rejectPct = produced > 0 ? (reject / produced * 100).toFixed(1) : '0.0'

    const byMachine = groupSum(s, x => (x.machine as { name?: string })?.name ?? '—', x => x.total_good ?? 0)
    const byAssortment = groupSum(s, x => (x.assortment as { name?: string })?.name ?? '—', x => x.total_good ?? 0)
    const byOperator = groupSum(s, x => (x.operator as { full_name?: string })?.full_name ?? '—', x => x.total_good ?? 0)
    const byDowntime = groupSum(downtime, (x: any) => x.category?.name ?? '—', (x: any) => x.duration_min ?? 0)
    const byDefect = groupSum(defects, (x: any) => x.category?.name ?? '—', (x: any) => x.qty ?? 0)

    return { count: s.length, produced, good, reject, planned, downMin, planPct, rejectPct, byMachine, byAssortment, byOperator, byDowntime, byDefect }
  }, [filteredSessions, downtime, defects])

  const periodLabel = type === 'day' ? 'dzienny' : type === 'week' ? 'tygodniowy' : 'miesięczny'

  const doXlsx = () => {
    const sheets: Sheet[] = [
      { name: 'Podsumowanie', header: ['Wskaźnik', 'Wartość'], rows: [
        ['Zakres', `${from} – ${to}`], ['Zmiana', shift || 'wszystkie'], ['Liczba zmian', r.count],
        ['Wyprodukowano', r.produced], ['Sztuki dobre', r.good], ['Braki', r.reject], ['% braków', r.rejectPct],
        ['Plan', r.planned], ['Realizacja planu %', r.planPct ?? '—'], ['Czas przestojów (min)', r.downMin]
      ]},
      { name: 'Wg automatu', header: ['Automat', 'Dobre szt'], rows: r.byMachine },
      { name: 'Wg asortymentu', header: ['Asortyment', 'Dobre szt'], rows: r.byAssortment },
      { name: 'Wg operatora', header: ['Operator', 'Dobre szt'], rows: r.byOperator },
      { name: 'Przestoje', header: ['Kategoria', 'Minuty'], rows: r.byDowntime },
      { name: 'Braki', header: ['Kategoria', 'Sztuki'], rows: r.byDefect },
      { name: 'Zmiany', header: ['Data', 'Zmiana', 'Automat', 'Asortyment', 'Operator', 'Dobre', 'Braki', 'Plan', 'Postój(min)'],
        rows: filteredSessions.map(x => [x.session_date, x.shift_type, (x.machine as { name?: string })?.name,
          (x.assortment as { name?: string })?.name, (x.operator as { full_name?: string })?.full_name,
          x.total_good ?? 0, x.total_reject ?? 0, x.plan_qty ?? 0, x.total_downtime_min ?? 0]) }
    ]
    exportXlsx(`Raport_strzykawki_${type}_${from}`, sheets)
  }

  const doCsv = () => {
    exportCsv(`Raport_strzykawki_${type}_${from}`,
      ['Data', 'Zmiana', 'Automat', 'Asortyment', 'Operator', 'Dobre', 'Braki', 'Plan', 'Postój(min)'],
      filteredSessions.map(x => [x.session_date, x.shift_type, (x.machine as { name?: string })?.name,
        (x.assortment as { name?: string })?.name, (x.operator as { full_name?: string })?.full_name,
        x.total_good ?? 0, x.total_reject ?? 0, x.plan_qty ?? 0, x.total_downtime_min ?? 0]))
  }

  const doPrint = () => {
    const tbl = (head: string[], rows: (string | number)[][]) =>
      `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(rr => `<tr>${rr.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan=${head.length}>Brak</td></tr>`}</tbody></table>`
    const html = `
      <h1>Raport ${periodLabel} — linia strzykawkowa</h1>
      <div class="muted">Zakres: ${from} – ${to} · Zmiana: ${shift || 'wszystkie'}</div>
      <h2>Podsumowanie</h2>
      <div class="kv">
        <div>Liczba zmian</div><div>${r.count}</div>
        <div>Wyprodukowano</div><div>${r.produced.toLocaleString('pl')}</div>
        <div>Sztuki dobre</div><div>${r.good.toLocaleString('pl')}</div>
        <div>Braki</div><div>${r.reject.toLocaleString('pl')} (${r.rejectPct}%)</div>
        <div>Plan</div><div>${r.planned.toLocaleString('pl')}</div>
        <div>Realizacja planu</div><div>${r.planPct != null ? r.planPct + '%' : '—'}</div>
        <div>Czas przestojów</div><div>${r.downMin} min</div>
      </div>
      <h2>Produkcja wg automatu</h2>${tbl(['Automat', 'Dobre szt'], r.byMachine)}
      <h2>Produkcja wg asortymentu</h2>${tbl(['Asortyment', 'Dobre szt'], r.byAssortment)}
      <h2>Produkcja wg operatora</h2>${tbl(['Operator', 'Dobre szt'], r.byOperator)}
      <h2>Przestoje wg kategorii</h2>${tbl(['Kategoria', 'Minuty'], r.byDowntime)}
      <h2>Braki wg kategorii</h2>${tbl(['Kategoria', 'Sztuki'], r.byDefect)}
      <div class="muted" style="margin-top:24px">Wygenerowano: ${new Date().toLocaleString('pl')} · Margoline MES</div>`
    printDocument(`Raport ${periodLabel} — linia strzykawkowa`, html)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Raporty — linia strzykawkowa</h1>
          <p className="text-navy-400 text-sm">Zmianowe, dzienne, tygodniowe i miesięczne</p>
        </div>
        <button onClick={() => navigate('/syringe/supervisor')} className="btn-secondary px-4 py-2">← Panel nadzorczy</button>
      </div>

      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          {(['day', 'week', 'month'] as PeriodType[]).map(t => (
            <button key={t} onClick={() => setType(t)} className={`rounded-lg px-4 py-2 text-sm font-bold border ${type === t ? 'border-brand bg-brand/10 text-brand' : 'border-navy-600 text-navy-400'}`}>
              {t === 'day' ? 'Dzienny' : t === 'week' ? 'Tygodniowy' : 'Miesięczny'}
            </button>
          ))}
        </div>
        <div><label className="label">Data w okresie</label><input type="date" value={anchor} onChange={e => setAnchor(e.target.value)} className="input" /></div>
        <div>
          <label className="label">Zmiana</label>
          <select value={shift} onChange={e => setShift(e.target.value)} className="input">
            <option value="">Wszystkie</option>
            <option value="I">I</option><option value="II">II</option><option value="III">III</option>
          </select>
        </div>
        <div className="text-sm text-navy-400">Zakres: <span className="text-white">{from} – {to}</span></div>
        <div className="flex-1" />
        <div className="flex gap-2">
          <button onClick={doCsv} className="btn-secondary px-3 py-2">CSV</button>
          <button onClick={doXlsx} className="btn-secondary px-3 py-2">XLSX</button>
          <button onClick={doPrint} className="btn-primary px-4 py-2">🖨 PDF</button>
        </div>
      </div>

      {isLoading ? <div className="text-navy-400">Ładowanie...</div> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { l: 'Liczba zmian', v: r.count },
              { l: 'Sztuki dobre', v: r.good.toLocaleString('pl'), c: 'text-green-400' },
              { l: 'Braki', v: `${r.reject.toLocaleString('pl')} (${r.rejectPct}%)`, c: 'text-red-400' },
              { l: 'Realizacja planu', v: r.planPct != null ? `${r.planPct}%` : '—' },
              { l: 'Wyprodukowano', v: r.produced.toLocaleString('pl') },
              { l: 'Plan', v: r.planned.toLocaleString('pl') },
              { l: 'Czas przestojów', v: `${r.downMin} min` },
              { l: 'Śr. dobre / zmianę', v: r.count ? Math.round(r.good / r.count).toLocaleString('pl') : 0 },
            ].map(t => (
              <div key={t.l} className="rounded-xl border border-navy-700 bg-navy-800 p-4">
                <div className="text-xs text-navy-400 uppercase tracking-wider">{t.l}</div>
                <div className={`text-2xl font-bold mt-1 ${t.c ?? 'text-white'}`}>{t.v}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Block title="Produkcja wg automatu" rows={r.byMachine} unit="szt" />
            <Block title="Produkcja wg asortymentu" rows={r.byAssortment} unit="szt" />
            <Block title="Przestoje wg kategorii" rows={r.byDowntime} unit="min" />
            <Block title="Braki wg kategorii" rows={r.byDefect} unit="szt" />
          </div>
        </>
      )}
    </div>
  )
}

function Block({ title, rows, unit }: { title: string; rows: [string, number][]; unit: string }) {
  return (
    <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
      <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-3">{title}</div>
      {rows.length === 0 ? <p className="text-navy-500 text-sm">Brak danych.</p> : rows.map(([k, v]) => (
        <div key={k} className="flex justify-between py-1.5 border-b border-navy-700 last:border-0 text-sm">
          <span className="text-navy-300">{k}</span>
          <span className="text-white font-medium">{v.toLocaleString('pl')} {unit}</span>
        </div>
      ))}
    </div>
  )
}
