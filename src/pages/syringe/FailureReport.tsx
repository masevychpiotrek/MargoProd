import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import Toggle from '@/components/shared/Toggle'
import type { SaSession, SaFailurePriority } from '@/types/database'

async function fetchMySession(operatorId: string) {
  const { data } = await supabase
    .from('sa_sessions')
    .select('*, machine:sa_machines(*)')
    .eq('operator_id', operatorId)
    .is('ended_at', null)
    .maybeSingle()
  return data as SaSession | null
}

const PRIORITIES: { value: SaFailurePriority; label: string; color: string }[] = [
  { value: 'low',      label: 'Niski',    color: 'border-green-500/50 bg-green-500/10 text-green-300' },
  { value: 'medium',   label: 'Średni',   color: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-300' },
  { value: 'high',     label: 'Wysoki',   color: 'border-orange-500/50 bg-orange-500/10 text-orange-300' },
  { value: 'critical', label: 'Krytyczny',color: 'border-red-500/50 bg-red-500/10 text-red-300' }
]

export default function SyringeFailureReport() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [componentName, setComponentName] = useState('')
  const [symptoms, setSymptoms] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [priority, setPriority] = useState<SaFailurePriority>('medium')
  const [productionStopped, setProductionStopped] = useState(false)
  const [canContinue, setCanContinue] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [success, setSuccess] = useState(false)

  const { data: session } = useQuery({
    queryKey: ['sa_my_session', profile?.id],
    queryFn: () => fetchMySession(profile!.id),
    enabled: !!profile?.id
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Brak profilu.')
      const errs: string[] = []
      if (!symptoms) errs.push('Opisz objawy awarii.')
      if (errs.length > 0) { setErrors(errs); throw new Error('Walidacja') }

      const machineId = session?.machine_id
      if (!machineId) throw new Error('Nie można ustalić automatu (brak aktywnej sesji). Wskaż automat u administratora.')

      const { error } = await supabase.from('sa_failure_reports').insert({
        session_id: session?.id ?? null,
        machine_id: machineId,
        reporter_id: profile.id,
        component_name: componentName || null,
        symptoms,
        error_code: errorCode || null,
        priority,
        production_stopped: productionStopped,
        can_continue: canContinue
      })
      if (error) throw error

      if (productionStopped && session) {
        await supabase.from('sa_sessions').update({ machine_status: 'failure' }).eq('id', session.id)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_my_session'] })
      setSuccess(true)
    },
    onError: (e: Error) => {
      if (e.message !== 'Walidacja') setErrors([e.message])
    }
  })

  if (success) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-4">
        <div className="text-5xl">✓</div>
        <h2 className="text-xl font-bold text-white">Zgłoszenie wysłane</h2>
        <p className="text-navy-400 text-sm">Zgłoszenie awarii zostało zarejestrowane i jest widoczne dla mistrza, kierownika i utrzymania ruchu.</p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => { setSuccess(false); setSymptoms(''); setComponentName(''); setErrorCode('') }} className="btn-secondary px-6 py-3">
            Nowe zgłoszenie
          </button>
          <button onClick={() => navigate('/syringe')} className="btn-primary px-6 py-3">Wróć do pulpitu</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-2">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/syringe')} className="text-navy-400 hover:text-white">←</button>
        <div>
          <h1 className="text-xl font-bold text-white">Zgłoszenie awarii</h1>
          <p className="text-navy-400 text-sm">{session?.machine?.name ?? 'Nieznany automat'}</p>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
        </div>
      )}

      {/* Podzespół */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Podzespół / lokalizacja</div>
        <input
          type="text"
          value={componentName}
          onChange={e => setComponentName(e.target.value)}
          placeholder="np. Głowica drukująca, Podajnik korpusów, Stacja montażu tłoczysk..."
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-brand"
        />
      </div>

      {/* Objawy */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Opis objawów *</div>
        <textarea
          value={symptoms}
          onChange={e => { setSymptoms(e.target.value); setErrors([]) }}
          rows={4}
          placeholder="Opisz dokładnie, co się dzieje. Co widzisz? Jaki jest efekt? Kiedy wystąpiło?"
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-brand resize-none"
        />
      </div>

      {/* Kod błędu */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Kod błędu (z wyświetlacza automatu)</div>
        <input
          type="text"
          value={errorCode}
          onChange={e => setErrorCode(e.target.value)}
          placeholder="np. E-103, F-22, brak kodu..."
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-brand font-mono"
        />
      </div>

      {/* Priorytet */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Priorytet zgłoszenia</div>
        <div className="grid grid-cols-2 gap-3">
          {PRIORITIES.map(p => (
            <button
              key={p.value}
              onClick={() => setPriority(p.value)}
              className={`rounded-xl border-2 py-3 font-bold text-sm transition-all ${
                priority === p.value ? p.color : 'border-navy-600 text-navy-300 hover:border-navy-500'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status produkcji */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Wpływ na produkcję</div>

        <Toggle label="Produkcja została zatrzymana" checked={productionStopped} onChange={setProductionStopped} color="red" />
        <Toggle label="Automat może kontynuować produkcję" checked={canContinue} onChange={setCanContinue} color="green" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/syringe')} className="btn-secondary py-4">Anuluj</button>
        <button
          onClick={() => { setErrors([]); saveMutation.mutate() }}
          disabled={saveMutation.isPending}
          className="py-4 rounded-2xl bg-red-600 text-white font-bold text-lg disabled:opacity-40 hover:bg-red-500 transition-all"
        >
          {saveMutation.isPending ? 'Wysyłanie...' : 'Wyślij zgłoszenie'}
        </button>
      </div>
    </div>
  )
}
