import { useEffect, useState } from 'react'
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

  // Start formularza
  const [selectedAssortment, setSelectedAssortment] = useState('')
  const [labelCount, setLabelCount] = useState('')
  const [startErrors, setStartErrors] = useState<string[]>([])
  const [starting, setStarting] = useState(false)

  // Wpis / wymiana pojedynczego komponentu
  const [entryValues, setEntryValues] = useState<Record<string, string>>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const [confirmErrors, setConfirmErrors] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'fail'>('idle')

  const load = async () => {
    if (!activeMachine) { setLoading(false); return }
    setLoading(true)
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

  const assortment: AssortmentOption | undefined = ASSORTMENTS.find(a => a.name === selectedAssortment)
  const previewQty = assortment && labelCount ? calculateQty(parseInt(labelCount) || 0, assortment.multiplier) : 0

  const handleStart = async () => {
    const errs: string[] = []
    if (!activeShift || !activeMachine || !profile) { errs.push('Brak aktywnej zmiany.'); setStartErrors(errs); return }
    if (!assortment) errs.push('Wybierz asortyment.')
    const count = parseInt(labelCount)
    if (!labelCount || isNaN(count) || count <= 0) errs.push('Wpisz liczbę etykiet większą od zera.')
    if (errs.length) { setStartErrors(errs); return }

    setStarting(true)
    setStartErrors([])
    const qty = calculateQty(count, assortment!.multiplier)
    const { data, error } = await supabase.from('production_jobs').insert({
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
      setStartErrors([error.message.includes('idx_production_jobs_one_active_per_machine')
        ? 'Na tym automacie jest już aktywne zlecenie. Odśwież stronę.'
        : `Nie udało się rozpocząć zlecenia: ${error.message}`])
      setStarting(false)
      return
    }

    await logAudit('production_job_start', 'production_jobs', data.id, undefined, {
      assortment_name: assortment!.name, label_count: count, calculated_qty: qty, machine_id: activeMachine!.id
    })
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
    const { error } = await supabase.from('production_job_components').update({
      batch_number: value,
      status: 'aktywny',
      entered_at: new Date().toISOString(),
      entered_by: profile!.id
    }).eq('id', component.id)
    if (!error) {
      await logAudit('production_job_component_update', 'production_job_components', component.id, undefined, { batch_number: value })
      setEntryValues(prev => { const next = { ...prev }; delete next[component.id]; return next })
      await load()
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
    const { error: histError } = await supabase.from('production_job_component_history').insert({
      component_id: component.id,
      job_id: component.job_id,
      previous_batch_number: component.batch_number,
      new_batch_number: value,
      changed_by: profile!.id
    })
    if (!histError) {
      await supabase.from('production_job_components').update({
        batch_number: value,
        entered_at: new Date().toISOString(),
        entered_by: profile!.id
      }).eq('id', component.id)
      await logAudit('production_job_component_update', 'production_job_components', component.id,
        { batch_number: component.batch_number }, { batch_number: value })
      setEntryValues(prev => { const next = { ...prev }; delete next[component.id]; return next })
      setEditingKey(null)
      await load()
    }
    setSavingKey(null)
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
    const { error } = await supabase.from('production_jobs').update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by: profile!.id
    }).eq('id', job.id)
    setConfirming(false)
    if (error) {
      setConfirmErrors([`Nie udało się zatwierdzić zlecenia: ${error.message}`])
      return
    }
    await load()
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

  function ComponentRow({ component }: { component: ProductionJobComponent }) {
    const isEditing = editingKey === component.id
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
              value={entryValues[component.id] ?? ''}
              onChange={e => setEntryValues(prev => ({ ...prev, [component.id]: e.target.value }))}
              placeholder="Numer serii / partii..."
              className="input text-sm flex-1"
            />
            <button
              onClick={() => handleSaveEntry(component)}
              disabled={savingKey === component.id}
              className="btn-primary text-xs px-4 disabled:opacity-40"
            >
              Zapisz
            </button>
          </div>
        )}

        {!isLocked && hasValue && !isEditing && (
          <button onClick={() => { setEditingKey(component.id); setEntryValues(prev => ({ ...prev, [component.id]: '' })) }}
            className="btn-secondary text-xs px-3 py-1.5 mt-3">
            Wymiana
          </button>
        )}

        {!isLocked && hasValue && isEditing && (
          <div className="flex gap-2 mt-3">
            <input
              value={entryValues[component.id] ?? ''}
              onChange={e => setEntryValues(prev => ({ ...prev, [component.id]: e.target.value }))}
              placeholder="Nowy numer serii / partii..."
              className="input text-sm flex-1"
              autoFocus
            />
            <button
              onClick={() => handleConfirmWymiana(component)}
              disabled={savingKey === component.id}
              className="btn-primary text-xs px-4 disabled:opacity-40"
            >
              Zatwierdź wymianę
            </button>
            <button onClick={() => setEditingKey(null)} className="btn-secondary text-xs px-3">Anuluj</button>
          </div>
        )}
      </div>
    )
  }

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
            <label className="label">Asortyment</label>
            <select value={selectedAssortment} onChange={e => setSelectedAssortment(e.target.value)} className="input mt-1">
              <option value="">Wybierz asortyment...</option>
              {ASSORTMENTS.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Liczba etykiet</label>
            <input type="number" min={1} value={labelCount} onChange={e => setLabelCount(e.target.value)}
              placeholder="np. 200" className="input mt-1 font-mono" />
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
            <div className="flex items-center justify-between">
              <div className="card-title">Dane zlecenia</div>
              <span className={cn(
                'text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border',
                isLocked ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              )}>
                {isLocked ? 'Zatwierdzone' : 'W trakcie'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div><div className="text-navy-500 text-xs">Numer zlecenia</div><div className="font-mono text-white">{job.order_number}</div></div>
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
            <div className="card-title">Półfabrykaty</div>
            <div className="space-y-2">
              {standardComponents.map(c => <ComponentRow key={c.id} component={c} />)}
            </div>
          </div>

          <div className="card space-y-3">
            <div className="card-title">Dren</div>
            <div className="space-y-2">
              {drenComponents.map(c => <ComponentRow key={c.id} component={c} />)}
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
