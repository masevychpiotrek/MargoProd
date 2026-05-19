import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { supabase, getMachines, getProfiles } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Machine, Profile, ShiftType } from '@/types/database'

interface ProductionOrder {
  id: string
  order_number: string
  target_qty: number
  produced_qty: number
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  notes: string | null
}

export default function OperatorShift() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { activeShift, activeMachine, startShift, endShift, isLoading } = useShiftStore()
  const [machines, setMachines] = useState<Machine[]>([])
  const [operators, setOperators] = useState<Profile[]>([])
  const [selectedMachine, setSelectedMachine] = useState('')
  const [selectedShift, setSelectedShift] = useState<ShiftType>('I')
  const [selectedOp2, setSelectedOp2] = useState('')
  const [error, setError] = useState('')

  // Zlecenia
  const [orders, setOrders] = useState<ProductionOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [showNewOrder, setShowNewOrder] = useState(false)
  const [newOrderNumber, setNewOrderNumber] = useState('')
  const [newOrderTarget, setNewOrderTarget] = useState('')
  const [newOrderNotes, setNewOrderNotes] = useState('')

  useEffect(() => {
    getMachines().then(({ data }) => { if (data) setMachines(data as Machine[]) })
    getProfiles().then(({ data }) => { if (data) setOperators(data as Profile[]) })
    const h = new Date().getHours()
    if (h >= 6 && h < 14) setSelectedShift('I')
    else if (h >= 14 && h < 22) setSelectedShift('II')
    else setSelectedShift('III')
  }, [])

  useEffect(() => {
    if (selectedMachine) loadOrders(selectedMachine)
  }, [selectedMachine])

  const loadOrders = async (machineId: string) => {
    const { data } = await supabase
      .from('production_orders')
      .select('*')
      .eq('machine_id', machineId)
      .in('status', ['active', 'paused'])
      .order('created_at', { ascending: false })
    if (data) setOrders(data as ProductionOrder[])
  }

  const handleStart = async () => {
    if (!selectedMachine) { setError('Wybierz maszynę'); return }
    setError('')

    // Jeśli nowe zlecenie — utwórz je najpierw
    let orderId = selectedOrderId
    if (showNewOrder && newOrderNumber) {
      const { data, error: orderError } = await supabase
        .from('production_orders')
        .insert({
          order_number: newOrderNumber,
          machine_id: selectedMachine,
          target_qty: parseInt(newOrderTarget) || 0,
          status: 'active',
          created_by: profile?.id,
          notes: newOrderNotes || null
        })
        .select().single()
      if (orderError) { setError('Błąd tworzenia zlecenia: ' + orderError.message); return }
      orderId = data.id
    } else if (orderId) {
      // Aktywuj wybrane zlecenie
      await supabase.from('production_orders').update({ status: 'active', paused_at: null }).eq('id', orderId)
    }

    const { error: shiftError } = await startShift(selectedMachine, selectedShift, selectedOp2 || undefined)
    if (shiftError) { setError(shiftError); return }

    navigate('/operator/report')
  }

  const handleEnd = async () => {
    if (!confirm('Zakończyć zmianę?')) return
    await endShift()
  }

  // ── ACTIVE SHIFT VIEW ────────────────────────────────────────────────────
  if (activeShift && activeMachine) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Moja zmiana</h1>
          <p className="text-navy-400 mt-1">Aktywna zmiana produkcyjna</p>
        </div>
        <div className="card mb-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 font-semibold text-sm">Zmiana aktywna</span>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-navy-900 rounded-xl p-4">
              <div className="label">Maszyna</div>
              <div className="text-xl font-bold text-white">{activeMachine.name}</div>
              <div className="text-xs text-navy-400 mt-1">Target: {activeMachine.target_per_hour} szt/h</div>
            </div>
            <div className="bg-navy-900 rounded-xl p-4">
              <div className="label">Zmiana</div>
              <div className="text-xl font-bold text-white">Zmiana {activeShift.shift_type}</div>
              <div className="text-xs text-navy-400 mt-1">{activeShift.shift_date}</div>
            </div>
            <div className="bg-navy-900 rounded-xl p-4">
              <div className="label">Operator</div>
              <div className="text-base font-bold text-white">{profile?.full_name}</div>
            </div>
            <div className="bg-navy-900 rounded-xl p-4">
              <div className="label">Start</div>
              <div className="text-base font-bold text-white font-mono">
                {new Date(activeShift.started_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => navigate('/operator/report')} className="btn-primary flex-1 py-3 text-base">
              ✏️ Wpisz wynik godziny
            </button>
            <button onClick={handleEnd} className="btn-danger px-6 py-3">
              Zakończ zmianę
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── START SHIFT VIEW ─────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Rozpocznij zmianę</h1>
        <p className="text-navy-400 mt-1">Wybierz maszynę, zmianę i zlecenie</p>
      </div>

      <div className="card space-y-5">
        {/* Maszyna */}
        <div>
          <label className="label">Maszyna</label>
          <div className="grid grid-cols-2 gap-3">
            {machines.map(m => (
              <button key={m.id} onClick={() => setSelectedMachine(m.id)}
                className={cn('p-4 rounded-xl border-2 text-left transition-all',
                  selectedMachine === m.id ? 'border-brand bg-brand/10 text-white' : 'border-navy-600 bg-navy-900 text-navy-300 hover:border-navy-500'
                )}>
                <div className="text-lg font-bold">🤖 {m.name}</div>
                <div className="text-xs mt-1 opacity-70">Target: {m.target_per_hour} szt/h</div>
              </button>
            ))}
          </div>
        </div>

        {/* Zmiana */}
        <div>
          <label className="label">Zmiana</label>
          <div className="grid grid-cols-3 gap-2">
            {(['I','II','III'] as ShiftType[]).map(s => (
              <button key={s} onClick={() => setSelectedShift(s)}
                className={cn('p-3 rounded-xl border-2 text-center transition-all',
                  selectedShift === s ? 'border-brand bg-brand/10 text-white' : 'border-navy-600 bg-navy-900 text-navy-300 hover:border-navy-500'
                )}>
                <div className="text-lg font-bold">Zmiana {s}</div>
                <div className="text-xs mt-0.5 opacity-70">{s === 'I' ? '06–14' : s === 'II' ? '14–22' : '22–06'}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Zlecenie produkcyjne */}
        {selectedMachine && (
          <div>
            <label className="label">Zlecenie produkcyjne</label>

            {!showNewOrder ? (
              <div className="space-y-2">
                {orders.length > 0 && (
                  <>
                    <div className="text-xs text-navy-400 mb-2">Wybierz istniejące zlecenie:</div>
                    {orders.map(o => (
                      <button key={o.id} onClick={() => setSelectedOrderId(o.id)}
                        className={cn('w-full p-3 rounded-xl border-2 text-left transition-all',
                          selectedOrderId === o.id ? 'border-brand bg-brand/10' : 'border-navy-600 bg-navy-900 hover:border-navy-500'
                        )}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-bold font-mono text-white">{o.order_number}</div>
                            <div className="text-xs text-navy-400 mt-0.5">
                              {o.produced_qty.toLocaleString('pl-PL')} szt
                              {o.target_qty > 0 && ` / ${o.target_qty.toLocaleString('pl-PL')} szt`}
                            </div>
                          </div>
                          <span className={cn('text-xs font-bold', o.status === 'active' ? 'text-green-400' : 'text-amber-400')}>
                            {o.status === 'active' ? '● AKTYWNE' : '⏸ ZAPAUZOWANE'}
                          </span>
                        </div>
                        {o.target_qty > 0 && (
                          <div className="h-1 bg-navy-700 rounded mt-2 overflow-hidden">
                            <div className="h-full bg-brand rounded" style={{ width: `${Math.min(o.produced_qty / o.target_qty * 100, 100)}%` }} />
                          </div>
                        )}
                      </button>
                    ))}
                    <div className="text-xs text-navy-500 text-center py-1">lub</div>
                  </>
                )}
                <button onClick={() => { setShowNewOrder(true); setSelectedOrderId('') }}
                  className="w-full p-3 rounded-xl border-2 border-dashed border-navy-600 text-navy-400 hover:border-brand hover:text-brand transition-all text-sm">
                  + Nowe zlecenie
                </button>
                {orders.length > 0 && (
                  <button onClick={() => setSelectedOrderId('')}
                    className={cn('w-full p-2 rounded-xl text-xs transition-all', !selectedOrderId && !showNewOrder ? 'bg-navy-700 text-white' : 'text-navy-500 hover:text-navy-300')}>
                    Bez zlecenia
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-navy-900 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-bold text-white">Nowe zlecenie</div>
                  <button onClick={() => setShowNewOrder(false)} className="text-navy-400 hover:text-white text-xs">Anuluj</button>
                </div>
                <div>
                  <label className="label">Numer zlecenia</label>
                  <input value={newOrderNumber} onChange={e => setNewOrderNumber(e.target.value)}
                    placeholder="Z/01/05/26" className="input font-mono" />
                </div>
                <div>
                  <label className="label">Wielkość zlecenia (szt)</label>
                  <input type="number" value={newOrderTarget} onChange={e => setNewOrderTarget(e.target.value)}
                    placeholder="np. 50000" className="input font-bold font-mono" />
                </div>
                <div>
                  <label className="label">Uwagi</label>
                  <input value={newOrderNotes} onChange={e => setNewOrderNotes(e.target.value)}
                    placeholder="Opcjonalnie..." className="input" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Operatorzy */}
        <div>
          <label className="label">Operator Moduł 1</label>
          <div className="input bg-navy-700 text-navy-300 cursor-not-allowed">{profile?.full_name} (Ty)</div>
        </div>
        <div>
          <label className="label">Operator Moduł 2 <span className="text-navy-500 font-normal normal-case">(opcjonalnie)</span></label>
          <select value={selectedOp2} onChange={e => setSelectedOp2(e.target.value)} className="input">
            <option value="">— Brak drugiego operatora —</option>
            {operators.filter(o => o.id !== profile?.id).map(o => (
              <option key={o.id} value={o.id}>{o.full_name}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
        )}

        <button onClick={handleStart} disabled={isLoading || !selectedMachine}
          className="btn-primary w-full py-4 text-base">
          {isLoading ? 'Uruchamianie...' : '🚀 Rozpocznij zmianę'}
        </button>
      </div>
    </div>
  )
}
