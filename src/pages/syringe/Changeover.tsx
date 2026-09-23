import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { isSyringeCompatible } from '@/lib/syringeCompatibility'
import { supabase } from '@/lib/supabase'
import { useSyringeSession } from '@/hooks/useSyringeSession'
import { useSyringeCommand } from '@/hooks/useSyringeCommand'
import { invalidateSyringe } from '@/lib/syringeApi'
import SyringeSessionState from '@/components/shared/SyringeSessionState'
import { useAuthStore } from '@/stores/authStore'
import type { SaAssortment, SaChangeover, SaChecklistItem } from '@/types/database'

async function fetchAssortments() {
  const { data, error } = await supabase.from('sa_assortments').select('*').eq('is_active', true).order('sort_order')
  if (error) throw error
  if (error) throw error
  return data as SaAssortment[] ?? []
}

async function fetchActiveChangeover(sessionId: string) {
  const { data, error } = await supabase
    .from('sa_changeovers')
    .select('*, from_assortment:sa_assortments!sa_changeovers_from_assortment_id_fkey(*), to_assortment:sa_assortments!sa_changeovers_to_assortment_id_fkey(*)')
    .eq('session_id', sessionId)
    .is('ended_at', null)
    .maybeSingle()
  if (error) throw error
  if (error) throw error
  return data as (SaChangeover & { from_assortment?: SaAssortment; to_assortment: SaAssortment }) | null
}

async function fetchChecklistItems() {
  const { data, error } = await supabase.from('sa_checklist_items').select('*').eq('is_active', true).order('sort_order')
  if (error) throw error
  if (error) throw error
  return data as SaChecklistItem[] ?? []
}

async function fetchChecklistCompletions(changeoverId: string) {
  const { data, error } = await supabase.from('sa_checklist_completions').select('*').eq('changeover_id', changeoverId)
  if (error) throw error
  if (error) throw error
  return data as { item_id: string; completed: boolean }[] ?? []
}

export default function SyringeChangeover() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const command = useSyringeCommand()

  const [toAssortmentId, setToAssortmentId] = useState('')
  const [printBefore, setPrintBefore] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const [counterBefore, setCounterBefore] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  const { data: session, isLoading, error: sessionError, refetch: refetchSession } = useSyringeSession()

  const { data: assortments = [], error: assortmentsError } = useQuery({ queryKey: ['sa_assortments'], queryFn: fetchAssortments })
  const { data: checklistItems = [], error: checklistError } = useQuery({ queryKey: ['sa_checklist_items'], queryFn: fetchChecklistItems })

  const { data: activeChangeover, error: changeoverError } = useQuery({
    queryKey: ['sa_active_changeover', session?.id],
    queryFn: () => fetchActiveChangeover(session!.id),
    enabled: !!session?.id
  })

  const { data: completions = [], error: completionsError } = useQuery({
    queryKey: ['sa_checklist_completions', activeChangeover?.id],
    queryFn: () => fetchChecklistCompletions(activeChangeover!.id),
    enabled: !!activeChangeover?.id
  })

  const completedIds = new Set(completions.filter(c => c.completed).map(c => c.item_id))

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!session || !profile) throw new Error('Brak aktywnej sesji.')
      const errs: string[] = []
      if (!isSyringeCompatible(session.machine, assortments.find(a => a.id === toAssortmentId))) errs.push('Wybierz asortyment zgodny z rozmiarem linii.')
      if (errs.length > 0) { setErrors(errs); throw new Error('Walidacja') }

      await command('changeover_start', { session_id: session.id, to_assortment_id: toAssortmentId, counter_before: counterBefore || '0', print_before: printBefore || '0', reason })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_active_changeover', session?.id] })
      void invalidateSyringe(qc)
    },
    onError: (e: Error) => {
      if (e.message !== 'Walidacja') setErrors([e.message])
    }
  })

  const toggleItemMutation = useMutation({
    mutationFn: async ({ itemId, checked }: { itemId: string; checked: boolean }) => {
      if (!activeChangeover || !profile) return
      await command('checklist', { session_id: session!.id, changeover_id: activeChangeover.id, item_id: itemId, completed: checked })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa_checklist_completions', activeChangeover?.id] }),
    onError: (e: Error) => setErrors([e.message])
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

      await command('changeover_end', { session_id: session.id, event_id: activeChangeover.id, to_assortment_id: toAssortmentId || activeChangeover.to_assortment_id })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_active_changeover', session?.id] })
      void invalidateSyringe(qc)
      navigate('/syringe')
    },
    onError: (e: Error) => {
      if (e.message !== 'Walidacja') setErrors([e.message])
    }
  })

  const loadError = assortmentsError || checklistError || changeoverError || completionsError
  if (loadError) return <div role="alert" className="p-5 text-red-400">
    Nie udało się odczytać danych: {loadError.message}
    <button className="btn-secondary ml-2" onClick={() => window.location.reload()}>Ponów odczyt</button>
  </div>

  if (!session || sessionError) {
    return <SyringeSessionState loading={isLoading} error={sessionError} retry={refetchSession} />
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

          <label className="block text-sm text-white">Asortyment po przezbrojeniu
            <select className="input mt-2" value={toAssortmentId || activeChangeover.to_assortment_id} onChange={e => setToAssortmentId(e.target.value)}>
              {assortments.filter(a => a.id !== session.assortment_id && isSyringeCompatible(session.machine, a)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <p className="text-yellow-300">Czas przezbrojenia: {Math.max(0, Math.floor((now - new Date(activeChangeover.started_at).getTime()) / 1000))} s</p>
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
                  <input
                    type="checkbox"
                    checked={done}
                    disabled={toggleItemMutation.isPending}
                    onChange={e => toggleItemMutation.mutate({ itemId: item.id, checked: e.target.checked })}
                    className="mt-0.5 h-6 w-6 shrink-0 accent-green-500"
                  />
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
            disabled={endMutation.isPending || toggleItemMutation.isPending}
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
                .filter(a => a.id !== session.assortment_id && isSyringeCompatible(session.machine, a))
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
                    <div className="text-xs text-navy-400 mt-1">
                      {a.shift_target_qty ? `Cel zmiany: ${a.shift_target_qty.toLocaleString('pl')} szt` : 'Brak celu zmianowego'}
                    </div>
                  </button>
                ))}
            </div>
          </div>

          <p className="text-sm text-navy-300">Przed rozpoczęciem zapisz bieżący wynik produkcji wraz z brakami. Przezbrojenie nie zmienia rozmiaru linii.</p>
          <label className="block text-sm text-white">Stan druku przed
            <input type="number" min={0} value={printBefore} onChange={e => setPrintBefore(e.target.value)} placeholder="Stan druku przed" className="input mt-2" />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Stan montażu przed</div>
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
