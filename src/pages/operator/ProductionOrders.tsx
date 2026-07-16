import { useEffect, useRef, useState } from 'react'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { supabase, logAudit } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  ASSORTMENTS, calculateQty,
  isPlausibleBatchNumber, formatJobCopyText,
  type AssortmentOption
} from '@/lib/productionJobs'
import type { ProductionJob, ProductionJobComponent, ProductionJobComponentHistory } from '@/types/database'

type HistoryRow = ProductionJobComponentHistory & { changed_by_profile?: { full_name: string } | { full_name: string }[] | null }

function historyOperatorName(row: HistoryRow) {
  const p = row.changed_by_profile
  if (!p) return '—'
  return Array.isArray(p) ? (p[0]?.full_name ?? '—') : p.full_name
}

// Zdefiniowane poza komponentem nadrzednym (nie w renderze) - inaczej React tworzylby
// nowy typ komponentu przy kazdym renderze rodzica i pole input traciloby fokus po
// kazdym wpisanym znaku (trzeba by bylo klikac ponownie przed kazdym kolejnym znakiem).
function ComponentRow({
  component, isLocked, isEditing, value, saving, inputRef,
  onValueChange, onSaveEntry, onStartWymiana, onCancelWymiana, onConfirmWymiana
}: {
  component: ProductionJobComponent
  isLocked: boolean
  isEditing: boolean
  value: string
  saving: boolean
  inputRef?: (el: HTMLInputElement | null) => void
  onValueChange: (v: string) => void
  onSaveEntry: () => void
  onStartWymiana: () => void
  onCancelWymiana: () => void
  onConfirmWymiana: () => void
}) {
  const hasValue = !!component.batch_number

  return (
    <div className="rounded-xl bg-navy-900 border border-navy-700 px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{component.component_label}</div>
          <div className="text-xs text-navy-500 mt-0.5">
            {hasValue
              ? <>Nr serii: <span className="font-mono text-navy-200">{component.batch_number}</span></>
              : 'Brak wpisu'}
            {component.entered_at && <span> · {new Date(component.entered_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        </div>
        <span className={cn(
          'text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border',
          component.status === 'aktywny' ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-navy-600 text-navy-400'
        )}>
          {component.status}
        </span>
      </div>

      {!isLocked && !hasValue && (
        <div className="flex gap-2 mt-3">
          <input
            ref={inputRef}
            value={value}
            onChange={e => onValueChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveEntry() }}
            placeholder="Numer serii / partii... (Enter = zapisz)"
            autoComplete="off"
            enterKeyHint="done"
            className="input text-sm flex-1"
          />
          <button
            onClick={onSaveEntry}
            disabled={saving}
            className="btn-primary text-xs px-4 disabled:opacity-40"
          >
            Zapisz
          </button>
        </div>
      )}

      {!isLocked && hasValue && !isEditing && (
        <button onClick={onStartWymiana} className="btn-secondary text-xs px-3 py-1.5 mt-3">
          Wymiana
        </button>
      )}

      {!isLocked && hasValue && isEditing && (
        <div className="flex gap-2 mt-3">
          <input
            value={value}
            onChange={e => onValueChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onConfirmWymiana()
              if (e.key === 'Escape') onCancelWymiana()
            }}
            placeholder="Nowy numer serii / partii... (Enter = zapisz, Esc = anuluj)"
            autoComplete="off"
            enterKeyHint="done"
            className="input text-sm flex-1"
            autoFocus
          />
          <button
            onClick={onConfirmWymiana}
            disabled={saving}
            className="btn-primary text-xs px-4 disabled:opacity-40"
          >
            Zatwierdź wymianę
          </button>
          <button onClick={onCancelWymiana} className="btn-secondary text-xs px-3">Anuluj</button>
        </div>
      )}
    </div>
  )
}

async function fetchCurrentJob(machineId: string) {
  const { data } = await supabase
    .from('production_jobs')
    .select('*')
    .eq('machine_id', machineId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as ProductionJob | null
}

async function fetchComponents(jobId: string) {
  const { data } = await supabase
    .from('production_job_components')
    .select('*')
    .eq('job_id', jobId)
    .order('sort_order')
  return (data ?? []) as ProductionJobComponent[]
}

async function fetchHistory(jobId: string) {
  const { data } = await supabase
    .from('production_job_component_history')
    .select('*, changed_by_profile:profiles!changed_by(full_name)')
    .eq('job_id', jobId)
    .order('changed_at', { ascending: false })
  return (data ?? []) as HistoryRow[]
}

export default function OperatorProductionOrders() {
  const { activeShift, activeMachine } = useShiftStore()
  const { profile } = useAuthStore()

  const [job, setJob] = useState<ProductionJob | null>(null)
  const [components, setComponents] = useState<ProductionJobComponent[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  // Start formularza — numer zlecenia w formacie Z/NN/MM/RR, "Z/" jest stalym prefiksem,
  // operator wpisuje tylko czesc zmienna (numer/miesiac/rok) - eliminuje literowki w prefiksie.
  const [orderNumberPart, setOrderNumberPart] = useState('')
  const [orderMonthPart, setOrderMonthPart] = useState('')
  const [orderYearPart, setOrderYearPart] = useState('')
  const orderNumber = `Z/${orderNumberPart}/${orderMonthPart}/${orderYearPart}`
  const orderNumberPartRef = useRef<HTMLInputElement>(null)
  const orderMonthPartRef = useRef<HTMLInputElement>(null)
  const orderYearPartRef = useRef<HTMLInputElement>(null)
  const labelCountRef = useRef<HTMLInputElement>(null)
  const [selectedAssortment, setSelectedAssortment] = useState('')
  const [labelCount, setLabelCount] = useState('')
  const [startErrors, setStartErrors] = useState<string[]>([])
  const [starting, setStarting] = useState(false)

  // Wpis / wymiana pojedynczego komponentu
  const [entryValues, setEntryValues] = useState<Record<string, string>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // Korekta numeru zlecenia (dopoki zlecenie nie zostalo zatwierdzone)
  const [editingOrderNumber, setEditingOrderNumber] = useState(false)
  const [orderNumberEdit, setOrderNumberEdit] = useState('')
  const [orderNumberEditError, setOrderNumberEditError] = useState('')
  const [savingOrderNumber, setSavingOrderNumber] = useState(false)

  const [confirmErrors, setConfirmErrors] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'fail'>('idle')

  // Rejestr pol wpisu (tylko pierwszy wpis, nie wymiana) do automatycznego
  // przenoszenia fokusu na kolejna pusta pozycje po zapisie - operator wpisuje
  // 20 numerow serii pod rzad, wiec nie powinien musiec klikac w kazde pole recznie.
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // load(silent) nie pokazuje pelnoekranowego "Ladowanie..." przy odswiezaniu po
  // zapisie pojedynczego pola - tylko przy pierwszym wejsciu na strone. Bez tego
  // cala lista znikala i wracala po kazdym wpisanym numerze serii.
  const load = async (silent = false) => {
    if (!activeMachine) { setLoading(false); return }
    if (!silent) setLoading(true)
    const current = await fetchCurrentJob(activeMachine.id)
    setJob(current)
    if (current) {
      const [comps, hist] = await Promise.all([fetchComponents(current.id), fetchHistory(current.id)])
      setComponents(comps)
      setHistory(hist)
    } else {
      setComponents([])
      setHistory([])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [activeMachine?.id])

  // Po wejsciu na strone z juz rozpoczetym zleceniem, ustaw fokus od razu na
  // pierwsza pusta pozycje - operator moze zaczac wpisywac bez klikania.
  useEffect(() => {
    if (loading || !job) return
    const firstEmpty = [...components].sort((a, b) => a.sort_order - b.sort_order).find(c => !c.batch_number)
    if (firstEmpty) requestAnimationFrame(() => inputRefs.current[firstEmpty.id]?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, job?.id])

  const assortment: AssortmentOption | undefined = ASSORTMENTS.find(a => a.name === selectedAssortment)
  const previewQty = assortment && labelCount ? calculateQty(parseInt(labelCount) || 0, assortment.multiplier) : 0

  const handleStart = async () => {
    const errs: string[] = []
    if (!activeShift || !activeMachine || !profile) { errs.push('Brak aktywnej zmiany.'); setStartErrors(errs); return }
    if (!orderNumberPart.trim() || !orderMonthPart.trim() || !orderYearPart.trim()) {
      errs.push('Wpisz pełny numer zlecenia (numer / miesiąc / rok), np. Z/01/07/26.')
    }
    if (!assortment) errs.push('Wybierz asortyment.')
    const count = parseInt(labelCount)
    if (!labelCount || isNaN(count) || count <= 0) errs.push('Wpisz liczbę etykiet większą od zera.')
    if (errs.length) { setStartErrors(errs); return }

    setStarting(true)
    setStartErrors([])
    const qty = calculateQty(count, assortment!.multiplier)
    const { data, error } = await supabase.from('production_jobs').insert({
      order_number: orderNumber.trim(),
      assortment_name: assortment!.name,
      assortment_length_cm: assortment!.length_cm,
      label_count: count,
      multiplier: assortment!.multiplier,
      calculated_qty: qty,
      machine_id: activeMachine!.id,
      shift_id: activeShift!.id,
      operator_id: profile!.id,
      shift_type: activeShift!.shift_type
    }).select('id').single()

    if (error) {
      const message = error.message.includes('idx_production_jobs_one_active_per_machine')
        ? 'Na tym automacie jest już aktywne zlecenie. Odśwież stronę.'
        : error.message.includes('production_jobs_order_number_key')
          ? 'Zlecenie o takim numerze już istnieje. Wpisz inny numer.'
          : `Nie udało się rozpocząć zlecenia: ${error.message}`
      setStartErrors([message])
      setStarting(false)
      return
    }

    await logAudit('production_job_start', 'production_jobs', data.id, undefined, {
      order_number: orderNumber.trim(), assortment_name: assortment!.name, label_count: count, calculated_qty: qty, machine_id: activeMachine!.id
    })
    setOrderNumberPart('')
    setOrderMonthPart('')
    setOrderYearPart('')
    setSelectedAssortment('')
    setLabelCount('')
    setStarting(false)
    await load()
  }

  const handleSaveEntry = async (component: ProductionJobComponent) => {
    const value = (entryValues[component.id] ?? '').trim()
    if (!isPlausibleBatchNumber(value)) {
      setConfirmErrors([`Podaj konkretny numer serii dla: ${component.component_label}`])
      return
    }
    setSavingKey(component.id)
    const now = new Date().toISOString()
    const { error } = await supabase.from('production_job_components').update({
      batch_number: value,
      status: 'aktywny',
      entered_at: now,
      entered_by: profile!.id
    }).eq('id', component.id)
    if (!error) {
      await logAudit('production_job_component_update', 'production_job_components', component.id, undefined, { batch_number: value })
      const updated = components.map(c => c.id === component.id
        ? { ...c, batch_number: value, status: 'aktywny' as const, entered_at: now, entered_by: profile!.id }
        : c)
      setComponents(updated)
      setEntryValues(prev => { const next = { ...prev }; delete next[component.id]; return next })
      setConfirmErrors([])
      // przenies fokus na kolejna pusta pozycje - operator wpisuje wiele numerow pod rzad
      const next = updated
        .filter(c => c.sort_order > component.sort_order && !c.batch_number)
        .sort((a, b) => a.sort_order - b.sort_order)[0]
      if (next) requestAnimationFrame(() => inputRefs.current[next.id]?.focus())
    }
    setSavingKey(null)
  }

  const handleConfirmWymiana = async (component: ProductionJobComponent) => {
    const value = (entryValues[component.id] ?? '').trim()
    if (!isPlausibleBatchNumber(value)) {
      setConfirmErrors([`Podaj konkretny nowy numer serii dla: ${component.component_label}`])
      return
    }
    setSavingKey(component.id)
    const now = new Date().toISOString()
    const { error: histError, data: histRow } = await supabase.from('production_job_component_history').insert({
      component_id: component.id,
      job_id: component.job_id,
      previous_batch_number: component.batch_number,
      new_batch_number: value,
      changed_by: profile!.id
    }).select('*').single()
    if (!histError) {
      await supabase.from('production_job_components').update({
        batch_number: value,
        entered_at: now,
        entered_by: profile!.id
      }).eq('id', component.id)
      await logAudit('production_job_component_update', 'production_job_components', component.id,
        { batch_number: component.batch_number }, { batch_number: value })
      setComponents(prev => prev.map(c => c.id === component.id
        ? { ...c, batch_number: value, entered_at: now, entered_by: profile!.id }
        : c))
      if (histRow) {
        setHistory(prev => [{ ...(histRow as HistoryRow), changed_by_profile: { id: profile!.id, full_name: profile?.full_name ?? '—' } }, ...prev])
      }
      setEntryValues(prev => { const next = { ...prev }; delete next[component.id]; return next })
      setEditingKey(null)
      setConfirmErrors([])
    }
    setSavingKey(null)
  }

  const startEditOrderNumber = () => {
    if (!job) return
    setOrderNumberEdit(job.order_number)
    setOrderNumberEditError('')
    setEditingOrderNumber(true)
  }

  const handleSaveOrderNumber = async () => {
    if (!job) return
    const value = orderNumberEdit.trim()
    if (!value) {
      setOrderNumberEditError('Numer zlecenia nie może być pusty.')
      return
    }
    setSavingOrderNumber(true)
    const { error } = await supabase.from('production_jobs').update({ order_number: value }).eq('id', job.id)
    setSavingOrderNumber(false)
    if (error) {
      setOrderNumberEditError(error.message.includes('production_jobs_order_number_key')
        ? 'Zlecenie o takim numerze już istnieje.'
        : `Nie udało się zapisać: ${error.message}`)
      return
    }
    await logAudit('production_job_start', 'production_jobs', job.id, { order_number: job.order_number }, { order_number: value })
    setJob(prev => prev ? { ...prev, order_number: value } : prev)
    setEditingOrderNumber(false)
  }

  const handleConfirmJob = async () => {
    const errs: string[] = []
    if (!job) return
    if (!job.assortment_name) errs.push('Brak asortymentu.')
    if (!job.label_count || job.label_count <= 0) errs.push('Liczba etykiet musi być większa od zera.')
    if (!job.calculated_qty || job.calculated_qty <= 0) errs.push('System nie przeliczył ilości sztuk.')
    if (!job.machine_id) errs.push('Brak informacji o automacie.')
    if (!job.operator_id) errs.push('Brak informacji o operatorze.')
    if (!job.started_at) errs.push('Brak daty/godziny rozpoczęcia.')

    const missing = components.filter(c => !isPlausibleBatchNumber(c.batch_number))
    if (missing.length > 0) {
      errs.push(`Brakuje poprawnych numerów serii dla: ${missing.map(m => m.component_label).join(', ')}`)
    }

    if (errs.length > 0) {
      setConfirmErrors(['Nie można zatwierdzić zlecenia. Uzupełnij wymagane dane zlecenia i półfabrykatów.', ...errs])
      return
    }

    setConfirming(true)
    setConfirmErrors([])
    const confirmedAt = new Date().toISOString()
    const { error } = await supabase.from('production_jobs').update({
      status: 'confirmed',
      confirmed_at: confirmedAt,
      confirmed_by: profile!.id
    }).eq('id', job.id)
    setConfirming(false)
    if (error) {
      setConfirmErrors([`Nie udało się zatwierdzić zlecenia: ${error.message}`])
      return
    }
    setJob(prev => prev ? { ...prev, status: 'confirmed', confirmed_at: confirmedAt, confirmed_by: profile!.id } : prev)
  }

  const handleReopenJob = async () => {
    if (!job) return
    if (!confirm('Przywrócić to zlecenie do edycji? Będzie znów można wpisywać i wymieniać numery serii.')) return
    setConfirming(true)
    setConfirmErrors([])
    const { error } = await supabase.from('production_jobs').update({
      status: 'active',
      confirmed_at: null,
      confirmed_by: null
    }).eq('id', job.id)
    setConfirming(false)
    if (error) {
      setConfirmErrors([error.message.includes('idx_production_jobs_one_active_per_machine')
        ? 'Nie można przywrócić - na tym automacie jest już inne aktywne zlecenie. Najpierw je zatwierdź.'
        : `Nie udało się przywrócić zlecenia: ${error.message}`])
      return
    }
    await logAudit('production_job_start', 'production_jobs', job.id,
      { status: 'confirmed' }, { status: 'active', reopened_by: profile!.id })
    setJob(prev => prev ? { ...prev, status: 'active', confirmed_at: null, confirmed_by: null } : prev)
  }

  const handleCopyPreview = async () => {
    if (!job) return
    const text = formatJobCopyText({
      job,
      machineName: activeMachine?.name ?? '—',
      operatorName: profile?.full_name ?? '—',
      components,
      history: history.map(h => ({
        ...h,
        component_label: components.find(c => c.id === h.component_id)?.component_label,
        changed_by_name: historyOperatorName(h)
      }))
    })
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('ok')
    } catch {
      setCopyStatus('fail')
    }
    setTimeout(() => setCopyStatus('idle'), 2500)
  }

  if (!activeShift || !activeMachine) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="text-navy-400">Brak aktywnej zmiany.</p>
      </div>
    )
  }

  if (loading) return <div className="text-center py-16 text-navy-500">Ładowanie...</div>

  const isLocked = job?.status === 'confirmed'
  const standardComponents = components.filter(c => !c.is_dren)
  const drenComponents = components.filter(c => c.is_dren)
  const standardFilled = standardComponents.filter(c => isPlausibleBatchNumber(c.batch_number)).length
  const drenFilled = drenComponents.filter(c => isPlausibleBatchNumber(c.batch_number)).length

  const renderComponentRow = (component: ProductionJobComponent) => (
    <ComponentRow
      key={component.id}
      component={component}
      isLocked={isLocked}
      isEditing={editingKey === component.id}
      value={entryValues[component.id] ?? ''}
      saving={savingKey === component.id}
      inputRef={el => { inputRefs.current[component.id] = el }}
      onValueChange={v => setEntryValues(prev => ({ ...prev, [component.id]: v }))}
      onSaveEntry={() => handleSaveEntry(component)}
      onStartWymiana={() => { setEditingKey(component.id); setEntryValues(prev => ({ ...prev, [component.id]: '' })) }}
      onCancelWymiana={() => setEditingKey(null)}
      onConfirmWymiana={() => handleConfirmWymiana(component)}
    />
  )

  return (
    <div className="max-w-3xl mx-auto space-y-5 py-2">
      <div>
        <h1 className="text-xl font-bold text-white">Zlecenie produkcyjne</h1>
        <p className="text-navy-400 text-sm">{activeMachine.name} · Zmiana {activeShift.shift_type}</p>
      </div>

      {!job && (
        <div className="card space-y-4">
          {startErrors.length > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
              {startErrors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
            </div>
          )}
          <div>
            <label className="label">Numer zlecenia</label>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="font-mono text-navy-400 text-sm">Z /</span>
              <input
                ref={orderNumberPartRef}
                value={orderNumberPart}
                onChange={e => setOrderNumberPart(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') orderMonthPartRef.current?.focus() }}
                placeholder="numer"
                inputMode="numeric"
                autoFocus
                className="input font-mono w-16 text-center"
              />
              <span className="font-mono text-navy-400">/</span>
              <input
                ref={orderMonthPartRef}
                value={orderMonthPart}
                onChange={e => setOrderMonthPart(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') orderYearPartRef.current?.focus() }}
                placeholder="MM"
                inputMode="numeric"
                className="input font-mono w-14 text-center"
              />
              <span className="font-mono text-navy-400">/</span>
              <input
                ref={orderYearPartRef}
                value={orderYearPart}
                onChange={e => setOrderYearPart(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') labelCountRef.current?.focus() }}
                placeholder="RR"
                inputMode="numeric"
                className="input font-mono w-14 text-center"
              />
            </div>
            <div className="text-xs text-navy-500 mt-1">
              Format: Z / numer / miesiąc / rok — „Z/" jest stałe, wpisz tylko numer, miesiąc i rok
            </div>
          </div>
          <div>
            <label className="label">Asortyment</label>
            <select value={selectedAssortment} onChange={e => setSelectedAssortment(e.target.value)} className="input mt-1">
              <option value="">Wybierz asortyment...</option>
              {ASSORTMENTS.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Liczba etykiet</label>
            <input
              ref={labelCountRef}
              type="number" min={1} value={labelCount}
              onChange={e => setLabelCount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleStart() }}
              placeholder="np. 200" className="input mt-1 font-mono"
            />
          </div>
          {assortment && labelCount && (
            <div className="rounded-xl bg-navy-900 border border-navy-700 p-3 text-sm">
              <span className="text-navy-400">Przelicznik: </span>
              <span className="font-mono text-white font-bold">{assortment.multiplier}</span>
              <span className="text-navy-400"> · Ilość sztuk: </span>
              <span className="font-mono text-brand font-bold">{previewQty.toLocaleString('pl-PL')}</span>
            </div>
          )}
          <button onClick={handleStart} disabled={starting} className="btn-primary w-full py-3 disabled:opacity-40">
            {starting ? 'Rozpoczynanie...' : 'Rozpocznij nowe zlecenie'}
          </button>
        </div>
      )}

      {job && (
        <>
          <div className="card space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="card-title">Dane zlecenia</div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border',
                  isLocked ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                )}>
                  {isLocked ? 'Zatwierdzone' : 'W trakcie'}
                </span>
                {isLocked && (
                  <button onClick={handleReopenJob} disabled={confirming}
                    className="text-xs text-brand hover:text-brand-light underline disabled:opacity-40">
                    {confirming ? 'Przywracanie...' : 'Przywróć do edycji'}
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div className="col-span-2 sm:col-span-1">
                <div className="text-navy-500 text-xs">Numer zlecenia</div>
                {editingOrderNumber ? (
                  <div className="mt-1 space-y-1.5">
                    <div className="flex gap-1.5">
                      <input
                        value={orderNumberEdit}
                        onChange={e => { setOrderNumberEdit(e.target.value); setOrderNumberEditError('') }}
                        className="input font-mono text-sm py-1.5 flex-1"
                        autoFocus
                      />
                      <button onClick={handleSaveOrderNumber} disabled={savingOrderNumber}
                        className="btn-primary text-xs px-3 disabled:opacity-40">Zapisz</button>
                      <button onClick={() => setEditingOrderNumber(false)} className="btn-secondary text-xs px-3">Anuluj</button>
                    </div>
                    {orderNumberEditError && <div className="text-xs text-red-300">{orderNumberEditError}</div>}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="font-mono text-white">{job.order_number}</div>
                    {!isLocked && (
                      <button onClick={startEditOrderNumber} className="text-xs text-brand hover:text-brand-light underline">Edytuj</button>
                    )}
                  </div>
                )}
              </div>
              <div><div className="text-navy-500 text-xs">Numer serii</div><div className="font-mono text-white">{job.series_number ?? '—'}</div></div>
              <div><div className="text-navy-500 text-xs">Start</div><div className="text-white">{new Date(job.started_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div>
              <div><div className="text-navy-500 text-xs">Automat</div><div className="text-white">{activeMachine.name}</div></div>
              <div><div className="text-navy-500 text-xs">Zmiana</div><div className="text-white">{job.shift_type}</div></div>
              <div><div className="text-navy-500 text-xs">Operator</div><div className="text-white">{profile?.full_name}</div></div>
              <div><div className="text-navy-500 text-xs">Asortyment</div><div className="text-white">{job.assortment_name}</div></div>
              <div><div className="text-navy-500 text-xs">Liczba etykiet</div><div className="font-mono text-white">{job.label_count}</div></div>
              <div><div className="text-navy-500 text-xs">Przelicznik</div><div className="font-mono text-white">{job.multiplier}</div></div>
              <div className="col-span-2 sm:col-span-1"><div className="text-navy-500 text-xs">Ilość sztuk</div><div className="font-mono text-brand font-bold text-base">{job.calculated_qty.toLocaleString('pl-PL')}</div></div>
            </div>
          </div>

          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="card-title">Półfabrykaty</div>
              <span className={cn(
                'text-xs font-bold font-mono px-2 py-1 rounded-lg border',
                standardFilled === standardComponents.length ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-navy-600 text-navy-400'
              )}>
                {standardFilled}/{standardComponents.length}
              </span>
            </div>
            <div className="space-y-2">
              {standardComponents.map(renderComponentRow)}
            </div>
          </div>

          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="card-title">Dren</div>
              <span className={cn(
                'text-xs font-bold font-mono px-2 py-1 rounded-lg border',
                drenFilled === drenComponents.length ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-navy-600 text-navy-400'
              )}>
                {drenFilled}/{drenComponents.length}
              </span>
            </div>
            <div className="space-y-2">
              {drenComponents.map(renderComponentRow)}
            </div>
          </div>

          {history.length > 0 && (
            <div className="card space-y-2">
              <div className="card-title">Historia wymian</div>
              {history.map(h => (
                <div key={h.id} className="text-xs text-navy-300 border-b border-navy-800 pb-2 last:border-0">
                  {new Date(h.changed_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{' '}
                  <span className="text-white font-semibold">{components.find(c => c.id === h.component_id)?.component_label ?? '—'}</span>
                  {' '}zmieniono z <span className="font-mono">{h.previous_batch_number ?? '—'}</span> na <span className="font-mono text-white">{h.new_batch_number}</span>
                  {' '}· {historyOperatorName(h)}
                </div>
              ))}
            </div>
          )}

          {confirmErrors.length > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
              {confirmErrors.map((e, i) => <p key={i} className={cn('text-sm', i === 0 ? 'text-red-300 font-bold' : 'text-red-300')}>• {e}</p>)}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleCopyPreview} className="btn-secondary flex-1 py-3">
              {copyStatus === 'ok' ? 'Skopiowano ✓' : copyStatus === 'fail' ? 'Nie udało się skopiować' : 'Skopiuj podgląd zlecenia'}
            </button>
            {!isLocked && (
              <button onClick={handleConfirmJob} disabled={confirming} className="btn-primary flex-1 py-3 disabled:opacity-40">
                {confirming ? 'Zatwierdzanie...' : 'Zatwierdź zlecenie'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
