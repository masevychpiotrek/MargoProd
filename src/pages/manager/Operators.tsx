import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchOperatorWork } from '@/lib/operatorWorkApi'
import { operatorWorkCsv, rankOperatorWork, type WorkSource } from '@/lib/operatorWork'
import { getProductionDate } from '@/lib/utils'

const number = (value: number | null) => value == null ? '—' : value.toLocaleString('pl-PL', { maximumFractionDigits: 1 })
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const SOURCES: WorkSource[] = ['IS PRO', 'Automaty strzykawkowe']
const th = 'text-left py-3 px-3 text-xs font-bold text-navy-400 whitespace-nowrap'
const td = 'py-3 px-3 align-top'

export default function Operators() {
  const today = getProductionDate()
  const [from, setFrom] = useState(today.slice(0, 7) + '-01')
  const [to, setTo] = useState(today)
  const [source, setSource] = useState('all')
  const [machine, setMachine] = useState('all')
  const [shift, setShift] = useState('all')
  const [operator, setOperator] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('good')
  const [page, setPage] = useState(0)
  const rangeValid = !!from && !!to && from <= to
  const query = useQuery({ queryKey: ['operator-work', from, to], queryFn: () => fetchOperatorWork(from, to), enabled: rangeValid, refetchInterval: 60000 })
  const all = query.data ?? []
  const machineOptions = useMemo(() => [...new Map(all.filter(r => source === 'all' || r.source === source).map(r => [r.machineKey, { name: r.machineName, source: r.source }])).entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'pl', { numeric: true })), [all, source])
  const operatorOptions = useMemo(() => [...new Map(all.map(r => [r.operatorId, r.operatorName])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pl')), [all])
  const rows = useMemo(() => all.filter(r => (source === 'all' || r.source === source) && (machine === 'all' || r.machineKey === machine)
    && (shift === 'all' || r.shift === shift) && (operator === 'all' || r.operatorId === operator) && r.operatorName.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl'))), [all, source, machine, shift, operator, search])
  const ranking = useMemo(() => rankOperatorWork(rows).sort((a, b) => sort === 'name' ? a.operatorName.localeCompare(b.operatorName, 'pl') : sort === 'shifts' ? b.shifts - a.shifts || b.good - a.good : sort === 'reject' ? (a.rejectPct ?? Infinity) - (b.rejectPct ?? Infinity) || b.good - a.good : b.good - a.good), [rows, sort])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1))
  const busy = query.isFetching
  function reset() { setSource('all'); setMachine('all'); setShift('all'); setOperator('all'); setSearch(''); setPage(0) }
  function exportCsv() {
    const url = URL.createObjectURL(new Blob([operatorWorkCsv(rows)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `operatorzy-${from}-${to}.csv`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-white">Ranking i historia pracy operatorów</h1><p className="text-navy-400 mt-1">IS PRO i automaty strzykawkowe — wspólny wykaz pracy i wyników.</p></div>
      <div className="flex gap-2"><button className="btn-secondary" disabled={busy || !rangeValid} onClick={() => void query.refetch()}>{busy ? 'Odświeżanie…' : 'Odśwież'}</button><button className="btn-primary" disabled={!rows.length || busy || !!query.error || !rangeValid} onClick={exportCsv}>Eksport CSV</button></div>
    </div>
    <div className="card space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <label className="text-sm text-navy-300">Od<input aria-label="Data od" className="input mt-1" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(0) }} /></label>
        <label className="text-sm text-navy-300">Do<input aria-label="Data do" className="input mt-1" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(0) }} /></label>
        <label className="text-sm text-navy-300">Moduł<select className="input mt-1" value={source} onChange={e => { setSource(e.target.value); setMachine('all'); setPage(0) }}><option value="all">Oba moduły</option>{SOURCES.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="text-sm text-navy-300">Maszyna<select className="input mt-1" value={machine} onChange={e => { setMachine(e.target.value); setPage(0) }}><option value="all">Wszystkie maszyny</option>{machineOptions.map(([id, m]) => <option key={id} value={id}>{m.name} · {m.source}</option>)}</select></label>
        <label className="text-sm text-navy-300">Zmiana<select className="input mt-1" value={shift} onChange={e => { setShift(e.target.value); setPage(0) }}><option value="all">Wszystkie zmiany</option>{['I', 'II', 'III'].map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="text-sm text-navy-300">Operator<select className="input mt-1" value={operator} onChange={e => { setOperator(e.target.value); setPage(0) }}><option value="all">Wszyscy operatorzy</option>{operatorOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-sm text-navy-300">Szukaj operatora<input className="input mt-1" type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} placeholder="Imię lub nazwisko" /></label>
        <div className="flex items-end"><button className="btn-secondary w-full" onClick={reset}>Wyczyść filtry</button></div>
      </div>
      <div className="flex flex-wrap gap-2">{[['Dzisiaj', today, today], ['Ten miesiąc', today.slice(0, 7) + '-01', today]].map(([label, a, b]) => <button key={label} className="btn-secondary text-xs" onClick={() => { setFrom(a); setTo(b); setPage(0) }}>{label}</button>)}</div>
      {!rangeValid && <p role="alert" className="text-amber-300">Wybierz prawidłowy zakres: data „Od” nie może być późniejsza niż „Do”.</p>}
    </div>
    {query.error && <div role="alert" className="card border-red-500/40 text-red-300">Nie udało się pobrać pełnego wykazu. {query.error.message}<button className="btn-secondary ml-3" onClick={() => void query.refetch()}>Spróbuj ponownie</button></div>}
    {query.isPending && rangeValid && <div role="status" className="card text-navy-300">Pobieranie pracy operatorów z obu modułów…</div>}
    {!query.isPending && !query.error && rangeValid && <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">{[['Operatorzy', ranking.length], ['Dobre sztuki', ranking.reduce((n, r) => n + r.good, 0)], ['Braki', ranking.reduce((n, r) => n + r.reject, 0)], ['Przydziały operator–zmiana', rows.length]].map(([label, value]) => <div className="kpi-card" key={label}><div className="kpi-label">{label}</div><div className="kpi-value text-xl">{number(Number(value))}</div></div>)}</div>
      <div className="card">
        <div className="flex flex-wrap justify-between items-start gap-3 mb-4"><div><h2 className="card-title">Ranking operatorów</h2><p className="card-sub">Kliknij nazwisko, aby zobaczyć jego historię. Liczba sztuk zależy od typu maszyny i produktu.</p></div><label className="text-sm text-navy-300">Sortowanie<select className="input mt-1" value={sort} onChange={e => setSort(e.target.value)}><option value="good">Dobre sztuki: najwięcej</option><option value="shifts">Liczba zmian: najwięcej</option><option value="reject">Udział braków: najmniejszy</option><option value="name">Nazwisko: A–Z</option></select></label></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['#', 'Operator', 'Moduły', 'Dobre sztuki', 'Braki', 'Braki %', 'Zmiany', 'Praca min', 'Przestój min', 'Maszyny'].map(h => <th className={th} key={h}>{h}</th>)}</tr></thead><tbody>
          {!ranking.length && <tr><td colSpan={10} className="py-8 text-center text-navy-400">Brak pracy operatorów dla wybranych filtrów.</td></tr>}
          {ranking.map((r, i) => <tr key={r.operatorId} className="border-t border-navy-800 hover:bg-navy-800/50"><td className={td}>{i + 1}</td><td className={td}><button className="text-brand font-bold text-left hover:underline" onClick={() => { setOperator(r.operatorId); setPage(0) }}>{r.operatorName}</button>{r.missingResults > 0 && <div className="text-xs text-amber-300 mt-1">Brak wyników: {r.missingResults} zmian</div>}</td><td className={td}>{r.sources.join(', ')}</td><td className={td}>{number(r.good)}</td><td className={td}>{number(r.reject)}</td><td className={td}>{number(r.rejectPct)}{r.rejectPct != null && '%'}</td><td className={td}>{r.shifts}</td><td className={td}>{number(r.runtime)}</td><td className={td}>{number(r.downtime)}</td><td className={`${td} min-w-[180px] text-navy-300 text-xs`}>{r.machines.join(', ')}</td></tr>)}
        </tbody></table></div>
      </div>
      <div className="card">
        <h2 className="card-title mb-2">Kto, kiedy i na jakiej maszynie pracował</h2>
        <p className="card-sub mb-4">W IS PRO wynik pochodzi z wpisów danego operatora; godziny oznaczają początek i koniec całej zmiany na maszynie. W strzykawkach wynik pochodzi z sesji operatora. „—” oznacza brak danych. Czasy pracy i postoju obejmują zapisane wyniki, a nie ewidencję obecności.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Data produkcyjna', 'Zmiana', 'Operator', 'Moduł / maszyna', 'Od – do', 'Asortyment', 'Dobre sztuki', 'Braki', 'Praca min', 'Przestój min', 'Status'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead><tbody>
          {!rows.length && <tr><td colSpan={11} className="py-8 text-center text-navy-400">Brak wpisów w tym zakresie.</td></tr>}
          {rows.slice(currentPage * 50, currentPage * 50 + 50).map(r => <tr key={r.id} className="border-t border-navy-800 hover:bg-navy-800/50"><td className={`${td} whitespace-nowrap`}>{r.date}</td><td className={td}>{r.shift}</td><td className={`${td} font-semibold text-white`}>{r.operatorName}</td><td className={td}><div>{r.machineName}</div><div className="text-xs text-navy-400">{r.source}</div></td><td className={`${td} whitespace-nowrap`}>{dateTime(r.startedAt)}<br />{r.endedAt ? dateTime(r.endedAt) : r.status === 'W trakcie' ? 'W trakcie' : '—'}</td><td className={td}>{r.product}</td><td className={td}>{number(r.good)}</td><td className={td}>{number(r.reject)}</td><td className={td}>{number(r.runtime)}</td><td className={td}>{number(r.downtime)}</td><td className={`${td} text-xs text-navy-300`}>{r.status}</td></tr>)}
        </tbody></table></div>
        <div className="flex flex-wrap justify-between items-center gap-3 mt-4 text-sm text-navy-300"><span>{rows.length} przydziałów · strona {currentPage + 1} z {Math.max(1, Math.ceil(rows.length / 50))}</span><div className="flex gap-2"><button className="btn-secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Poprzednia</button><button className="btn-secondary" disabled={(currentPage + 1) * 50 >= rows.length} onClick={() => setPage(currentPage + 1)}>Następna</button></div></div>
      </div>
    </>}
  </div>
}
