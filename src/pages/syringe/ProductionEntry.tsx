import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSyringeSession } from '@/hooks/useSyringeSession'
import { useSyringeCommand } from '@/hooks/useSyringeCommand'
import { invalidateSyringe } from '@/lib/syringeApi'
import SyringeSessionState from '@/components/shared/SyringeSessionState'
import { useAuthStore } from '@/stores/authStore'
import { syringeRate, wholeQuantity } from '@/lib/syringeMetrics'
import type { SaProductionEntry, SaDefectCategory } from '@/types/database'

async function fetchLastEntry(sessionId: string) {
  const { data, error } = await supabase
    .from('sa_production_entries')
    .select('*, defect_entries:sa_defect_entries(*)')
    .eq('session_id', sessionId)
    .eq('is_cancelled', false)
    .order('recorded_at', { ascending: false })
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(2)
  if (error) throw error
  return (data ?? []) as SaProductionEntry[]
}

async function fetchEntryCount(sessionId: string) {
  const { count, error } = await supabase
    .from('sa_production_entries')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('is_cancelled', false)
  if (error) throw error
  return count ?? 0
}

async function fetchDefectCategories() {
  const { data, error } = await supabase
    .from('sa_defect_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw error
  return data as SaDefectCategory[] ?? []
}

interface DefectRow {
  category_id: string
  qty: string
  notes: string
}

export default function SyringeProductionEntry() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const command = useSyringeCommand()
  const [search] = useSearchParams()
  const editing = search.get('edit') === 'last'
  const initializedEdit = useRef<string>()
  const [correctionReason, setCorrectionReason] = useState('')

  const [counterPrintValue, setCounterPrintValue] = useState('')
  const [counterPrintReset, setCounterPrintReset] = useState(false)
  const [counterPrintResetReason, setCounterPrintResetReason] = useState('')
  const [counterAssemblyValue, setCounterAssemblyValue] = useState('')
  const [counterAssemblyReset, setCounterAssemblyReset] = useState(false)
  const [counterAssemblyResetReason, setCounterAssemblyResetReason] = useState('')
  const [notes, setNotes] = useState('')
  const [defects, setDefects] = useState<DefectRow[]>([])
  const [errors, setErrors] = useState<string[]>([])

  const { data: session, isLoading, error: sessionError, refetch: refetchSession } = useSyringeSession()

  const { data: recentEntries = [], isLoading: lastLoading, error: lastError, refetch: refetchLast } = useQuery({
    queryKey: ['sa_recent_counters', session?.id],
    queryFn: () => fetchLastEntry(session!.id),
    enabled: !!session?.id
  })

  const { data: entryCount = 0, isLoading: countLoading, error: countError } = useQuery({
    queryKey: ['sa_entry_count', session?.id],
    queryFn: () => fetchEntryCount(session!.id),
    enabled: !!session?.id
  })

  const { data: defectCategories = [], error: categoriesError } = useQuery({
    queryKey: ['sa_defect_categories'],
    queryFn: fetchDefectCategories
  })

  const currentEntry = editing ? recentEntries[0] : null
  const lastEntry = recentEntries[editing ? 1 : 0] ?? null
  useEffect(() => {
    if (!currentEntry || initializedEdit.current === currentEntry.id) return
    initializedEdit.current = currentEntry.id
    setCounterPrintValue(String(currentEntry.counter_print_value ?? currentEntry.counter_value))
    setCounterAssemblyValue(String(currentEntry.counter_assembly_value ?? currentEntry.counter_value))
    setCounterPrintReset(currentEntry.counter_print_reset)
    setCounterAssemblyReset(currentEntry.counter_assembly_reset)
    setCounterPrintResetReason(currentEntry.counter_print_reset_reason ?? '')
    setCounterAssemblyResetReason(currentEntry.counter_assembly_reset_reason ?? '')
    setNotes(currentEntry.notes ?? '')
    setDefects((currentEntry.defect_entries ?? []).map(d => ({ category_id: d.category_id, qty: String(d.qty), notes: d.notes ?? '' })))
  }, [currentEntry])

  const printNum = parseInt(counterPrintValue || '0')
  const assemblyNum = parseInt(counterAssemblyValue || '0')
  const lastPrintCounter = lastEntry?.counter_print_value ?? lastEntry?.counter_value ?? 0
  const lastAssemblyCounter = lastEntry?.counter_assembly_value ?? lastEntry?.counter_value ?? 0

  const printDelta = counterPrintValue
    ? (counterPrintReset ? printNum : printNum - lastPrintCounter)
    : null
  const assemblyDelta = counterAssemblyValue
    ? (counterAssemblyReset ? assemblyNum : assemblyNum - lastAssemblyCounter)
    : null

  const goodQty = assemblyDelta !== null && assemblyDelta >= 0 ? String(assemblyDelta) : ''
  const producedQty = printDelta !== null && printDelta > 0 ? printDelta : 0
  const rejectQty = printDelta !== null && assemblyDelta !== null
    ? String(Math.max(0, printDelta - assemblyDelta))
    : ''

  const perHour = lastEntry && assemblyDelta !== null && assemblyDelta >= 0
    ? syringeRate(assemblyDelta, (currentEntry ? new Date(currentEntry.recorded_at).getTime() : Date.now()) - new Date(lastEntry.recorded_at).getTime())
    : null

  const planQty = session?.plan_qty ?? 0
  const sessionGood = (session?.total_good ?? 0) - (currentEntry?.good_qty ?? 0)
  const planPct = planQty > 0 ? Math.round((sessionGood + parseInt(goodQty || '0')) / planQty * 100) : null

  const allocatedQty = defects.reduce((sum, d) => sum + (parseInt(d.qty) || 0), 0)
  const remainingToAllocate = parseInt(rejectQty || '0') - allocatedQty

  function addDefectRow(catId: string) {
    if (defects.find(d => d.category_id === catId)) return
    // Podpowiadamy od razu ilość, jaka została do rozliczenia — operator ją
    // koryguje, jeśli dana kategoria nie wyjaśnia wszystkich pozostałych braków.
    const suggested = Math.max(0, remainingToAllocate)
    setDefects(prev => [...prev, { category_id: catId, qty: suggested > 0 ? String(suggested) : '', notes: '' }])
  }

  function updateDefectRow(catId: string, field: 'qty' | 'notes', value: string) {
    setDefects(prev => prev.map(d => d.category_id === catId ? { ...d, [field]: value } : d))
  }

  function removeDefectRow(catId: string) {
    setDefects(prev => prev.filter(d => d.category_id !== catId))
  }

  function validate(): string[] {
    const errs: string[] = []
    if (editing && (!currentEntry || !correctionReason.trim())) errs.push('Podaj powód korekty ostatniego wpisu.')
    if (!editing && entryCount >= 8) errs.push('W tej zmianie zapisano już 8 wpisów produkcji. Możesz skorygować ostatni wpis albo zakończyć zmianę.')
    if (!wholeQuantity(counterPrintValue) || !wholeQuantity(counterAssemblyValue)) errs.push('Liczniki muszą być nieujemnymi liczbami całkowitymi.')
    if (allocatedQty !== Number(rejectQty || 0)) errs.push('Suma kategorii musi odpowiadać liczbie braków, również gdy braki wynoszą zero.')
    if (!counterPrintValue) errs.push('Nie wpisano stanu licznika automatu drukującego.')
    if (!counterAssemblyValue) errs.push('Nie wpisano stanu licznika automatu montującego.')
    if (printNum < 0) errs.push('Stan licznika druku nie może być ujemny.')
    if (assemblyNum < 0) errs.push('Stan licznika montażu nie może być ujemny.')
    if (!counterPrintReset && counterPrintValue && printNum < lastPrintCounter)
      errs.push(`Licznik druku (${printNum}) jest mniejszy niż poprzedni stan (${lastPrintCounter}). Jeśli licznik był zerowany — zaznacz "Zerowanie licznika".`)
    if (!counterAssemblyReset && counterAssemblyValue && assemblyNum < lastAssemblyCounter)
      errs.push(`Licznik montażu (${assemblyNum}) jest mniejszy niż poprzedni stan (${lastAssemblyCounter}). Jeśli licznik był zerowany — zaznacz "Zerowanie licznika".`)
    if (counterPrintReset && !counterPrintResetReason.trim()) errs.push('Podaj uzasadnienie zerowania licznika druku.')
    if (counterAssemblyReset && !counterAssemblyResetReason.trim()) errs.push('Podaj uzasadnienie zerowania licznika montażu.')
    if (printDelta !== null && assemblyDelta !== null && assemblyDelta > printDelta)
      errs.push('Montaż nie może być większy niż druk — sprawdź stany liczników.')
    if (printDelta !== null && printDelta < 0) errs.push('Ujemny przyrost licznika druku — sprawdź wpisaną wartość.')
    if (assemblyDelta !== null && assemblyDelta < 0) errs.push('Ujemny przyrost licznika montażu — sprawdź wpisaną wartość.')

    for (const d of defects) {
      const cat = defectCategories.find(c => c.id === d.category_id)
      if (cat?.requires_comment && !d.notes.trim())
        errs.push(`Kategoria "${cat.name}" wymaga komentarza.`)
      if (!wholeQuantity(d.qty) || Number(d.qty) <= 0)
        errs.push(`Podaj ilość dla kategorii braków: ${cat?.name ?? '—'}.`)
    }

    const rejectN = parseInt(rejectQty || '0')
    if (rejectN > 0) {
      if (defects.length === 0) errs.push('Rozlicz braki na kategorie — nie dodano żadnej kategorii.')
      else if (remainingToAllocate > 0) errs.push(`Rozlicz wszystkie braki na kategorie — zostało ${remainingToAllocate} szt do przypisania.`)
      else if (remainingToAllocate < 0) errs.push(`Suma przypisanych kategorii przekracza całkowite braki o ${Math.abs(remainingToAllocate)} szt.`)
    }
    return errs
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!session || !profile) throw new Error('Brak aktywnej sesji.')
      const errs = validate()
      if (errs.length > 0) { setErrors(errs); throw new Error('Popraw błędy walidacji.') }

      await command(editing ? 'production_edit' : 'production', {
        session_id: session.id,
        last_entry_id: recentEntries[0]?.id ?? null,
        correction_reason: editing ? correctionReason.trim() : null,
        print: counterPrintValue,
        assembly: counterAssemblyValue,
        print_reset: counterPrintReset,
        print_reset_reason: counterPrintReset ? counterPrintResetReason.trim() : null,
        assembly_reset: counterAssemblyReset,
        assembly_reset_reason: counterAssemblyReset ? counterAssemblyResetReason.trim() : null,
        defects: defects.map(d => ({ ...d, qty: Number(d.qty), notes: d.notes.trim() })),
        notes: notes.trim() || null
      })
    },
    onSuccess: () => {
      void invalidateSyringe(qc)
      navigate('/syringe')
    },
    onError: (e: Error) => {
      if (e.message !== 'Popraw błędy walidacji.') {
        setErrors([e.message])
        if (e.message.includes('W międzyczasie')) void refetchLast()
      }
    }
  })

  if (!session || sessionError) {
    return <SyringeSessionState loading={isLoading} error={sessionError} retry={refetchSession} />
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-2">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/syringe')} className="text-navy-400 hover:text-white">←</button>
        <div>
          <h1 className="text-xl font-bold text-white">{editing ? 'Korekta ostatniego wpisu' : 'Rejestracja produkcji'}</h1>
          <p className="text-navy-400 text-sm">{session.machine?.name} · {session.assortment?.name}</p>
        </div>
      </div>

      {(lastError || categoriesError || countError) && <div role="alert" className="text-red-400">
        Nie udało się odczytać danych: {lastError?.message || categoriesError?.message || countError?.message}
        <button className="btn-secondary ml-2" onClick={() => invalidateSyringe(qc)}>Ponów odczyt</button>
      </div>}
      {errors.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
        </div>
      )}

      {lastEntry && (
        <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-4 text-sm">
          <div className="text-xs uppercase tracking-wider text-navy-500 mb-2">Poprzedni wpis</div>
          <div className="flex gap-6 text-navy-300 flex-wrap">
            <span>Druk: <strong className="text-white">{(lastEntry.counter_print_value ?? lastEntry.counter_value).toLocaleString('pl')}</strong></span>
            <span>Montaż: <strong className="text-white">{(lastEntry.counter_assembly_value ?? lastEntry.counter_value).toLocaleString('pl')}</strong></span>
            <span>Dobre: <strong className="text-white">{lastEntry.good_qty.toLocaleString('pl')}</strong></span>
            <span>Godz: <strong className="text-white">{new Date(lastEntry.recorded_at).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}</strong></span>
          </div>
        </div>
      )}

      <div className={`rounded-xl border p-4 text-sm ${entryCount >= 8 && !editing ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-navy-700 bg-navy-800/50 text-navy-300'}`}>
        <div className="flex items-center justify-between gap-3">
          <span>Wpisy produkcji w tej zmianie</span>
          <strong className="text-white text-base">{entryCount}/8</strong>
        </div>
        <p className="mt-1 text-xs text-navy-400">
          System pozwala zapisać 8 wyników w trakcie zmiany. Nie wymusza konkretnej godziny wpisu.
        </p>
      </div>

      {/* Liczniki */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Stan licznika — automat drukujący</div>
        <input
          aria-label="Licznik druku"
          type="number"
          value={counterPrintValue}
          onChange={e => { setCounterPrintValue(e.target.value); setErrors([]) }}
          placeholder="np. 123456"
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-4 text-2xl font-bold text-white placeholder-navy-600 focus:outline-none focus:border-brand"
          min={0}
        />
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={counterPrintReset}
            onChange={e => { setCounterPrintReset(e.target.checked); setErrors([]) }}
            className="w-5 h-5 rounded accent-brand"
          />
          <span className="text-sm text-navy-300">Licznik był zerowany / wymieniony</span>
        </label>
        {counterPrintReset && (
          <input
            type="text"
            value={counterPrintResetReason}
            onChange={e => setCounterPrintResetReason(e.target.value)}
            placeholder="Podaj uzasadnienie zerowania licznika (wymagane)"
            className="w-full bg-navy-900 border border-amber-500/50 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500"
          />
        )}
        {printDelta !== null && (
          <div className="text-xs text-navy-500">
            Przyrost od poprzedniego wpisu: <strong className="text-white">{printDelta.toLocaleString('pl')} szt</strong>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Stan licznika — automat montujący</div>
        <input
          aria-label="Licznik montażu"
          type="number"
          value={counterAssemblyValue}
          onChange={e => { setCounterAssemblyValue(e.target.value); setErrors([]) }}
          placeholder="np. 123000"
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-4 text-2xl font-bold text-white placeholder-navy-600 focus:outline-none focus:border-brand"
          min={0}
        />
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={counterAssemblyReset}
            onChange={e => { setCounterAssemblyReset(e.target.checked); setErrors([]) }}
            className="w-5 h-5 rounded accent-brand"
          />
          <span className="text-sm text-navy-300">Licznik był zerowany / wymieniony</span>
        </label>
        {counterAssemblyReset && (
          <input
            type="text"
            value={counterAssemblyResetReason}
            onChange={e => setCounterAssemblyResetReason(e.target.value)}
            placeholder="Podaj uzasadnienie zerowania licznika (wymagane)"
            className="w-full bg-navy-900 border border-amber-500/50 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500"
          />
        )}
        {assemblyDelta !== null && (
          <div className="text-xs text-navy-500">
            Przyrost od poprzedniego wpisu: <strong className="text-white">{assemblyDelta.toLocaleString('pl')} szt</strong>
          </div>
        )}
      </div>

      {/* Ilości (obliczane automatycznie z różnicy liczników) */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Ilości (obliczone: druk − montaż = braki)</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-navy-400 mb-2 block">Sztuki dobre (montaż)</label>
            <div className="w-full bg-navy-900 border border-navy-700 rounded-xl px-4 py-3 text-xl font-bold text-green-400">
              {goodQty ? parseInt(goodQty).toLocaleString('pl') : '—'}
            </div>
          </div>
          <div>
            <label className="text-sm text-navy-400 mb-2 block">Braki łącznie (druk − montaż)</label>
            <div className="w-full bg-navy-900 border border-navy-700 rounded-xl px-4 py-3 text-xl font-bold text-red-400">
              {rejectQty ? parseInt(rejectQty).toLocaleString('pl') : '—'}
            </div>
          </div>
        </div>

        {/* Obliczenia na bieżąco */}
        {(goodQty || rejectQty) && (
          <div className="rounded-xl bg-navy-900 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-navy-500">Wyprodukowano</div>
              <div className="font-bold text-white">{producedQty.toLocaleString('pl')}</div>
            </div>
            {rejectQty && parseInt(rejectQty) > 0 && (
              <div>
                <div className="text-navy-500">% braków</div>
                <div className={`font-bold ${parseInt(rejectQty) / producedQty > 0.05 ? 'text-red-400' : 'text-white'}`}>
                  {(parseInt(rejectQty) / producedQty * 100).toFixed(1)}%
                </div>
              </div>
            )}
            {perHour !== null ? (
              <div>
                <div className="text-navy-500">Wydajność</div>
                <div className="font-bold text-white">{perHour.toLocaleString('pl')} szt/h</div>
              </div>
            ) : (
              <div>
                <div className="text-navy-500">Wydajność</div>
                <div className="font-bold text-navy-500 text-xs leading-snug">
                  {!lastEntry ? 'dostępna od kolejnego wpisu' : 'krótki odstęp, bez blokady zapisu'}
                </div>
              </div>
            )}
            {planPct !== null && (
              <div>
                <div className="text-navy-500">Plan</div>
                <div className={`font-bold ${planPct >= 100 ? 'text-green-400' : 'text-white'}`}>{planPct}%</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Kategorie braków */}
      {(parseInt(rejectQty || '0') > 0 || defects.length > 0) && (
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Kategorie braków</div>
            <div className={`text-sm font-bold ${
              remainingToAllocate === 0 ? 'text-green-400' : remainingToAllocate < 0 ? 'text-red-400' : 'text-amber-400'
            }`}>
              {remainingToAllocate === 0
                ? `✓ Rozliczone ${allocatedQty.toLocaleString('pl')} / ${rejectQty} szt`
                : remainingToAllocate < 0
                  ? `Przekroczono o ${Math.abs(remainingToAllocate).toLocaleString('pl')} szt`
                  : `Zostało do przypisania: ${remainingToAllocate.toLocaleString('pl')} szt`}
            </div>
          </div>

          <div className="h-2 bg-navy-900 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${remainingToAllocate < 0 ? 'bg-red-500' : remainingToAllocate === 0 ? 'bg-green-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(100, parseInt(rejectQty || '0') > 0 ? allocatedQty / parseInt(rejectQty) * 100 : 0)}%` }}
            />
          </div>

          {defects.map(d => {
            const cat = defectCategories.find(c => c.id === d.category_id)
            return (
              <div key={d.category_id} className="rounded-xl border border-navy-600 bg-navy-900 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{cat?.name}</span>
                  <button onClick={() => removeDefectRow(d.category_id)} className="text-navy-500 hover:text-red-400 text-lg">×</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    value={d.qty}
                    onChange={e => updateDefectRow(d.category_id, 'qty', e.target.value)}
                    placeholder="Ilość"
                    min={1}
                    className="bg-navy-800 border border-navy-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand"
                  />
                  <input
                    type="text"
                    value={d.notes}
                    onChange={e => updateDefectRow(d.category_id, 'notes', e.target.value)}
                    placeholder={cat?.requires_comment ? 'Komentarz (wymagany)' : 'Komentarz'}
                    className={`bg-navy-800 border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand ${cat?.requires_comment ? 'border-amber-500/50' : 'border-navy-600'}`}
                  />
                </div>
              </div>
            )
          })}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {defectCategories
              .filter(cat => !defects.find(d => d.category_id === cat.id))
              .map(cat => (
                <button
                  key={cat.id}
                  onClick={() => addDefectRow(cat.id)}
                  className="rounded-lg border border-navy-600 px-3 py-2 text-xs text-navy-300 hover:border-navy-500 hover:text-white text-left transition-all"
                >
                  + {cat.name}
                </button>
              ))
            }
          </div>
        </div>
      )}

      {editing && <label className="block">Powód korekty
        <input aria-label="Powód korekty" value={correctionReason} onChange={e => setCorrectionReason(e.target.value)}
          className="w-full bg-navy-900 border border-navy-600 rounded-lg px-4 py-3 mt-2" />
      </label>}
      {/* Komentarz */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Komentarz operatora</div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Uwagi do bieżącej rejestracji (opcjonalne)..."
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-brand resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/syringe')} className="btn-secondary py-4">Anuluj</button>
        <button
          onClick={() => { setErrors([]); saveMutation.mutate() }}
          disabled={saveMutation.isPending || lastLoading || countLoading || !!lastError || !!categoriesError || !!countError || (!editing && entryCount >= 8)}
          className="py-4 rounded-2xl bg-brand text-navy-900 font-bold text-lg disabled:opacity-40 hover:bg-brand/90 transition-all"
        >
          {saveMutation.isPending ? 'Zapisywanie...' : editing ? 'Zapisz korektę' : 'Zapisz produkcję'}
        </button>
      </div>
    </div>
  )
}
