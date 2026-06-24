import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { SaSession, SaAssortment, SaChangeover, SaChecklistItem } from '@/types/database'

async function fetchMySession(operatorId: string) {
  const { data } = await supabase
    .from('sa_sessions')
    .select('*, machine:sa_machines(*), assortment:sa_assortments(*)')
    .eq('operator_id', operatorId)
    .is('ended_at', null)
    .maybeSingle()
  return data as SaSession | null
}

async function fetchAssortments() {
  const { data } = await supabase.from('sa_assortments').select('*').eq('is_active', true).order('sort_order')
  return data as SaAssortment[] ?? []
}

async function fetchActiveChangeover(sessionId: string) {
  const { data } = await supabase
    .from('sa_changeovers')
    .select('*, from_assortment:sa_assortments!sa_changeovers_from_assortment_id_fkey(*), to_assortment:sa_assortments!sa_changeovers_to_assortment_id_fkey(*)')
    .eq('session_id', sessionId)
    .is('ended_at', null)
    .maybeSingle()
  return data as (SaChangeover & { from_assortment?: SaAssortment; to_assortment: SaAssortment }) | null
}

async function fetchChecklistItems() {
  const { data } = await supabase.from('sa_checklist_items').select('*').eq('is_active', true).order('sort_order')
  return data as SaChecklistItem[] ?? []
}

async function fetchChecklistCompletions(changeoverId: string) {
  const { data } = await supabase.from('sa_checklist_completions').select('*').eq('changeover_id', changeoverId)
  return data as { item_id: string; completed: boolean }[] ?? []
}

