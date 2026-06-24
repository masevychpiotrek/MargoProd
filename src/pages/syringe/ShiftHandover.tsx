import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { SaSession } from '@/types/database'

async function fetchMySession(operatorId: string) {
  const { data } = await supabase
    .from('sa_sessions')
    .select('*, machine:sa_machines(*), assortment:sa_assortments(*), order:sa_orders(*)')
    .eq('operator_id', operatorId)
    .is('ended_at', null)
    .maybeSingle()
  return data as SaSession | null
}

async function fetchActiveDowntime(sessionId: string) {
  const { data } = await supabase
    .from('sa_downtime_events')
    .select('id')
    .eq('session_id', sessionId)
    .is('ended_at', null)
    .maybeSingle()
  return data
}

async function fetchLastCounter(sessionId: string) {
  const { data } = await supabase
    .from('sa_production_entries')
    .select('counter_value')
    .eq('session_id', sessionId)
    .eq('is_cancelled', false)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.counter_value ?? null
}

export default function SyringeShiftHandover() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [activeIssues, setActiveIssues] = useState('')
  const [adjustmentsMade, setAdjustmentsMade] = useState('')
  const [unresolvedFailures, setUnresolvedFailures] = useState('')
  const [qualityInfo, setQualityInfo] = useState('')
  const [componentStatus, setComponentStatus] = useState('')
  const [recommendations, setRecommendations] = useState('')
  const [comment, setComment] = useState('')
  const [finalCounter, setFinalCounter] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [handoverCreated, setHandoverCreated] = useState(false)

  const { data: session } = useQuery({
    queryKey: ['sa_my_session', profile?.id],
    queryFn: () => fetchMySession(profile!.id),
    enabled: !!profile?.id
  })

  const { data: activeDowntime } = useQuery({
    queryKey: ['sa_active_downtime', session?.id],
    queryFn: () => fetchActiveDowntime(session!.id),
    enabled: !!session?.id
  })

  const { data: lastCounter } = useQuery({
    queryKey: ['sa_last_counter', session?.id],
    queryFn: () => fetchLastCounter(session!.id),
    enabled: !!session?.id
  })

  function validate(): string[] {
    const errs: string[] = []
    if (activeDowntime) errs.push('Najpierw zakończ aktywny przestój.')
    if (!finalCounter) errs.push('Nie wpisano końcowego stanu licznika.')
    if (lastCounter !== null && parseInt(finalCounter || '0') < lastCounter)
      errs.push(`Końcowy stan licznika (${finalCounter}) jest mniejszy niż poprzedni wpis (${lastCounter}).`)
    return errs
  }

  const handoverMutation = useMutation({
    mutationFn: async () => {
      if (!session || !profile) throw new Error('Brak aktywnej sesji.')
      const errs = validate()
      if (errs.length > 0) { setErrors(errs); throw new Error('Walidacja') }

      await supabase.from('sa_handovers').insert({
        session_id: session.id,
        from_operator_id: profile.id,
        machine_status: session.machine_status,
        current_assortment_id: session.assortment_id,
        produced_qty: session.total_good ?? 0,
        remaining_qty: session.plan_qty ? Math.max(0, session.plan_qty - (session.total_good ?? 0)) : null,
        active_issues: activeIssues || null,
        adjustments_made: adjustmentsMade || null,
        unresolved_failures: unresolvedFailures || null,
        quality_info: qualityInfo || null,
        component_status: componentStatus || null,
        recommendations: recommendations || null,
        comment: comment || null
      })

      // Zapisz końcowy wpis produkcyjny z ostatnim stanem licznika
      const counterN = parseInt(finalCounter)
      const lastCounterN = lastCounter ?? 0
      const goodN = Math.max(0, counterN - lastCounterN)

      await supabase.from('sa_production_entries').insert({
        session_id: session.id,
        machine_id: session.machine_id,
        operator_id: profile.id,
        counter_value: counterN,
        produced_qty: goodN,
        good_qty: goodN,
        reject_qty: 0,
        tech_reject_qty: 0,
        qual_reject_qty: 0,
        qty_since_last: counterN - lastCounterN,
        notes: 'Wpis końcowy — zakończenie zmiany'
      })

      // Zakończ sesję
      const now = new Date().toISOString()
      const planQty = session.plan_qty ?? 0
      const totalGood = (session.total_good ?? 0) + goodN
      await supabase.from('sa_sessions').update({
        ended_at: now,
        machine_status: 'end_of_production',
        total_good: totalGood,
        total_produced: (session.total_produced ?? 0) + goodN,
        plan_pct: planQty > 0 ? totalGood / planQty * 100 : null,
        summary_notes: comment || null
      }).eq('id', session.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_my_session'] })
      qc.invalidateQueries({ queryKey: ['sa_sessions'] })
      setHandoverCreated(true)
    },
    onError: (e: Error) => {
      if (e.message !== 'Walidacja') setErrors([e.message])
    }
  })

  if (handoverCreated) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-4">
        <div className="text-5xl">✓</div>
        <h2 className="text-xl font-bold text-white">Zmiana zakończona</h2>
        <p className="text-navy-400 text-sm">
          Formularz przekazania zmiany został zapisany. Zmiana została zakończona i oczekuje na potwierdzenie przez kolejnego operatora.
        </p>
        <button onClick={() => navigate('/syringe/start')} className="btn-primary px-8 py-3 text-lg">
          Nowa zmiana
        </button>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="text-navy-400">Brak aktywnej sesji.</p>
        <button onClick={() => navigate('/syringe')} className="btn-primary mt-4">Wróć</button>
      </div>
    )
  }

  const totalGood = session.total_good ?? 0
  const planQty = session.plan_qty ?? 0
  const planPct = planQty > 0 ? Math.round(totalGood / planQty * 100) : null

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-2">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/syringe')} className="text-navy-400 hover:text-white">←</button>
        <div>
          <h1 className="text-xl font-bold text-white">Przekazanie zmiany</h1>
          <p className="text-navy-400 text-sm">{session.machine?.name} · Zmiana {session.shift_type}</p>
        </div>
      </div>

      {/* Blokady */}
      {activeDowntime && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-300 font-medium">Najpierw zakończ aktywny przestój.</p>
          <button onClick={() => navigate('/syringe/downtime')} className="mt-2 text-sm text-red-400 underline">
            Przejdź do przestojów →
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
        </div>
      )}

      {/* Podsumowanie zmiany */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-4">Podsumowanie zmiany</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-navy-500">Asortyment</div>
            <div className="font-medium text-white">{session.assortment?.name}</div>
          </div>
          <div>
            <div className="text-navy-500">Dobre sztuki</div>
            <div className="font-bold text-green-400">{totalGood.toLocaleString('pl')}</div>
          </div>
          <div>
            <div className="text-navy-500">Braki</div>
            <div className="font-bold text-red-400">{(session.total_reject ?? 0).toLocaleString('pl')}</div>
          </div>
          <div>
            <div className="text-navy-500">Plan</div>
            <div className={`font-bold ${planPct !== null && planPct >= 100 ? 'text-green-400' : 'text-white'}`}>
              {planPct !== null ? `${planPct}%` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Końcowy stan licznika */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Końcowy stan licznika *</div>
        {lastCounter !== null && (
          <p className="text-xs text-navy-500">Poprzedni wpis: {lastCounter.toLocaleString('pl')}</p>
        )}
        <input
          type="number"
          value={finalCounter}
          onChange={e => { setFinalCounter(e.target.value); setErrors([]) }}
          placeholder="Końcowy odczyt z automatu"
          min={0}
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-4 text-2xl font-bold text-white placeholder-navy-600 focus:outline-none focus:border-brand"
        />
      </div>

      {/* Formularz przekazania */}
      {[
        { label: 'Aktywne problemy', value: activeIssues, setter: setActiveIssues, placeholder: 'Opisz bieżące problemy, które nie zostały rozwiązane...' },
        { label: 'Wykonane regulacje', value: adjustmentsMade, setter: setAdjustmentsMade, placeholder: 'Jakie regulacje zostały wykonane podczas zmiany?' },
        { label: 'Nierozwiązane awarie', value: unresolvedFailures, setter: setUnresolvedFailures, placeholder: 'Awarie, które wymagają dalszego działania...' },
        { label: 'Informacje jakościowe', value: qualityInfo, setter: setQualityInfo, placeholder: 'Problemy jakościowe, obserwacje, odchylenia...' },
        { label: 'Stan komponentów', value: componentStatus, setter: setComponentStatus, placeholder: 'Ilość pozostałych komponentów, kończące się partie...' },
        { label: 'Zalecenia dla kolejnej zmiany', value: recommendations, setter: setRecommendations, placeholder: 'Co powinien wiedzieć następny operator?' },
      ].map(field => (
        <div key={field.label} className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-navy-400">{field.label}</div>
          <textarea
            value={field.value}
            onChange={e => field.setter(e.target.value)}
            rows={3}
            placeholder={field.placeholder}
            className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-brand resize-none"
          />
        </div>
      ))}

      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Komentarz końcowy</div>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={3}
          placeholder="Ogólne uwagi do zmiany..."
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-brand resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/syringe')} className="btn-secondary py-4">Anuluj</button>
        <button
          onClick={() => { setErrors([]); handoverMutation.mutate() }}
          disabled={handoverMutation.isPending || !!activeDowntime}
          className="py-4 rounded-2xl bg-brand text-navy-900 font-bold text-lg disabled:opacity-40 hover:bg-brand/90 transition-all"
        >
          {handoverMutation.isPending ? 'Zapisywanie...' : 'Zakończ zmianę'}
        </button>
      </div>
    </div>
  )
}
