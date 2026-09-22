import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSyringeSession } from '@/hooks/useSyringeSession'
import { useSyringeCommand } from '@/hooks/useSyringeCommand'
import { invalidateSyringe } from '@/lib/syringeApi'
import { isShiftSettlementAssortment } from '@/lib/syringeSettlement'
import SyringeSessionState from '@/components/shared/SyringeSessionState'
import { useAuthStore } from '@/stores/authStore'
import type { SaChangeover } from '@/types/database'

async function fetchActiveDowntime(sessionId: string) {
  const { data, error } = await supabase
    .from('sa_downtime_events')
    .select('*, category:sa_downtime_categories(*)')
    .eq('session_id', sessionId)
    .is('ended_at', null)
    .maybeSingle()
  if (error) throw error
  return data
}

async function fetchLastCounter(sessionId: string) {
  const { data, error } = await supabase
    .from('sa_production_entries')
    .select('counter_value, counter_print_value, counter_assembly_value, produced_qty, good_qty, reject_qty, recorded_at')
    .eq('session_id', sessionId)
    .eq('is_cancelled', false)
    .order('recorded_at', { ascending: false })
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

async function fetchActiveChangeover(sessionId: string) {
  const { data, error } = await supabase
    .from('sa_changeovers')
    .select('*, to_assortment:sa_assortments!sa_changeovers_to_assortment_id_fkey(*)')
    .eq('session_id', sessionId)
    .is('ended_at', null)
    .maybeSingle()
  if (error) throw error
  return data as (SaChangeover & { to_assortment?: { name: string } }) | null
}

export default function SyringeShiftHandover() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const command = useSyringeCommand()

  const [activeIssues, setActiveIssues] = useState('')
  const [adjustmentsMade, setAdjustmentsMade] = useState('')
  const [unresolvedFailures, setUnresolvedFailures] = useState('')
  const [qualityInfo, setQualityInfo] = useState('')
  const [componentStatus, setComponentStatus] = useState('')
  const [recommendations, setRecommendations] = useState('')
  const [comment, setComment] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [handoverCreated, setHandoverCreated] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const { data: session, isLoading, error: sessionError, refetch: refetchSession } = useSyringeSession()

  const { data: activeDowntime } = useQuery({
    queryKey: ['sa_active_downtime', session?.id],
    queryFn: () => fetchActiveDowntime(session!.id),
    enabled: !!session?.id
  })

  const { data: activeChangeover } = useQuery({
    queryKey: ['sa_active_changeover', session?.id],
    queryFn: () => fetchActiveChangeover(session!.id),
    enabled: !!session?.id
  })

  const { data: lastCounter, isLoading: countersLoading, error: countersError } = useQuery({
    queryKey: ['sa_handover_counters', session?.id],
    queryFn: () => fetchLastCounter(session!.id),
    enabled: !!session?.id
  })

  const isShiftSettlementMode = isShiftSettlementAssortment(session?.assortment?.code)
  const savedFinalPrint = lastCounter?.counter_print_value ?? lastCounter?.counter_value ?? 0
  const savedFinalAssembly = lastCounter?.counter_assembly_value ?? lastCounter?.counter_value ?? 0

  function validate(): string[] {
    const errs: string[] = []
    if (activeDowntime) errs.push('Najpierw zakończ aktywny przestój.')
    if (activeChangeover) errs.push('Najpierw zakończ aktywne przezbrojenie.')
    return errs
  }

  const handoverMutation = useMutation({
    mutationFn: async () => {
      if (!session || !profile) throw new Error('Brak aktywnej sesji.')
      const errs = validate()
      if (errs.length > 0) { setErrors(errs); throw new Error('Walidacja') }

      await command('finish', {
        session_id: session.id,
        final_print: String(savedFinalPrint),
        final_assembly: String(savedFinalAssembly),
        active_issues: activeIssues,
        adjustments_made: adjustmentsMade,
        unresolved_failures: unresolvedFailures,
        quality_info: qualityInfo,
        component_status: componentStatus,
        recommendations,
        comment
      })
    },
    onSuccess: () => {
      void invalidateSyringe(qc)
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
          Formularz przekazania został zapisany, a zmiana zakończona.
        </p>
        <button onClick={() => navigate('/syringe/start')} className="btn-primary px-8 py-3 text-lg">
          Nowa zmiana
        </button>
      </div>
    )
  }

  if (!session || sessionError) {
    return <SyringeSessionState loading={isLoading} error={sessionError} retry={refetchSession} />
  }

  const totalGood = session.total_good ?? 0
  const planQty = session.plan_qty ?? 0
  const planPct = planQty > 0 ? Math.round(totalGood / planQty * 100) : null

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-2">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/syringe')} className="text-navy-400 hover:text-white">←</button>
        <div>
          <h1 className="text-xl font-bold text-white">Zamknięcie zmiany</h1>
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

      {activeChangeover && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="text-sm text-yellow-200 font-medium">
            Najpierw zakończ aktywne przezbrojenie{activeChangeover.to_assortment?.name ? ` do: ${activeChangeover.to_assortment.name}` : ''}.
          </p>
          <button onClick={() => navigate('/syringe/changeover')} className="mt-2 text-sm text-yellow-300 underline">
            Przejdź do przezbrojenia →
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

      <div className="border border-navy-700 bg-navy-800 p-5 space-y-3">
        <h2 className="font-bold">{isShiftSettlementMode ? 'Rozliczenie końcowe zmiany' : 'Końcowy wynik zmiany'}</h2>
        {countersError && <p role="alert" className="text-red-400">{countersError.message}</p>}
        {lastCounter ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-xl bg-navy-900 border border-navy-700 p-3">
                <div className="text-navy-500">Dobre sztuki</div>
                <div className="text-green-400 font-bold text-xl">{(lastCounter.good_qty ?? 0).toLocaleString('pl')}</div>
              </div>
              <div className="rounded-xl bg-navy-900 border border-navy-700 p-3">
                <div className="text-navy-500">Braki</div>
                <div className="text-red-400 font-bold text-xl">{(lastCounter.reject_qty ?? 0).toLocaleString('pl')}</div>
              </div>
              <div className="rounded-xl bg-navy-900 border border-navy-700 p-3">
                <div className="text-navy-500">Razem</div>
                <div className="text-white font-bold text-xl">{(lastCounter.produced_qty ?? 0).toLocaleString('pl')}</div>
              </div>
            </div>
            {!isShiftSettlementMode && (
              <p className="text-sm text-navy-400">
                Liczniki końcowe zostaną pobrane automatycznie z ostatniego wpisu: druk {savedFinalPrint.toLocaleString('pl')}, montaż {savedFinalAssembly.toLocaleString('pl')}.
              </p>
            )}
            <button className="btn-secondary" onClick={() => navigate('/syringe/entry?edit=last')}>
              {isShiftSettlementMode ? 'Popraw rozliczenie zmiany' : 'Popraw ostatni wpis'}
            </button>
          </>
        ) : (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
            <p className="text-sm text-amber-100">
              Nie ma jeszcze zapisanego wyniku produkcji dla tej zmiany. Możesz wpisać wynik albo zamknąć zmianę jako zmianę bez produkcji.
            </p>
            <button className="btn-secondary" onClick={() => navigate('/syringe/entry')}>
              {isShiftSettlementMode ? 'Wpisz rozliczenie zmiany' : 'Wpisz końcową produkcję'}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowDetails(v => !v)}
        className="w-full rounded-2xl border border-navy-700 bg-navy-800 px-5 py-4 text-left font-bold text-navy-200 hover:border-navy-500"
      >
        {showDetails ? 'Ukryj szczegóły przekazania' : 'Dodaj szczegóły przekazania'}
      </button>

      {showDetails && [
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
          disabled={countersLoading || !!countersError || handoverMutation.isPending || !!activeDowntime || !!activeChangeover}
          className="py-4 rounded-2xl bg-brand text-navy-900 font-bold text-lg disabled:opacity-40 hover:bg-brand/90 transition-all"
        >
          {handoverMutation.isPending ? 'Zapisywanie...' : lastCounter ? 'Zakończ zmianę' : 'Zakończ bez produkcji'}
        </button>
      </div>
    </div>
  )
}
