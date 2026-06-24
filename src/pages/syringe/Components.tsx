import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { SaSession, SaComponentUsage } from '@/types/database'

const COMPONENT_TYPES = [
  { value: 'body',           label: 'Korpus' },
  { value: 'piston',         label: 'Tłoczysko' },
  { value: 'seal',           label: 'Uszczelka' },
  { value: 'packaging',      label: 'Opakowanie' },
  { value: 'label',          label: 'Etykieta' },
  { value: 'print_material', label: 'Materiał do nadruku' },
  { value: 'other',          label: 'Inny komponent' }
]

async function fetchMySession(operatorId: string) {
  const { data } = await supabase
    .from('sa_sessions')
    .select('*, machine:sa_machines(*), assortment:sa_assortments(*)')
    .eq('operator_id', operatorId)
    .is('ended_at', null)
    .maybeSingle()
  return data as SaSession | null
}

async function fetchSessionComponents(sessionId: string) {
  const { data } = await supabase
    .from('sa_component_usages')
    .select('*')
    .eq('session_id', sessionId)
    .order('used_from', { ascending: false })
  return data as SaComponentUsage[] ?? []
}

export default function SyringeComponents() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [componentType, setComponentType] = useState('body')
  const [componentName, setComponentName] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [qtyUsed, setQtyUsed] = useState('')
  const [unit, setUnit] = useState('szt')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  const { data: session } = useQuery({
    queryKey: ['sa_my_session', profile?.id],
    queryFn: () => fetchMySession(profile!.id),
    enabled: !!profile?.id
  })

  const { data: components = [] } = useQuery({
    queryKey: ['sa_components', session?.id],
    queryFn: () => fetchSessionComponents(session!.id),
    enabled: !!session?.id
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profile || !session) throw new Error('Brak aktywnej sesji.')
      const errs: string[] = []
      if (!componentName) errs.push('Podaj nazwę komponentu.')
      if (errs.length > 0) { setErrors(errs); throw new Error('Walidacja') }

      const { error } = await supabase.from('sa_component_usages').insert({
        session_id: session.id,
        operator_id: profile.id,
        component_type: componentType,
        component_name: componentName,
        batch_number: batchNumber || null,
        qty_used: qtyUsed ? parseFloat(qtyUsed) : null,
        unit,
        notes: notes || null
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_components', session?.id] })
      setComponentName('')
      setBatchNumber('')
      setQtyUsed('')
      setNotes('')
    },
    onError: (e: Error) => {
      if (e.message !== 'Walidacja') setErrors([e.message])
    }
  })

  const endMutation = useMutation({
    mutationFn: async (componentId: string) => {
      await supabase.from('sa_component_usages').update({ used_to: new Date().toISOString() }).eq('id', componentId)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa_components', session?.id] })
  })

  if (!session) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="text-navy-400">Brak aktywnej sesji.</p>
        <button onClick={() => navigate('/syringe')} className="btn-primary mt-4">Wróć</button>
      </div>
    )
  }

  const activeComponents = components.filter(c => !c.used_to)
  const endedComponents = components.filter(c => !!c.used_to)

  return (
    <div className="max-w-2xl mx-auto space-y-5 py-2">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/syringe')} className="text-navy-400 hover:text-white">←</button>
        <div>
          <h1 className="text-xl font-bold text-white">Komponenty</h1>
          <p className="text-navy-400 text-sm">{session.machine?.name} · {session.assortment?.name}</p>
        </div>
      </div>

      {/* Aktywne komponenty */}
      {activeComponents.length > 0 && (
        <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-green-400">Aktualnie używane</div>
          {activeComponents.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-4 rounded-xl bg-navy-800 border border-navy-700 p-4">
              <div>
                <div className="font-medium text-white">{c.component_name}</div>
                <div className="text-xs text-navy-400 mt-0.5">
                  {COMPONENT_TYPES.find(t => t.value === c.component_type)?.label ?? c.component_type}
                  {c.batch_number && <> · Partia: <span className="font-mono">{c.batch_number}</span></>}
                </div>
              </div>
              <button
                onClick={() => endMutation.mutate(c.id)}
                className="shrink-0 rounded-lg border border-navy-600 px-3 py-1.5 text-xs text-navy-300 hover:border-red-500/40 hover:text-red-300"
              >
                Zakończ użycie
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Formularz dodania komponentu */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Dodaj / zmień komponent</div>

        {errors.length > 0 && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 space-y-1">
            {errors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
          </div>
        )}

        <div>
          <label className="text-sm text-navy-400 mb-2 block">Typ komponentu</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {COMPONENT_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setComponentType(t.value)}
                className={`rounded-xl border px-3 py-2.5 text-sm text-left transition-all ${
                  componentType === t.value
                    ? 'border-brand bg-brand/10 text-brand font-medium'
                    : 'border-navy-600 text-navy-300 hover:border-navy-500'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-navy-400 mb-2 block">Nazwa / indeks *</label>
            <input
              type="text"
              value={componentName}
              onChange={e => { setComponentName(e.target.value); setErrors([]) }}
              placeholder="np. Korpus 5ml PP"
              className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="text-sm text-navy-400 mb-2 block">Numer partii</label>
            <input
              type="text"
              value={batchNumber}
              onChange={e => setBatchNumber(e.target.value)}
              placeholder="np. 2024/07/A1"
              className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-brand font-mono"
            />
          </div>
          <div>
            <label className="text-sm text-navy-400 mb-2 block">Ilość</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={qtyUsed}
                onChange={e => setQtyUsed(e.target.value)}
                placeholder="0"
                min={0}
                className="flex-1 bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-brand"
              />
              <select
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className="bg-navy-900 border border-navy-600 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-brand"
              >
                <option value="szt">szt</option>
                <option value="kg">kg</option>
                <option value="m">m</option>
                <option value="rolka">rolka</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm text-navy-400 mb-2 block">Uwagi</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Opcjonalne uwagi"
              className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-brand"
            />
          </div>
        </div>

        <button
          onClick={() => { setErrors([]); saveMutation.mutate() }}
          disabled={saveMutation.isPending}
          className="w-full py-3 rounded-xl bg-brand text-navy-900 font-bold disabled:opacity-40 hover:bg-brand/90 transition-all"
        >
          {saveMutation.isPending ? 'Zapisywanie...' : 'Zapisz komponent'}
        </button>
      </div>

      {/* Historia */}
      {endedComponents.length > 0 && (
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Historia zmian komponentów</div>
          {endedComponents.map(c => (
            <div key={c.id} className="rounded-xl bg-navy-900 border border-navy-700 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-white">{c.component_name}</span>
                <span className="text-navy-500 text-xs">
                  {new Date(c.used_from).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}
                  {c.used_to && ` – ${new Date(c.used_to).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}`}
                </span>
              </div>
              {c.batch_number && <div className="text-navy-400 text-xs mt-0.5 font-mono">Partia: {c.batch_number}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
