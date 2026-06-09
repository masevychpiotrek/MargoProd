import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

type DemoTab = 'operator' | 'specialist' | 'manager'
type DemoFailureStatus = 'new' | 'accepted' | 'resolved' | 'unresolved'

interface DemoResult {
  id: string
  hour: string
  machine: string
  good: number
  reject: number
  comment: string
  rejectComment: string
}

interface DemoFailure {
  id: string
  machine: string
  station: string
  category: string
  priority: string
  description: string
  status: DemoFailureStatus
}

interface DemoState {
  shiftStarted: boolean
  machine: string
  shift: string
  operator: string
  results: DemoResult[]
  failures: DemoFailure[]
}

const STORAGE_KEY = 'margoline_viewer_demo_state'

const initialState: DemoState = {
  shiftStarted: false,
  machine: 'Automat 3',
  shift: 'Zmiana I',
  operator: 'Operator Demo',
  results: [],
  failures: []
}

function loadInitialState(): DemoState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? { ...initialState, ...JSON.parse(raw) } : initialState
  } catch {
    return initialState
  }
}

function statusLabel(status: DemoFailureStatus) {
  if (status === 'accepted') return 'Przyjete przez technika'
  if (status === 'resolved') return 'Rozwiazane'
  if (status === 'unresolved') return 'Nierozwiazane'
  return 'Nowe zgloszenie'
}

function statusClass(status: DemoFailureStatus) {
  if (status === 'resolved') return 'border-green-500/30 bg-green-500/10 text-green-300'
  if (status === 'unresolved') return 'border-red-500/30 bg-red-500/10 text-red-300'
  if (status === 'accepted') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
}

