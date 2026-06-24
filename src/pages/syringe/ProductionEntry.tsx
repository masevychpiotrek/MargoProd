import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { SaSession, SaProductionEntry, SaDefectCategory } from '@/types/database'

async function fetchMySession(operatorId: string) {
  const { data } = await supabase
    .from('sa_sessions')
    .select('*, machine:sa_machines(*), assortment:sa_assortments(*), order:sa_orders(*)')
    .eq('operator_id', operatorId)
    .is('ended_at', null)
    .maybeSingle()
  return data as SaSession | null
}

async function fetchLastEntry(sessionId: string) {
  const { data } = await supabase
    .from('sa_production_entries')
    .select('*')
    .eq('session_id', sessionId)
    .eq('is_cancelled', false)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as SaProductionEntry | null
}

async function fetchDefectCategories() {
  const { data } = await supabase
    .from('sa_defect_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
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

  const [counterValue, setCounterValue] = useState('')
  const [counterReset, setCounterReset] = useState(false)
  const [counterResetReason, setCounterResetReason] = useState('')
  const [goodQty, setGoodQty] = useState('')
  const [rejectQty, setRejectQty] = useState('')
  const [techRejectQty, setTechRejectQty] = useState('')
  const [qualRejectQty, setQualRejectQty] = useState('')
  const [notes, setNotes] = useState('')
  const [defects, setDefects] = useState<DefectRow[]>([])
  const [errors, setErrors] = useState<string[]>([])

  const { data: session } = useQuery({
    queryKey: ['sa_my_session', profile?.id],
    queryFn: () => fetchMySession(profile!.id),
    enabled: !!profile?.id
  })

  const { data: lastEntry } = useQuery({
    queryKey: ['sa_last_entry', session?.id],
    queryFn: () => fetchLastEntry(session!.id),
    enabled: !!session?.id
  })

  const { data: defectCategories = [] } = useQuery({
    queryKey: ['sa_defect_categories'],
    queryFn: fetchDefectCategories
  })

  const producedQty = parseInt(goodQty || '0') + parseInt(rejectQty || '0')
  const counterNum = parseInt(counterValue || '0')
  const lastCounter = lastEntry?.counter_value ?? 0

  const elapsedMs = lastEntry
    ? Date.now() - new Date(lastEntry.recorded_at).getTime()
    : session ? Date.now() - new Date(session.started_at).getTime() : 0
  const elapsedH = elapsedMs / 3600000
  const perHour = elapsedH > 0 && parseInt(goodQty || '0') > 0
    ? Math.round(parseInt(goodQty) / elapsedH)
    : null

  const planQty = session?.plan_qty ?? 0
  const sessionGood = session?.total_good ?? 0
  const planPct = planQty > 0 ? Math.round((sessionGood + parseInt(goodQty || '0')) / planQty * 100) : null

  function addDefectRow(catId: string) {
    if (defects.find(d => d.category_id === catId)) return
    setDefects(prev => [...prev, { category_id: catId, qty: '', notes: '' }])
  }

  function updateDefectRow(catId: string, field: 'qty' | 'notes', value: string) {
    setDefects(prev => prev.map(d => d.category_id === catId ? { ...d, [field]: value } : d))
  }

  function removeDefectRow(catId: string) {
    setDefects(prev => prev.filter(d => d.category_id !== catId))
  }

  function validate(): string[] {
    const errs: string[] = []
    if (!counterValue) errs.push('Nie wpisano stanu licznika.')
    if (counterNum < 0) errs.push('Stan licznika nie może być ujemny.')
    if (!counterReset && counterNum < lastCounter)
      errs.push(`Podana wartość (${counterNum}) jest mniejsza niż poprzedni stan licznika (${lastCounter}). Jeśli licznik był zerowany — zaznacz "Zerowanie licznika".`)
    if (!goodQty) errs.push('Nie wpisano ilości sztuk dobrych.')
    if (parseInt(goodQty || '0') < 0) errs.push('Ilość sztuk dobrych nie może być ujemna.')
    if (parseInt(techRejectQty || '0') + parseInt(qualRejectQty || '0') > parseInt(rejectQty || '0'))
      errs.push('Suma braków technologicznych i jakościowych nie może przekraczać łącznej ilości braków.')
    if (counterReset && !counterResetReason) errs.push('Podaj uzasadnienie zerowania licznika.')

    for (const d of defects) {
      const cat = defectCategories.find(c => c.id === d.category_id)
      if (cat?.requires_comment && !d.notes)
        errs.push(`Kategoria "${cat.name}" wymaga komentarza.`)
      if (!d.qty || parseInt(d.qty) <= 0)
        errs.push(`Podaj ilość dla kategorii braków: ${cat?.name ?? '—'}.`)
    }
    return errs
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!session || !profile) throw new Error('Brak aktywnej sesji.')
      const errs = validate()
      if (errs.length > 0) { setErrors(errs); throw new Error('Popraw błędy walidacji.') }

      const goodN = parseInt(goodQty)
      const rejectN = parseInt(rejectQty || '0')
      const techN = parseInt(techRejectQty || '0')
      const qualN = parseInt(qualRejectQty || '0')
      const producedN = goodN + rejectN
      const planPctN = planQty > 0 ? (sessionGood + goodN) / planQty * 100 : null
      const remainingN = planQty > 0 ? Math.max(0, planQty - sessionGood - goodN) : null
      const etaMin = perHour && perHour > 0 && remainingN !== null
        ? Math.round(remainingN / perHour * 60)
        : null

      const { data: entryData, error: entryErr } = await supabase
        .from('sa_production_entries')
        .insert({
          session_id: session.id,
          machine_id: session.machine_id,
          operator_id: profile.id,
          counter_value: counterNum,
          counter_reset: counterReset,
          counter_reset_reason: counterReset ? counterResetReason : null,
          produced_qty: producedN,
          good_qty: goodN,
          reject_qty: rejectN,
          tech_reject_qty: techN,
          qual_reject_qty: qualN,
          qty_since_last: counterReset ? counterNum : counterNum - lastCounter,
          per_hour: perHour,
          reject_pct: producedN > 0 ? rejectN / producedN * 100 : 0,
          plan_pct: planPctN,
          remaining_qty: remainingN,
          eta_minutes: etaMin,
          notes: notes || null
        })
        .select()
        .single()

      if (entryErr) throw entryErr

      if (defects.length > 0) {
        const { error: defErr } = await supabase.from('sa_defect_entries').insert(
          defects
            .filter(d => parseInt(d.qty) > 0)
            .map(d => ({
              entry_id: entryData.id,
              session_id: session.id,
              category_id: d.category_id,
              qty: parseInt(d.qty),
              notes: d.notes || null
            }))
        )
        if (defErr) throw defErr
      }

      // Aktualizuj sumy sesji
      await supabase.from('sa_sessions').update({
        total_produced: (session.total_produced ?? 0) + producedN,
        total_good: (session.total_good ?? 0) + goodN,
        total_reject: (session.total_reject ?? 0) + rejectN,
        total_tech_reject: (session.total_tech_reject ?? 0) + techN,
        total_qual_reject: (session.total_qual_reject ?? 0) + qualN,
        plan_pct: planPctN,
        avg_per_hour: perHour
      }).eq('id', session.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_my_session'] })
      qc.invalidateQueries({ queryKey: ['sa_entries'] })
      navigate('/syringe')
    },
    onError: (e: Error) => {
      if (e.message !== 'Popraw błędy walidacji.') setErrors([e.message])
    }
  })

  if (!session) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="text-navy-400">Brak aktywnej sesji.</p>
        <button onClick={() => navigate('/syringe')} className="btn-primary mt-4">Wróć</button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-2">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/syringe')} className="text-navy-400 hover:text-white">←</button>
        <div>
          <h1 className="text-xl font-bold text-white">Rejestracja produkcji</h1>
          <p className="text-navy-400 text-sm">{session.machine?.name} · {session.assortment?.name}</p>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
        </div>
      )}

      {lastEntry && (
        <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-4 text-sm">
          <div className="text-xs uppercase tracking-wider text-navy-500 mb-2">Poprzedni wpis</div>
          <div className="flex gap-6 text-navy-300">
            <span>Licznik: <strong className="text-white">{lastEntry.counter_value.toLocaleString('pl')}</strong></span>
            <span>Dobre: <strong className="text-white">{lastEntry.good_qty.toLocaleString('pl')}</strong></span>
            <span>Godz: <strong className="text-white">{new Date(lastEntry.recorded_at).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}</strong></span>
          </div>
        </div>
      )}

      {/* Licznik */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Stan licznika automatu</div>
        <input
          type="number"
          value={counterValue}
          onChange={e => { setCounterValue(e.target.value); setErrors([]) }}
          placeholder="np. 123456"
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-4 text-2xl font-bold text-white placeholder-navy-600 focus:outline-none focus:border-brand"
          min={0}
        />
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={counterReset}
            onChange={e => { setCounterReset(e.target.checked); setErrors([]) }}
            className="w-5 h-5 rounded accent-brand"
          />
          <span className="text-sm text-navy-300">Licznik był zerowany / wymieniony</span>
        </label>
        {counterReset && (
          <input
            type="text"
            value={counterResetReason}
            onChange={e => setCounterResetReason(e.target.value)}
            placeholder="Podaj uzasadnienie zerowania licznika (wymagane)"
            className="w-full bg-navy-900 border border-amber-500/50 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500"
          />
        )}
        {counterValue && !counterReset && parseInt(counterValue) > lastCounter && (
          <div className="text-xs text-navy-500">
            Produkcja od poprzedniego wpisu: <strong className="text-white">{(parseInt(counterValue) - lastCounter).toLocaleString('pl')} szt</strong>
          </div>
        )}
      </div>

      {/* Ilości */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Ilości</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-navy-400 mb-2 block">Sztuki dobre *</label>
            <input
              type="number"
              value={goodQty}
              onChange={e => { setGoodQty(e.target.value); setErrors([]) }}
              placeholder="0"
              min={0}
              className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-xl font-bold text-green-400 placeholder-navy-600 focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="text-sm text-navy-400 mb-2 block">Braki łącznie</label>
            <input
              type="number"
              value={rejectQty}
              onChange={e => { setRejectQty(e.target.value); setErrors([]) }}
              placeholder="0"
              min={0}
              className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-xl font-bold text-red-400 placeholder-navy-600 focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="text-sm text-navy-400 mb-2 block">w tym technologiczne</label>
            <input
              type="number"
              value={techRejectQty}
              onChange={e => setTechRejectQty(e.target.value)}
              placeholder="0"
              min={0}
              className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-600 focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="text-sm text-navy-400 mb-2 block">w tym jakościowe</label>
            <input
              type="number"
              value={qualRejectQty}
              onChange={e => setQualRejectQty(e.target.value)}
              placeholder="0"
              min={0}
              className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-600 focus:outline-none focus:border-brand"
            />
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
            {perHour !== null && (
              <div>
                <div className="text-navy-500">Wydajność</div>
                <div className="font-bold text-white">{perHour.toLocaleString('pl')} szt/h</div>
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
      {parseInt(rejectQty || '0') > 0 && (
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Kategorie braków</div>

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
          disabled={saveMutation.isPending}
          className="py-4 rounded-2xl bg-brand text-navy-900 font-bold text-lg disabled:opacity-40 hover:bg-brand/90 transition-all"
        >
          {saveMutation.isPending ? 'Zapisywanie...' : 'Zapisz produkcję'}
        </button>
      </div>
    </div>
  )
}
