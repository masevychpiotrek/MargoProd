import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import Toggle from '@/components/shared/Toggle'
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

export default function SyringeQualityIssue() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [batchNumber, setBatchNumber] = useState('')
  const [description, setDescription] = useState('')
  const [affectedQty, setAffectedQty] = useState('')
  const [operatorActions, setOperatorActions] = useState('')
  const [productionStopped, setProductionStopped] = useState(false)
  const [productSeparated, setProductSeparated] = useState(false)
  const [separationLocation, setSeparationLocation] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [success, setSuccess] = useState(false)

  const { data: session } = useQuery({
    queryKey: ['sa_my_session', profile?.id],
    queryFn: () => fetchMySession(profile!.id),
    enabled: !!profile?.id
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profile || !session) throw new Error('Brak aktywnej sesji.')
      const errs: string[] = []
      if (!description) errs.push('Opisz niezgodność.')
      if (productSeparated && !separationLocation) errs.push('Podaj lokalizację odseparowanego wyrobu.')
      if (errs.length > 0) { setErrors(errs); throw new Error('Walidacja') }

      const { error } = await supabase.from('sa_quality_issues').insert({
        session_id: session.id,
        machine_id: session.machine_id,
        assortment_id: session.assortment_id,
        order_id: session.order_id ?? null,
        reporter_id: profile.id,
        batch_number: batchNumber || null,
        description,
        affected_qty: affectedQty ? parseInt(affectedQty) : null,
        operator_actions: operatorActions || null,
        production_stopped: productionStopped,
        product_separated: productSeparated,
        separation_location: productSeparated ? separationLocation : null
      })
      if (error) throw error

      if (productionStopped) {
        await supabase.from('sa_sessions').update({ machine_status: 'quality_control' }).eq('id', session.id)
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
        <div className="text-5xl text-yellow-400">◆</div>
        <h2 className="text-xl font-bold text-white">Problem zgłoszony</h2>
        <p className="text-navy-400 text-sm">Zgłoszenie jakościowe zostało przekazane do działu jakości, mistrza i kierownika.</p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => { setSuccess(false); setDescription(''); setBatchNumber(''); setAffectedQty('') }} className="btn-secondary px-6 py-3">
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
          <h1 className="text-xl font-bold text-white">Zgłoszenie problemu jakościowego</h1>
          <p className="text-navy-400 text-sm">
            {session?.machine?.name ?? '—'} · {session?.assortment?.name ?? '—'}
          </p>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-1">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-300">• {e}</p>)}
        </div>
      )}

      {/* Partia */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Numer partii komponentów</div>
        <input
          type="text"
          value={batchNumber}
          onChange={e => setBatchNumber(e.target.value)}
          placeholder="np. 2024/06/001"
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-brand font-mono"
        />
      </div>

      {/* Opis niezgodności */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Opis niezgodności *</div>
        <textarea
          value={description}
          onChange={e => { setDescription(e.target.value); setErrors([]) }}
          rows={4}
          placeholder="Dokładny opis wykrytej niezgodności: co, gdzie, jak wygląda, kiedy wykryto..."
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-brand resize-none"
        />
      </div>

      {/* Ilość */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Potencjalnie niezgodnych sztuk</div>
        <input
          type="number"
          value={affectedQty}
          onChange={e => setAffectedQty(e.target.value)}
          placeholder="np. 500"
          min={0}
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-brand"
        />
      </div>

      {/* Działania operatora */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Działania wykonane przez operatora</div>
        <textarea
          value={operatorActions}
          onChange={e => setOperatorActions(e.target.value)}
          rows={3}
          placeholder="Co zrobiłeś po wykryciu niezgodności?"
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-brand resize-none"
        />
      </div>

      {/* Wpływ na produkcję */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Status produkcji i wyrobu</div>

        <Toggle label="Produkcja została zatrzymana" checked={productionStopped} onChange={setProductionStopped} color="red" />
        <Toggle label="Wyrób został odseparowany" checked={productSeparated} onChange={v => { setProductSeparated(v); setErrors([]) }} color="yellow" />

        {productSeparated && (
          <input
            type="text"
            value={separationLocation}
            onChange={e => { setSeparationLocation(e.target.value); setErrors([]) }}
            placeholder="Lokalizacja odseparowanego wyrobu (wymagane)"
            className="w-full bg-navy-900 border border-amber-500/50 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-amber-500"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/syringe')} className="btn-secondary py-4">Anuluj</button>
        <button
          onClick={() => { setErrors([]); saveMutation.mutate() }}
          disabled={saveMutation.isPending}
          className="py-4 rounded-2xl bg-yellow-600 text-white font-bold text-lg disabled:opacity-40 hover:bg-yellow-500 transition-all"
        >
          {saveMutation.isPending ? 'Wysyłanie...' : 'Wyślij zgłoszenie'}
        </button>
      </div>
    </div>
  )
}