export default function ViewerDemo() {
  const [tab, setTab] = useState<DemoTab>('operator')
  const [state, setState] = useState<DemoState>(() => loadInitialState())
  const [resultForm, setResultForm] = useState({
    hour: '06:00-07:00',
    good: '2850',
    reject: '80',
    comment: 'Produkcja stabilna, drobna regulacja podawania detalu.',
    rejectComment: 'Odrzut po regulacji spadl w kolejnych minutach.'
  })
  const [failureForm, setFailureForm] = useState({
    station: 'Stacja 24',
    category: 'Problem procesu',
    priority: 'Krytyczna',
    description: 'Zaciecie detalu, automat wymaga sprawdzenia prowadzenia elementu.'
  })

  const persist = (next: DemoState) => {
    setState(next)
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  const resetDemo = () => {
    sessionStorage.removeItem(STORAGE_KEY)
    setState(initialState)
    setTab('operator')
  }

  const startShift = () => {
    persist({ ...state, shiftStarted: true })
  }

  const endShift = () => {
    persist({ ...state, shiftStarted: false })
  }

  const addResult = () => {
    const next: DemoResult = {
      id: crypto.randomUUID(),
      hour: resultForm.hour,
      machine: state.machine,
      good: Number(resultForm.good) || 0,
      reject: Number(resultForm.reject) || 0,
      comment: resultForm.comment.trim(),
      rejectComment: resultForm.rejectComment.trim()
    }
    persist({ ...state, results: [...state.results, next] })
  }

  const addFailure = () => {
    const next: DemoFailure = {
      id: crypto.randomUUID(),
      machine: state.machine,
      station: failureForm.station.trim() || 'Stacja',
      category: failureForm.category,
      priority: failureForm.priority,
      description: failureForm.description.trim(),
      status: 'new'
    }
    persist({ ...state, failures: [next, ...state.failures] })
  }

  const updateFailure = (id: string, status: DemoFailureStatus) => {
    persist({
      ...state,
      failures: state.failures.map(failure => failure.id === id ? { ...failure, status } : failure)
    })
  }

  const totals = useMemo(() => {
    const good = state.results.reduce((sum, row) => sum + row.good, 0)
    const reject = state.results.reduce((sum, row) => sum + row.reject, 0)
    const total = good + reject
    const rejectPct = total ? Math.round((reject / total) * 1000) / 10 : 0
    const epq = Math.round((good / Math.max(state.results.length * 3200, 1)) * 100)
    return { good, reject, total, rejectPct, epq }
  }, [state.results])

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-brand/25 bg-navy-800 p-5 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-brand">Konto goscia</div>
            <h1 className="mt-1 text-2xl font-bold text-white">Demo systemu MargoLine</h1>
            <p className="mt-1 max-w-3xl text-sm text-navy-300">
              Tryb pokazowy pokazuje prace operatora, reakcje technika i widok kierownika bez zapisu do Supabase.
              Dane znikaja po wylogowaniu albo po uzyciu resetu.
            </p>
          </div>
          <button onClick={resetDemo} className="btn-secondary px-5 py-3">
            Wyczyść demo
          </button>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        {[
          { label: 'Produkcja', value: `${totals.good.toLocaleString('pl-PL')} szt`, sub: 'dobrych sztuk' },
          { label: 'Odrzut', value: `${totals.rejectPct}%`, sub: `${totals.reject.toLocaleString('pl-PL')} szt` },
          { label: 'W EPQ', value: `${totals.epq}%`, sub: 'cel 3200 szt/h' },
          { label: 'Awarie', value: state.failures.length, sub: 'zgloszenia demo' }
        ].map(card => (
          <div key={card.label} className="rounded-2xl border border-navy-600 bg-navy-800 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400">{card.label}</div>
            <div className="mt-2 text-2xl font-black text-white">{card.value}</div>
            <div className="mt-1 text-sm text-navy-400">{card.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-navy-700 bg-navy-800 p-2">
        {[
          ['operator', 'Jak pracuje operator'],
          ['specialist', 'Jak widzi technik'],
          ['manager', 'Jak kontroluje kierownik']
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key as DemoTab)}
            className={cn(
              'rounded-xl px-4 py-2 text-sm font-bold transition-all',
              tab === key ? 'bg-brand text-navy-950 shadow-lg' : 'text-navy-300 hover:bg-navy-700 hover:text-white'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'operator' && (
        <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
          <div className="rounded-2xl border border-navy-600 bg-navy-800 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="card-title">Stanowisko operatora</div>
                <p className="mt-1 text-sm text-navy-400">{state.machine} - {state.shift} - {state.operator}</p>
              </div>
              <span className={cn(
                'rounded-full border px-3 py-1 text-xs font-bold',
                state.shiftStarted ? 'border-green-500/30 bg-green-500/10 text-green-300' : 'border-navy-600 bg-navy-900 text-navy-300'
              )}>
                {state.shiftStarted ? 'Zmiana aktywna' : 'Zmiana nieaktywna'}
              </span>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={startShift} className="btn-primary px-5 py-3">Rozpocznij zmianę</button>
              <button onClick={endShift} className="btn-secondary px-5 py-3">Zakończ zmianę</button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="label">Blok godziny</span>
                <select className="input" value={resultForm.hour} onChange={e => setResultForm({ ...resultForm, hour: e.target.value })}>
                  {['06:00-07:00','07:00-08:00','08:00-09:00','09:00-10:00','10:00-11:00','11:00-12:00','12:00-13:00','13:00-14:00'].map(hour => (
                    <option key={hour} value={hour}>{hour}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Sztuki dobre</span>
                <input className="input" value={resultForm.good} onChange={e => setResultForm({ ...resultForm, good: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">Odrzut</span>
                <input className="input" value={resultForm.reject} onChange={e => setResultForm({ ...resultForm, reject: e.target.value })} />
              </label>
            </div>
            <label className="mt-4 block">
              <span className="label">Komentarz do wyniku</span>
              <textarea className="input min-h-[88px]" value={resultForm.comment} onChange={e => setResultForm({ ...resultForm, comment: e.target.value })} />
            </label>
            <label className="mt-4 block">
              <span className="label">Komentarz do odrzutu</span>
              <textarea className="input min-h-[88px]" value={resultForm.rejectComment} onChange={e => setResultForm({ ...resultForm, rejectComment: e.target.value })} />
            </label>
            <button onClick={addResult} className="btn-primary mt-4 w-full py-3">Zapisz wynik demo</button>
          </div>

          <div className="rounded-2xl border border-navy-600 bg-navy-800 p-5">
            <div className="card-title">Zgloszenie awarii</div>
            <p className="mt-1 text-sm text-navy-400">Pokazuje, jak operator opisuje problem dla technika.</p>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="label">Stacja</span>
                <input className="input" value={failureForm.station} onChange={e => setFailureForm({ ...failureForm, station: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">Kategoria</span>
                <select className="input" value={failureForm.category} onChange={e => setFailureForm({ ...failureForm, category: e.target.value })}>
                  {['Problem procesu','Awaria mechaniczna','Awaria elektryczna','Problem jakosciowy'].map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Pilnosc</span>
                <select className="input" value={failureForm.priority} onChange={e => setFailureForm({ ...failureForm, priority: e.target.value })}>
                  {['Krytyczna','Wysoka','Normalna'].map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Opis</span>
                <textarea className="input min-h-[120px]" value={failureForm.description} onChange={e => setFailureForm({ ...failureForm, description: e.target.value })} />
              </label>
              <button onClick={addFailure} className="btn-primary w-full py-3">Zglos awarie demo</button>
            </div>
          </div>
        </section>
      )}

      {tab === 'specialist' && (
        <section className="rounded-2xl border border-navy-600 bg-navy-800 p-5">
          <div className="card-title">Panel technika - rejestr awarii</div>
          <p className="mt-1 text-sm text-navy-400">Technik widzi zgloszenia, przyjmuje temat i oznacza efekt pracy.</p>
          <div className="mt-5 grid gap-4">
            {state.failures.length === 0 && <div className="rounded-xl border border-navy-700 bg-navy-900 p-5 text-navy-400">Brak zgloszen. Dodaj awarie w widoku operatora.</div>}
            {state.failures.map(failure => (
              <div key={failure.id} className="rounded-2xl border border-navy-700 bg-navy-900 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-lg font-bold text-white">{failure.machine} - {failure.station}</div>
                    <div className="mt-1 text-sm text-navy-400">{failure.category} - {failure.priority}</div>
                    <p className="mt-3 max-w-3xl text-sm leading-relaxed text-navy-200">{failure.description}</p>
                  </div>
                  <span className={cn('rounded-full border px-3 py-1 text-xs font-bold', statusClass(failure.status))}>
                    {statusLabel(failure.status)}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => updateFailure(failure.id, 'accepted')} className="btn-secondary px-4 py-2">Przyjmij</button>
                  <button onClick={() => updateFailure(failure.id, 'resolved')} className="btn-primary px-4 py-2">Rozwiazane</button>
                  <button onClick={() => updateFailure(failure.id, 'unresolved')} className="btn-danger px-4 py-2">Nierozwiazane</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'manager' && (
        <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
          <div className="rounded-2xl border border-navy-600 bg-navy-800 p-5">
            <div className="card-title">Przebieg zmiany</div>
            <p className="mt-1 text-sm text-navy-400">Kierownik widzi wynik, komentarze i miejsca wymagajace reakcji.</p>
            <div className="mt-5 space-y-3">
              {state.results.length === 0 && <div className="rounded-xl border border-navy-700 bg-navy-900 p-5 text-navy-400">Brak wpisow. Dodaj wynik w widoku operatora.</div>}
              {state.results.map(result => {
                const total = result.good + result.reject
                const rejectPct = total ? Math.round((result.reject / total) * 1000) / 10 : 0
                const epq = Math.round((result.good / 3200) * 100)
                return (
                  <div key={result.id} className="rounded-2xl border border-navy-700 bg-navy-900 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="font-bold text-white">{result.hour} - {result.machine}</div>
                      <div className="flex gap-2 text-sm font-bold">
                        <span className="text-green-400">{result.good} szt</span>
                        <span className={rejectPct > 5 ? 'text-red-400' : 'text-amber-400'}>{rejectPct}% odrz.</span>
                        <span className={epq >= 90 ? 'text-green-400' : epq >= 70 ? 'text-amber-400' : 'text-red-400'}>{epq}% W EPQ</span>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <div className="rounded-xl bg-navy-800 p-3 text-sm text-navy-200"><b>Wynik:</b> {result.comment || '-'}</div>
                      <div className="rounded-xl bg-navy-800 p-3 text-sm text-navy-200"><b>Odrzut:</b> {result.rejectComment || '-'}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-navy-600 bg-navy-800 p-5">
            <div className="card-title">Sugestie kierownika</div>
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-brand/25 bg-brand/10 p-4">
                <div className="font-bold text-white">Weryfikuj odrzut powyzej 5%</div>
                <p className="mt-1 text-sm text-navy-300">System oddziela komentarz do wyniku od komentarza do odrzutu, zeby raport byl czytelny.</p>
              </div>
              <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
                <div className="font-bold text-white">Technik widzi status problemu</div>
                <p className="mt-1 text-sm text-navy-300">Awaria moze byc przyjeta, rozwiazana albo oznaczona jako nierozwiazana.</p>
              </div>
              <div className="rounded-2xl border border-green-500/25 bg-green-500/10 p-4">
                <div className="font-bold text-white">Demo jest bezpieczne</div>
                <p className="mt-1 text-sm text-navy-300">Klikanie nie zmienia danych produkcyjnych. To material do prezentacji procesu.</p>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
