import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { SaMachine, SaAssortment, SaOrder } from '@/types/database'

type ShiftType = 'I' | 'II' | 'III'

async function fetchMachines() {
  const r = await supabase.from('sa_machines').select('*').eq('is_active', true).is('deleted_at', null).order('sort_order')
  return r.data as SaMachine[] ?? []
}

async function fetchAssortments() {
  const r = await supabase.from('sa_assortments').select('*').eq('is_active', true).order('sort_order')
  return r.data as SaAssortment[] ?? []
}

async function fetchOpenOrders(machineId: string, assortmentId: string) {
  const r = await supabase.from('sa_orders').select('*, assortment:sa_assortments(*)').eq('machine_id', machineId).eq('assortment_id', assortmentId).in('status', ['planned', 'in_progress']).order('planned_date')
  return r.data as SaOrder[] ?? []
}

async function fetchActiveSession(machineId: string) {
  const r = await supabase.from('sa_sessions').select('id, operator_id, shift_type, started_at').eq('machine_id', machineId).is('ended_at', null).maybeSingle()
  return r.data
}

export default function SyringeSessionStart() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [shift, setShift] = useState<ShiftType>('I')
  const [machineId, setMachineId] = useState('')
  const [assortmentId, setAssortmentId] = useState('')
  const [orderId, setOrderId] = useState('')
  const [planQty, setPlanQty] = useState('')
  const [error, setError] = useState('')

  const { data: machines = [] } = useQuery({ queryKey: ['sa_machines'], queryFn: fetchMachines })
  const { data: assortments = [] } = useQuery({ queryKey: ['sa_assortments'], queryFn: fetchAssortments })
  const { data: orders = [] } = useQuery({
    queryKey: ['sa_orders', machineId, assortmentId],
    queryFn: () => fetchOpenOrders(machineId, assortmentId),
    enabled: !!machineId && !!assortmentId
  })
  const { data: activeSession } = useQuery({
    queryKey: ['sa_active_session', machineId],
    queryFn: () => fetchActiveSession(machineId),
    enabled: !!machineId
  })

  const selectedAssortment = assortments.find(a => a.id === assortmentId)
  const selectedMachine = machines.find(m => m.id === machineId)

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Brak profilu użytkownika.')
      if (!machineId) throw new Error('Nie wybrano automatu.')
      if (!assortmentId) throw new Error('Nie wybrano asortymentu.')

      if (activeSession) {
        throw new Error('Na tym automacie istnieje już aktywna sesja. Skontaktuj się z mistrzem.')
      }

      const { data, error } = await supabase
        .from('sa_sessions')
        .insert({
          machine_id: machineId,
          operator_id: profile.id,
          assortment_id: assortmentId,
          order_id: orderId || null,
          shift_type: shift,
          session_date: new Date().toISOString().split('T')[0],
          plan_qty: planQty ? parseInt(planQty) : null,
          machine_status: 'production'
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa_sessions'] })
      qc.invalidateQueries({ queryKey: ['sa_active_session'] })
      navigate('/syringe')
    },
    onError: (e: Error) => setError(e.message)
  })

  const shiftColors: Record<ShiftType, string> = {
    I: 'border-blue-500 bg-blue-500/10 text-blue-300',
    II: 'border-yellow-500 bg-yellow-500/10 text-yellow-300',
    III: 'border-purple-500 bg-purple-500/10 text-purple-300'
  }

  return (
    <div className="max-w-xl mx-auto space-y-6 py-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Rozpocznij zmianę</h1>
        <p className="text-navy-400 text-sm mt-1">Operator automatów strzykawkowych</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Zmiana */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Numer zmiany</div>
        <div className="grid grid-cols-3 gap-3">
          {(['I', 'II', 'III'] as ShiftType[]).map(s => (
            <button
              key={s}
              onClick={() => setShift(s)}
              className={`rounded-xl border-2 py-4 text-lg font-bold transition-all ${
                shift === s ? shiftColors[s] : 'border-navy-600 text-navy-400 hover:border-navy-500'
              }`}
            >
              Zmiana {s}
            </button>
          ))}
        </div>
      </div>

      {/* Automat */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Automat</div>
        {machines.length === 0 ? (
          <p className="text-navy-500 text-sm">Brak aktywnych automatów. Skontaktuj się z administratorem.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {machines.map(m => {
              const isActive = activeSession !== null && activeSession !== undefined
              return (
                <button
                  key={m.id}
                  onClick={() => { setMachineId(m.id); setError('') }}
                  className={`rounded-xl border-2 p-4 text-left transition-all ${
                    machineId === m.id
                      ? 'border-brand bg-brand/10 text-brand'
                      : isActive && machineId === m.id
                        ? 'border-red-500/50 bg-red-500/5 text-red-300'
                        : 'border-navy-600 text-white hover:border-navy-500'
                  }`}
                >
                  <div className="font-bold">{m.name}</div>
                  <div className="text-xs text-navy-400 mt-1">{m.code}</div>
                  {m.location && <div className="text-xs text-navy-500 mt-0.5">{m.location}</div>}
                </button>
              )
            })}
          </div>
        )}
        {machineId && activeSession && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            Na tym automacie jest aktywna sesja (zmiana {activeSession.shift_type}).
            Skontaktuj się z mistrzem.
          </div>
        )}
      </div>

      {/* Asortyment */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">Asortyment</div>
        {assortments.length === 0 ? (
          <p className="text-navy-500 text-sm">Brak asortymentów. Skontaktuj się z administratorem.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {assortments.map(a => (
              <button
                key={a.id}
                onClick={() => { setAssortmentId(a.id); setOrderId(''); setError('') }}
                className={`rounded-xl border-2 p-4 text-left transition-all ${
                  assortmentId === a.id
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-navy-600 text-white hover:border-navy-500'
                }`}
              >
                <div className="font-bold text-sm">{a.name}</div>
                <div className="text-xs text-navy-400 mt-1">{a.nominal_per_hour} szt/h nominalne</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Zlecenie (opcjonalne) */}
      {machineId && assortmentId && (
        <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-navy-400">
            Zlecenie produkcyjne <span className="text-navy-500 normal-case font-normal">(opcjonalne)</span>
          </div>
          {orders.length > 0 ? (
            <div className="space-y-2">
              {orders.map(o => (
                <button
                  key={o.id}
                  onClick={() => {
                    setOrderId(o.id)
                    setPlanQty(String(o.target_qty - o.produced_qty))
                  }}
                  className={`w-full rounded-xl border-2 p-4 text-left transition-all ${
                    orderId === o.id
                      ? 'border-brand bg-brand/10'
                      : 'border-navy-600 hover:border-navy-500'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-white">{o.order_number}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      o.status === 'in_progress' ? 'bg-green-500/20 text-green-300' : 'bg-blue-500/20 text-blue-300'
                    }`}>{o.status === 'in_progress' ? 'W toku' : 'Zaplanowane'}</span>
                  </div>
                  <div className="text-xs text-navy-400 mt-1">
                    Cel: {o.target_qty.toLocaleString('pl')} · Wykonano: {o.produced_qty.toLocaleString('pl')} · Pozostało: {(o.target_qty - o.produced_qty).toLocaleString('pl')}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-navy-500 text-sm">Brak otwartych zleceń dla tego automatu i asortymentu.</p>
          )}
        </div>
      )}

      {/* Plan na zmianę */}
      <div className="rounded-2xl border border-navy-700 bg-navy-800 p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400">
          Plan na zmianę <span className="text-navy-500 normal-case font-normal">(opcjonalne)</span>
        </div>
        <input
          type="number"
          value={planQty}
          onChange={e => setPlanQty(e.target.value)}
          placeholder={selectedAssortment ? `Nominalna: ${selectedAssortment.nominal_per_hour * 8} szt` : 'np. 8000'}
          className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-brand"
          min={0}
        />
        {selectedMachine && selectedAssortment && (
          <p className="text-xs text-navy-500">
            Nominalna wydajność: {selectedAssortment.nominal_per_hour} szt/h ·
            Automat: {selectedMachine.nominal_per_hour} szt/h
          </p>
        )}
      </div>

      {/* Podsumowanie i przycisk */}
      {machineId && assortmentId && (
        <div className="rounded-2xl border border-brand/30 bg-brand/5 p-5 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-brand">Podsumowanie</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-navy-400">Operator:</span>
            <span className="text-white font-medium">{profile?.full_name}</span>
            <span className="text-navy-400">Zmiana:</span>
            <span className="text-white font-medium">{shift}</span>
            <span className="text-navy-400">Automat:</span>
            <span className="text-white font-medium">{selectedMachine?.name}</span>
            <span className="text-navy-400">Asortyment:</span>
            <span className="text-white font-medium">{selectedAssortment?.name}</span>
            {planQty && (
              <>
                <span className="text-navy-400">Plan:</span>
                <span className="text-white font-medium">{parseInt(planQty).toLocaleString('pl')} szt</span>
              </>
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => { setError(''); startMutation.mutate() }}
        disabled={!machineId || !assortmentId || startMutation.isPending || !!activeSession}
        className="w-full py-4 rounded-2xl bg-brand text-navy-900 font-bold text-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand/90 transition-all"
      >
        {startMutation.isPending ? 'Rozpoczynanie...' : 'Rozpocznij zmianę'}
      </button>
    </div>
  )
}
