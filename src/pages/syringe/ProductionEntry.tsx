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
import { isShiftSettlementAssortment } from '@/lib/syringeSettlement'
import { useClock } from '@/hooks/useClock'
import { formatHourBlock, SHIFT_HOURS } from '@/lib/utils'
import type { SaProductionEntry, SaDefectCategory, ShiftType } from '@/types/database'

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
  const { now } = useClock()
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
  const [finalGoodQty, setFinalGoodQty] = useState('')
  const [finalRejectQty, setFinalRejectQty] = useState('')
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
  const isShiftSettlementMode = isShiftSettlementAssortment(session?.assortment?.code)
  useEffect(() => {
    if (!currentEntry || initializedEdit.current === currentEntry.id) return
    initializedEdit.current = currentEntry.id
    setCounterPrintValue(String(currentEntry.counter_print_value ?? currentEntry.counter_value))
    setCounterAssemblyValue(String(currentEntry.counter_assembly_value ?? currentEntry.counter_value))
    setFinalGoodQty(String(currentEntry.good_qty ?? ''))
    setFinalRejectQty(String(currentEntry.reject_qty ?? ''))
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

  const finalGoodNum = wholeQuantity(finalGoodQty) ? Number(finalGoodQty) : 0
  const finalRejectNum = wholeQuantity(finalRejectQty) ? Number(finalRejectQty) : 0
  const finalProducedQty = finalGoodNum + finalRejectNum
  const counterGoodQty = assemblyDelta !== null && assemblyDelta >= 0 ? String(assemblyDelta) : ''
  const counterProducedQty = printDelta !== null && printDelta > 0 ? printDelta : 0
  const counterRejectQty = printDelta !== null && assemblyDelta !== null
    ? String(Math.max(0, printDelta - assemblyDelta))
    : ''
  const goodQty = isShiftSettlementMode ? finalGoodQty : counterGoodQty
  const producedQty = isShiftSettlementMode ? finalProducedQty : counterProducedQty
  const rejectQty = isShiftSettlementMode ? finalRejectQty : counterRejectQty

  const perHour = !isShiftSettlementMode && lastEntry && assemblyDelta !== null && assemblyDelta >= 0
    ? syringeRate(assemblyDelta, (currentEntry ? new Date(currentEntry.recorded_at).getTime() : Date.now()) - new Date(lastEntry.recorded_at).getTime())
    : null

  const planQty = session?.plan_qty ?? 0
  const sessionGood = (session?.total_good ?? 0) - (currentEntry?.good_qty ?? 0)
  const goodTotalForPreview = wholeQuantity(goodQty) ? Number(goodQty) : 0
  const planPct = planQty > 0 ? Math.round((sessionGood + goodTotalForPreview) / planQty * 100) : null
  const nominalPerHour = session?.assortment?.nominal_per_hour ?? session?.machine?.nominal_per_hour ?? 0
  const entryReferenceMs = currentEntry ? new Date(currentEntry.recorded_at).getTime() : Date.now()
  const entryStartMs = lastEntry ? new Date(lastEntry.recorded_at).getTime() : new Date(session?.started_at ?? Date.now()).getTime()
  const entryElapsedMs = Math.max(0, entryReferenceMs - entryStartMs)
  const entryElapsedHours = entryElapsedMs / 3600000
  const expectedGoodQty = isShiftSettlementMode
    ? planQty
    : nominalPerHour > 0 && entryElapsedMs >= 45 * 60000
      ? Math.round(nominalPerHour * entryElapsedHours)
      : 0
  const belowExpectedOutput = expectedGoodQty > 0 && goodTotalForPreview < expectedGoodQty
  const missingExpectedQty = belowExpectedOutput ? expectedGoodQty - goodTotalForPreview : 0

  const allocatedQty = defects.reduce((sum, d) => sum + (parseInt(d.qty) || 0), 0)
  const rejectTotal = wholeQuantity(rejectQty) ? Number(rejectQty) : 0
  const remainingToAllocate = rejectTotal - allocatedQty
  const allocationPct = rejectTotal > 0 ? Math.min(100, Math.max(0, allocatedQty / rejectTotal * 100)) : 0
  const entryLimit = isShiftSettlementMode ? 1 : 8
  const entryLimitReached = !editing && entryCount >= entryLimit
  const liveReferenceMs = currentEntry ? new Date(currentEntry.recorded_at).getTime() : now.getTime()
  const shiftElapsedMin = Math.max(0, Math.floor((liveReferenceMs - new Date(session?.started_at ?? now).getTime()) / 60000))
  const entryElapsedMin = Math.max(0, Math.floor((liveReferenceMs - entryStartMs) / 60000))
  const currentHourNo = editing ? Math.max(1, entryCount) : Math.min(entryLimit, entryCount + 1)
  const completedHours = Math.min(entryLimit, entryCount)
  const remainingHours = Math.max(0, entryLimit - completedHours)
  const minutesToNextEntry = Math.max(0, 60 - entryElapsedMin)
  const fmtMin = (value: number) => `${Math.floor(value / 60)}h ${value % 60}m`
  const shiftHours = session ? (SHIFT_HOURS[session.shift_type as ShiftType] ?? []) : []
  const currentHourStart = shiftHours[Math.min(Math.max(0, currentHourNo - 1), Math.max(0, shiftHours.length - 1))]
  const currentHourBlock = currentHourStart !== undefined ? formatHourBlock(currentHourStart) : null
  const missingBlockLabels = isShiftSettlementMode
    ? []
    : shiftHours.slice(Math.min(entryCount, shiftHours.length)).map(formatHourBlock)

  function addDefectRow(catId: string) {
    if (defects.find(d => d.category_id === catId)) return
    setDefects(prev => [...prev, { category_id: catId, qty: '', notes: '' }])
    setErrors([])
  }

  function updateDefectRow(catId: string, field: 'qty' | 'notes', value: string) {
    setDefects(prev => prev.map(d => d.category_id === catId ? { ...d, [field]: value } : d))
    setErrors([])
  }

  function setDefectQty(catId: string, value: number) {
    const next = Math.max(0, Math.floor(value))
    setDefects(prev => prev.map(d => d.category_id === catId ? { ...d, qty: next > 0 ? String(next) : '' } : d))
    setErrors([])
  }

  function assignRemainingToDefect(catId: string) {
    const current = parseInt(defects.find(d => d.category_id === catId)?.qty || '0') || 0
    const otherAllocated = allocatedQty - current
    setDefectQty(catId, Math.max(0, rejectTotal - otherAllocated))
  }

  function splitRemainingAcrossDefects() {
    if (remainingToAllocate <= 0 || defects.length === 0) return
    const base = Math.floor(remainingToAllocate / defects.length)
    const extra = remainingToAllocate % defects.length
    setDefects(prev => prev.map((d, index) => {
      const current = parseInt(d.qty || '0') || 0
      const add = base + (index < extra ? 1 : 0)
      return { ...d, qty: String(current + add) }
    }))
    setErrors([])
  }

  function clearDefectQuantities() {
    setDefects(prev => prev.map(d => ({ ...d, qty: '' })))
    setErrors([])
  }

  function removeDefectRow(catId: string) {
    setDefects(prev => prev.filter(d => d.category_id !== catId))
    setErrors([])
  }

  function validate(): string[] {
    const errs: string[] = []
    if (editing && (!currentEntry || !correctionReason.trim())) errs.push('Podaj powód korekty ostatniego wpisu.')
    if (entryLimitReached) {
      errs.push(isShiftSettlementMode
        ? 'Dla asortymentu 50/100 zapisuje się jedno rozliczenie końcowe zmiany. Możesz skorygować ostatni wpis albo zakończyć zmianę.'
        : 'W tej zmianie zapisano już 8 wpisów produkcji. Możesz skorygować ostatni wpis albo zakończyć zmianę.')
    }

    if (isShiftSettlementMode) {
      if (!wholeQuantity(finalGoodQty) || !wholeQuantity(finalRejectQty)) errs.push('Wpisz nieujemne liczby całkowite dla sztuk dobrych i braków.')
      if (wholeQuantity(finalGoodQty) && wholeQuantity(finalRejectQty) && finalProducedQty <= 0)
        errs.push('Wpisz wynik zmiany: sztuki dobre, braki albo oba pola.')
    } else {
      if (!wholeQuantity(counterPrintValue) || !wholeQuantity(counterAssemblyValue)) errs.push('Liczniki muszą być nieujemnymi liczbami całkowitymi.')
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
    }

    if (allocatedQty !== rejectTotal) errs.push('Suma kategorii musi odpowiadać liczbie braków, również gdy braki wynoszą zero.')
    if (belowExpectedOutput && !notes.trim()) {
      errs.push(`Wynik jest poniżej normy o ${missingExpectedQty.toLocaleString('pl')} szt. Podaj przyczynę w komentarzu operatora.`)
    }

    for (const d of defects) {
      const cat = defectCategories.find(c => c.id === d.category_id)
      if (cat?.requires_comment && !d.notes.trim())
        errs.push(`Kategoria "${cat.name}" wymaga komentarza.`)
      if (!wholeQuantity(d.qty) || Number(d.qty) <= 0)
        errs.push(`Podaj ilość dla kategorii braków: ${cat?.name ?? '—'}.`)
    }

    const rejectN = rejectTotal
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
      const payloadPrint = isShiftSettlementMode
        ? String(lastPrintCounter + finalProducedQty)
        : counterPrintValue
      const payloadAssembly = isShiftSettlementMode
        ? String(lastAssemblyCounter + finalGoodNum)
        : counterAssemblyValue

      await command(editing ? 'production_edit' : 'production', {
        session_id: session.id,
        last_entry_id: recentEntries[0]?.id ?? null,
        correction_reason: editing ? correctionReason.trim() : null,
        print: payloadPrint,
        assembly: payloadAssembly,
        print_reset: isShiftSettlementMode ? false : counterPrintReset,
        print_reset_reason: !isShiftSettlementMode && counterPrintReset ? counterPrintResetReason.trim() : null,
        assembly_reset: isShiftSettlementMode ? false : counterAssemblyReset,
        assembly_reset_reason: !isShiftSettlementMode && counterAssemblyReset ? counterAssemblyResetReason.trim() : null,
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
          <h1 className="text-xl font-bold text-white">
            {editing ? 'Korekta ostatniego wpisu' : isShiftSettlementMode ? 'Rozliczenie końcowe zmiany' : 'Rejestracja produkcji'}
          </h1>
          <p className="text-navy-400 text-sm">
            {session.machine?.name} · {session.assortment?.name}
            {isShiftSettlementMode ? ' · wpis na koniec zmiany' : ''}
          </p>
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

      {!isShiftSettlementMode && (
        <div className="rounded-2xl border border-brand/30 bg-brand/5 p-5 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-brand">Licznik godzin</div>
              <div className="mt-1 text-2xl font-bold text-white">
                Godzina {currentHourNo}/{entryLimit}
              </div>
              {currentHourBlock && <div className="mt-1 text-sm font-bold text-brand">{currentHourBlock}</div>}
            </div>
            <div className="rounded-xl border border-navy-700 bg-navy-900 px-4 py-3 text-right">
              <div className="text-xs text-navy-500">zapisane wpisy</div>
              <div className="text-xl font-bold text-brand">{completedHours}/{entryLimit}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-navy-700 bg-navy-900 p-3">
              <div className="text-navy-500">Czas od startu</div>
              <div className="text-white font-bold">{fmtMin(shiftElapsedMin)}</div>
            </div>
            <div className="rounded-xl border border-navy-700 bg-navy-900 p-3">
              <div className="text-navy-500">Od ostatniego wpisu</div>
              <div className={entryElapsedMin >= 60 ? 'text-amber-300 font-bold' : 'text-white font-bold'}>
                {fmtMin(entryElapsedMin)}
              </div>
            </div>
            <div className="rounded-xl border border-navy-700 bg-navy-900 p-3">
              <div className="text-navy-500">Zostało wpisów</div>
              <div className="text-white font-bold">{remainingHours}</div>
            </div>
          </div>
          <div className={`rounded-xl border px-4 py-3 text-sm ${
            entryElapsedMin >= 60
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
              : 'border-navy-700 bg-navy-900 text-navy-300'
          }`}>
            {entryElapsedMin >= 60
              ? 'Ten wpis jest już należny. Zapisz wynik za bieżącą godzinę.'
              : `Do kolejnego wpisu zostało około ${minutesToNextEntry} min.`}
          </div>
          {missingBlockLabels.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-navy-900 p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-300">Brakujące bloki</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {missingBlockLabels.map(label => (
                  <span key={label} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-100">
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {lastEntry && (
        <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-4 text-sm">
          <div className="text-xs uppercase tracking-wider text-navy-500 mb-2">
            {isShiftSettlementMode ? 'Zapisane rozliczenie' : 'Poprzedni wpis'}
          </div>
          <div className="flex gap-6 text-navy-300 flex-wrap">
            {!isShiftSettlementMode && (
              <>
                <span>Druk: <strong className="text-white">{(lastEntry.counter_print_value ?? lastEntry.counter_value).toLocaleString('pl')}</strong></span>
                <span>Montaż: <strong className="text-white">{(lastEntry.counter_assembly_value ?? lastEntry.counter_value).toLocaleString('pl')}</strong></span>
              </>
            )}
            <span>Dobre: <strong className="text-white">{lastEntry.good_qty.toLocaleString('pl')}</strong></span>
            {isShiftSettlementMode && <span>Braki: <strong className="text-white">{lastEntry.reject_qty.toLocaleString('pl')}</strong></span>}
            {isShiftSettlementMode && <span>Razem: <strong className="text-white">{lastEntry.produced_qty.toLocaleString('pl')}</strong></span>}
            <span>Godz: <strong className="text-white">{new Date(lastEntry.recorded_at).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}</strong></span>
          </div>
        </div>
      )}

      <div className={`rounded-xl border p-4 text-sm ${entryLimitReached ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-navy-700 bg-navy-800/50 text-navy-300'}`}>
        <div className="flex items-center justify-between gap-3">
          <span>{isShiftSettlementMode ? 'Rozliczenie zmiany' : 'Wpisy produkcji w tej zmianie'}</span>
          <strong className="text-white text-base">{entryCount}/{entryLimit}</strong>
        </div>
        <p className="mt-1 text-xs text-navy-400">
          {isShiftSettlementMode
            ? 'Dla st 50 i st 100 operator rozpoczyna zmianę normalnie, a wynik wpisuje raz na końcu: dobre sztuki, braki i kategorie braków. Wynik poniżej planu wymaga przyczyny.'
            : 'System pozwala zapisać 8 wyników w trakcie zmiany. Wpisuj wynik co ok. godzinę; wynik poniżej normy wymaga przyczyny.'}
        </p>
      </div>

      {!isShiftSettlementMode && (
        <>
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
        </>
      )}

      {/* Ilości */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">
          {isShiftSettlementMode ? 'Końcowe rozliczenie zmiany' : 'Ilości (obliczone: druk − montaż = braki)'}
        </div>

        {isShiftSettlementMode ? (
          <>
            <div className="rounded-xl border border-brand/30 bg-brand/10 p-4 text-sm text-brand">
              W tym asortymencie nie wpisujesz wyników co kilka godzin. Na koniec zmiany podaj pełny wynik: dobre sztuki i braki łącznie.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label>
                <span className="text-sm text-navy-400 mb-2 block">Sztuki dobre</span>
                <input
                  aria-label="Sztuki dobre na koniec zmiany"
                  type="number"
                  value={finalGoodQty}
                  onChange={e => { setFinalGoodQty(e.target.value); setErrors([]) }}
                  placeholder="np. 18000"
                  className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-4 text-2xl font-bold text-green-400 placeholder-navy-600 focus:outline-none focus:border-brand"
                  min={0}
                />
              </label>
              <label>
                <span className="text-sm text-navy-400 mb-2 block">Braki łącznie</span>
                <input
                  aria-label="Braki na koniec zmiany"
                  type="number"
                  value={finalRejectQty}
                  onChange={e => { setFinalRejectQty(e.target.value); setErrors([]) }}
                  placeholder="np. 320"
                  className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-4 text-2xl font-bold text-red-400 placeholder-navy-600 focus:outline-none focus:border-brand"
                  min={0}
                />
              </label>
            </div>
          </>
        ) : (
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
        )}

        {/* Obliczenia na bieżąco */}
        {(goodQty || rejectQty) && (
          <div className="rounded-xl bg-navy-900 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-navy-500">Wyprodukowano</div>
              <div className="font-bold text-white">{producedQty.toLocaleString('pl')}</div>
            </div>
            {rejectTotal > 0 && producedQty > 0 && (
              <div>
                <div className="text-navy-500">% braków</div>
                <div className={`font-bold ${rejectTotal / producedQty > 0.05 ? 'text-red-400' : 'text-white'}`}>
                  {(rejectTotal / producedQty * 100).toFixed(1)}%
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
                  {isShiftSettlementMode ? 'wynik końcowy zmiany' : !lastEntry ? 'dostępna od kolejnego wpisu' : 'krótki odstęp, bez blokady zapisu'}
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

        {belowExpectedOutput && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            <div className="font-bold text-amber-300">Wynik poniżej normy</div>
            <div className="mt-1">
              Brakuje {missingExpectedQty.toLocaleString('pl')} szt do oczekiwanych {expectedGoodQty.toLocaleString('pl')} szt.
              Podaj przyczynę w komentarzu operatora przed zapisem.
            </div>
          </div>
        )}
      </div>

      {/* Kategorie braków */}
      {(rejectTotal > 0 || defects.length > 0) && (
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Kategorie braków</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-navy-900 px-3 py-2">
                  <div className="text-navy-500">Braki razem</div>
                  <div className="text-white font-bold">{rejectTotal.toLocaleString('pl')}</div>
                </div>
                <div className="rounded-lg bg-navy-900 px-3 py-2">
                  <div className="text-navy-500">Przypisano</div>
                  <div className="text-white font-bold">{allocatedQty.toLocaleString('pl')}</div>
                </div>
                <div className="rounded-lg bg-navy-900 px-3 py-2">
                  <div className="text-navy-500">Zostało</div>
                  <div className={`font-bold ${remainingToAllocate === 0 ? 'text-green-400' : remainingToAllocate < 0 ? 'text-red-400' : 'text-amber-400'}`}>
                    {remainingToAllocate < 0 ? `+${Math.abs(remainingToAllocate).toLocaleString('pl')}` : remainingToAllocate.toLocaleString('pl')}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <button
                type="button"
                onClick={splitRemainingAcrossDefects}
                disabled={remainingToAllocate <= 0 || defects.length === 0}
                className="rounded-lg border border-navy-600 px-3 py-2 text-xs font-bold text-navy-300 hover:border-brand hover:text-brand disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Podziel pozostałe równo
              </button>
              <button
                type="button"
                onClick={clearDefectQuantities}
                disabled={allocatedQty === 0}
                className="rounded-lg border border-navy-600 px-3 py-2 text-xs font-bold text-navy-300 hover:border-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Wyczyść ilości
              </button>
            </div>
          </div>

          <div className="h-2 bg-navy-900 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${remainingToAllocate < 0 ? 'bg-red-500' : remainingToAllocate === 0 ? 'bg-green-500' : 'bg-amber-500'}`}
              style={{ width: `${allocationPct}%` }}
            />
          </div>

          <div className={`rounded-xl border px-4 py-3 text-sm ${
            remainingToAllocate === 0
              ? 'border-green-500/30 bg-green-500/10 text-green-300'
              : remainingToAllocate < 0
                ? 'border-red-500/30 bg-red-500/10 text-red-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          }`}>
            {remainingToAllocate === 0
              ? 'Wszystkie braki są przypisane do kategorii.'
              : remainingToAllocate < 0
                ? `Przypisano za dużo o ${Math.abs(remainingToAllocate).toLocaleString('pl')} szt. Zmniejsz jedną z kategorii.`
                : `Zostało do przypisania: ${remainingToAllocate.toLocaleString('pl')} szt.`}
          </div>

          {defects.map(d => {
            const cat = defectCategories.find(c => c.id === d.category_id)
            const currentQty = parseInt(d.qty || '0') || 0
            const remainingForThisRow = Math.max(0, rejectTotal - (allocatedQty - currentQty))
            const wouldAdd = Math.max(0, remainingForThisRow - currentQty)
            return (
              <div key={d.category_id} className="rounded-xl border border-navy-600 bg-navy-900 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{cat?.name}</span>
                  <button type="button" onClick={() => removeDefectRow(d.category_id)} className="text-navy-500 hover:text-red-400 text-lg">×</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
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
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => assignRemainingToDefect(d.category_id)}
                    disabled={remainingForThisRow <= 0 || currentQty === remainingForThisRow}
                    className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-bold text-brand hover:bg-brand/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {wouldAdd > 0 ? `Przypisz pozostałe +${wouldAdd.toLocaleString('pl')}` : 'Dopasowane'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDefectQty(d.category_id, 0)}
                    disabled={currentQty === 0}
                    className="rounded-lg border border-navy-600 px-3 py-1.5 text-xs font-bold text-navy-400 hover:border-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Wyczyść
                  </button>
                  <span className="text-xs text-navy-500">
                    Ta kategoria: {currentQty.toLocaleString('pl')} szt
                  </span>
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
                  type="button"
                  className="rounded-lg border border-navy-600 px-3 py-2 text-xs text-navy-300 hover:border-brand hover:text-brand text-left transition-all"
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
      <div className={`rounded-2xl border bg-navy-800 p-5 space-y-3 ${belowExpectedOutput && !notes.trim() ? 'border-amber-500/50' : 'border-navy-700'}`}>
        <div className={`text-xs font-bold uppercase tracking-wider ${belowExpectedOutput ? 'text-amber-300' : 'text-navy-400'}`}>
          {belowExpectedOutput ? 'Przyczyna wyniku poniżej normy *' : 'Komentarz operatora'}
        </div>
        <textarea
          value={notes}
          onChange={e => { setNotes(e.target.value); setErrors([]) }}
          rows={3}
          placeholder={belowExpectedOutput
            ? 'Napisz, co nie pozwoliło osiągnąć normy, np. przestój, problem z materiałem, regulacja, awaria...'
            : 'Uwagi do bieżącej rejestracji (opcjonalne)...'}
          className={`w-full bg-navy-900 border rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none resize-none ${belowExpectedOutput && !notes.trim() ? 'border-amber-500/60 focus:border-amber-400' : 'border-navy-600 focus:border-brand'}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/syringe')} className="btn-secondary py-4">Anuluj</button>
        <button
          onClick={() => { setErrors([]); saveMutation.mutate() }}
          disabled={saveMutation.isPending || lastLoading || countLoading || !!lastError || !!categoriesError || !!countError || entryLimitReached}
          className="py-4 rounded-2xl bg-brand text-navy-900 font-bold text-lg disabled:opacity-40 hover:bg-brand/90 transition-all"
        >
          {saveMutation.isPending ? 'Zapisywanie...' : editing ? 'Zapisz korektę' : isShiftSettlementMode ? 'Zapisz rozliczenie zmiany' : 'Zapisz produkcję'}
        </button>
      </div>
    </div>
  )
}