export default function SyringeChangeover() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [toAssortmentId, setToAssortmentId] = useState('')
  const [counterBefore, setCounterBefore] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  const { data: session } = useQuery({
    queryKey: ['sa_my_session', profile?.id],
    queryFn: () => fetchMySession(profile!.id),
    enabled: !!profile?.id
  })

  const { data: assortments = [] } = useQuery({ queryKey: ['sa_assortments'], queryFn: fetchAssortments })
  const { data: checklistItems = [] } = useQuery({ queryKey: ['sa_checklist_items'], queryFn: fetchChecklistItems })

  const { data: activeChangeover } = useQuery({
    queryKey: ['sa_active_changeover', session?.id],
    queryFn: () => fetchActiveChangeover(session!.id),
    enabled: !!session?.id
  })

  const { data: completions = [] } = useQuery({
    queryKey: ['sa_checklist_completions', activeChangeover?.id],
    queryFn: () => fetchChecklistCompletions(activeChangeover!.id),
    enabled: !!activeChangeover?.id
  })

  const completedIds = new Set(completions.filter(c => c.completed).map(c => c.item_id))

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!session || !profile) throw new Error('Brak aktywnej sesji.')
      const errs: string[] = []
      if (!toAssortmentId) errs.push('Wybierz nowy asortyment.')
      if (errs.length > 0) { setErrors(errs); throw new Error('Walidacja') }

      await supabase.from('sa_changeovers').insert({
        session_id: session.id,
        machine_id: session.machine_id,
        operator_id: profile.id,
        from_assortment_id: session.assortment_id,
        to_assortment_id: toAssortmentId,
        counter_before: counterBefore ? parseInt(counterBefore) : null,
        reason: reason || null
      })

      await supabase.from('sa_sessions').update({ machine_status: 'changeover' }).eq('id', session.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_active_changeover', session?.id] })
      qc.invalidateQueries({ queryKey: ['sa_my_session'] })
    },
    onError: (e: Error) => {
      if (e.message !== 'Walidacja') setErrors([e.message])
    }
  })

  const toggleItemMutation = useMutation({
    mutationFn: async ({ itemId, checked }: { itemId: string; checked: boolean }) => {
      if (!activeChangeover || !profile) return
      await supabase.from('sa_checklist_completions')
        .upsert({
          changeover_id: activeChangeover.id,
          item_id: itemId,
          completed: checked,
          completed_by: profile.id,
          completed_at: checked ? new Date().toISOString() : null
        }, { onConflict: 'changeover_id,item_id' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa_checklist_completions', activeChangeover?.id] })
  })

  const endMutation = useMutation({
    mutationFn: async () => {
      if (!activeChangeover || !session) throw new Error('Brak aktywnego przezbrojenia.')

      const requiredItems = checklistItems.filter(i => i.is_required)
      const unchecked = requiredItems.filter(i => !completedIds.has(i.id))
      if (unchecked.length > 0) {
        setErrors([`Niezatwierdzone pozycje checklisty: ${unchecked.map(i => i.name).join(', ')}`])
        throw new Error('Walidacja')
      }

      const now = new Date().toISOString()
      const diffMin = Math.round((Date.now() - new Date(activeChangeover.started_at).getTime()) / 60000)

      await supabase.from('sa_changeovers').update({ ended_at: now, duration_min: diffMin }).eq('id', activeChangeover.id)

      await supabase.from('sa_sessions').update({
        assortment_id: activeChangeover.to_assortment_id,
        machine_status: 'production'
      }).eq('id', session.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_active_changeover', session?.id] })
      qc.invalidateQueries({ queryKey: ['sa_my_session'] })
      navigate('/syringe')
    },
    onError: (e: Error) => {
      if (e.message !== 'Walidacja') setErrors([e.message])
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
          <h1 className="text-xl font-bold text-white">Przezbrojenie</h1>
          <p className="text-navy-400 text-sm">{session.machine?.name}</p>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
        </div>
      )}

      {activeChangeover ? (
        /* Aktywne przezbrojenie — checklista */
        <div className="space-y-4">
          <div className="rounded-2xl border-2 border-yellow-500/40 bg-yellow-500/5 p-5 space-y-2">
            <div className="font-bold text-yellow-300">Przezbrojenie w toku</div>
            <div className="text-sm text-navy-300">
              {activeChangeover.from_assortment?.name ?? 'Poprzedni'} → <strong className="text-white">{activeChangeover.to_assortment.name}</strong>
            </div>
            <div className="text-xs text-navy-500">
              Rozpoczęto: {new Date(activeChangeover.started_at).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>

          <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400">
              Checklista przezbrojenia
              <span className="ml-2 text-navy-500 normal-case font-normal">
                ({completedIds.size}/{checklistItems.length})
              </span>
            </div>
            {checklistItems.map(item => {
              const done = completedIds.has(item.id)
              return (
                <label key={item.id} className="flex items-start gap-3 cursor-pointer group">
                  <div
                    onClick={() => toggleItemMutation.mutate({ itemId: item.id, checked: !done })}
                    className={`mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                      done
                        ? 'border-green-500 bg-green-500 text-white'
                        : 'border-navy-500 bg-navy-900 group-hover:border-brand'
                    }`}
                  >
                    {done && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <div>
                    <div className={`text-sm ${done ? 'text-navy-400 line-through' : 'text-white'}`}>{item.name}</div>
                    {item.is_required && !done && (
                      <div className="text-xs text-amber-500 mt-0.5">Wymagane</div>
                    )}
                  </div>
                </label>
              )
            })}
          </div>

          <button
            onClick={() => { setErrors([]); endMutation.mutate() }}
            disabled={endMutation.isPending}
            className="w-full py-4 rounded-2xl bg-green-600 text-white font-bold text-lg disabled:opacity-40 hover:bg-green-500 transition-all"
          >
            {endMutation.isPending ? 'Kończenie...' : 'Zakończ przezbrojenie i uruchom produkcję'}
          </button>
        </div>
      ) : (
        /* Formularz nowego przezbrojenia */
        <div className="space-y-4">
          <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
            <div className="text-xs text-navy-400 uppercase tracking-wider">Aktualny asortyment</div>
            <div className="text-white font-bold">{session.assortment?.name ?? '—'}</div>
          </div>

          <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Nowy asortyment *</div>
            <div className="grid grid-cols-2 gap-3">
              {assortments
                .filter(a => a.id !== session.assortment_id)
                .map(a => (
                  <button
                    key={a.id}
                    onClick={() => { setToAssortmentId(a.id); setErrors([]) }}
                    className={`rounded-xl border-2 p-4 text-left transition-all ${
                      toAssortmentId === a.id
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-navy-600 text-white hover:border-navy-500'
                    }`}
                  >
                    <div className="font-bold text-sm">{a.name}</div>
                    <div className="text-xs text-navy-400 mt-1">{a.nominal_per_hour} szt/h</div>
                  </button>
                ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Stan licznika przed</div>
              <input
                type="number"
                value={counterBefore}
                onChange={e => setCounterBefore(e.target.value)}
                placeholder="np. 123456"
                min={0}
                className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-brand"
              />
            </div>
            <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Powód przezbrojenia</div>
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="np. Zmiana planu, koniec zlecenia..."
                className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-brand"
              />
            </div>
          </div>

          <button
            onClick={() => { setErrors([]); startMutation.mutate() }}
            disabled={startMutation.isPending || !toAssortmentId}
            className="w-full py-4 rounded-2xl bg-yellow-600 text-white font-bold text-lg disabled:opacity-40 hover:bg-yellow-500 transition-all"
          >
            {startMutation.isPending ? 'Rozpoczynanie...' : 'Rozpocznij przezbrojenie'}
          </button>
        </div>
      )}
    </div>
  )
}
