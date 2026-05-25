import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { supabase, getMachines, getProfiles } from '@/lib/supabase'
import { canEnterHourlyReport, cn, formatHourBlock, getReportEntryOpenAt, getShiftAutoCloseAt, getShiftDateForStart, getShiftEndAt, SHIFT_HOURS } from '@/lib/utils'
import type { HourlyReport, Machine, Profile, ShiftType } from '@/types/database'

interface ProductionOrder {
  id: string; order_number: string; target_qty: number
  produced_qty: number; status: 'active' | 'paused' | 'completed' | 'cancelled'
  notes: string | null; assortment_id: string | null
  assortment?: { name: string }
}
interface Assortment { id: string; name: string; code: string }

function minsToHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

// Godziny poszczególnych zmian
export default function OperatorShift() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { activeShift, activeMachine, startShift, endShift, isLoading } = useShiftStore()
  const [machines, setMachines]     = useState<Machine[]>([])
  const [operators, setOperators]   = useState<Profile[]>([])
  const [assortments, setAssortments] = useState<Assortment[]>([])
  const [selectedMachine, setSelectedMachine] = useState('')
  const [selectedShift,   setSelectedShift]   = useState<ShiftType>('I')
  const [selectedOp2,     setSelectedOp2]     = useState('')
  const [error, setError] = useState('')

  // Zlecenia
  const [orders,         setOrders]         = useState<ProductionOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [showNewOrder,   setShowNewOrder]   = useState(false)
  const [newOrderNumber, setNewOrderNumber] = useState('')
  const [newOrderTarget, setNewOrderTarget] = useState('')
  const [newOrderAssortment, setNewOrderAssortment] = useState('')
  const [newOrderNotes,  setNewOrderNotes]  = useState('')

  // Ostrzeżenie przy kończeniu zmiany
  const [showEndWarning, setShowEndWarning] = useState(false)
  const [missingHours,   setMissingHours]   = useState<number[]>([])
  const [shiftReports,   setShiftReports]   = useState<HourlyReport[]>([])

  useEffect(() => {
    getMachines().then(({ data }) => { if (data) setMachines(data as Machine[]) })
    getProfiles().then(({ data }) => { if (data) setOperators(data as Profile[]) })
    supabase.from('assortments').select('*').eq('is_active', true).order('sort_order')
      .then(({ data }) => { if (data) setAssortments(data as Assortment[]) })
    const h = new Date().getHours()
    if (h >= 6 && h < 14) setSelectedShift('I')
    else if (h >= 14 && h < 22) setSelectedShift('II')
    else setSelectedShift('III')
  }, [])

  useEffect(() => {
    if (selectedMachine) loadOrders(selectedMachine)
  }, [selectedMachine])

  useEffect(() => {
    if (!activeShift) return

    loadShiftReports()
    const channel = supabase
      .channel(`operator-shift-summary-${activeShift.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'hourly_reports',
        filter: `shift_id=eq.${activeShift.id}`
      }, loadShiftReports)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeShift?.id])

  const loadShiftReports = async () => {
    if (!activeShift) return []
    const { data } = await supabase
      .from('hourly_reports')
      .select('*')
      .eq('shift_id', activeShift.id)
      .is('deleted_at', null)
      .order('hour_start')
    const list = (data ?? []) as HourlyReport[]
    setShiftReports(list)
    return list
  }

  const loadOrders = async (machineId: string) => {
    const { data } = await supabase
      .from('production_orders')
      .select('*, assortment:assortments(name)')
      .eq('machine_id', machineId)
      .in('status', ['active','paused'])
      .order('created_at', { ascending: false })
    if (data) setOrders(data as ProductionOrder[])
  }

  const findExistingShift = async () => {
    const shiftDate = getShiftDateForStart(selectedShift)
    return supabase
      .from('shifts')
      .select('id, ended_at')
      .eq('machine_id', selectedMachine)
      .eq('shift_date', shiftDate)
      .eq('shift_type', selectedShift)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  }

  // Właściwy start — po potwierdzeniu
  const doStart = async () => {
    if (!selectedMachine) { setError('Wybierz maszynę'); return }
    if (!selectedOrderId && !showNewOrder) { setError('Wybierz zlecenie produkcyjne lub utwórz nowe'); return }
    if (showNewOrder && !newOrderNumber) { setError('Wpisz numer zlecenia'); return }
    setError('')
    const { data: existingShift } = await findExistingShift()
    if (existingShift) {
      setError(existingShift.ended_at
        ? 'Ta zmiana była już uruchomiona na tej maszynie. Nie można rozpocząć jej drugi raz.'
        : 'Ta zmiana jest już aktywna na tej maszynie. Najpierw zakończ obecną zmianę albo wybierz inną maszynę.')
      return
    }
    let orderId = selectedOrderId
    if (showNewOrder && newOrderNumber) {
      await supabase
        .from('production_orders')
        .update({ status: 'paused', paused_at: new Date().toISOString() })
        .eq('machine_id', selectedMachine)
        .eq('status', 'active')
      const { data, error: orderError } = await supabase
        .from('production_orders').insert({
          order_number: newOrderNumber,
          machine_id: selectedMachine,
          target_qty: parseInt(newOrderTarget) || 0,
          assortment_id: newOrderAssortment || null,
          status: 'active',
          created_by: profile?.id,
          notes: newOrderNotes || null
        }).select().single()
      if (orderError) { setError('Błąd tworzenia zlecenia: ' + orderError.message); return }
      orderId = data.id
    } else if (orderId) {
      await supabase
        .from('production_orders')
        .update({ status: 'paused', paused_at: new Date().toISOString() })
        .eq('machine_id', selectedMachine)
        .eq('status', 'active')
        .neq('id', orderId)
      await supabase.from('production_orders').update({ status: 'active', paused_at: null }).eq('id', orderId)
    }
    const { error: shiftError } = await startShift(selectedMachine, selectedShift, selectedOp2 || undefined)
    if (shiftError) { setError(shiftError); return }
    navigate('/operator/report')
  }

  // Sprawdź przed startem czy zmiana z raportami już istnieje
  const handleStart = async () => {
    if (!selectedMachine) { setError('Wybierz maszynę'); return }
    setError('')
    const { data: existingShift } = await findExistingShift()
    if (existingShift) {
      setError(existingShift.ended_at
        ? 'Ta zmiana była już uruchomiona na tej maszynie. Nie można rozpocząć jej drugi raz.'
        : 'Ta zmiana jest już aktywna na tej maszynie. Najpierw zakończ obecną zmianę albo wybierz inną maszynę.')
      return
    }
    doStart()
  }

  // Sprawdź brakujące godziny przed zakończeniem zmiany
  const handleEndRequest = async () => {
    if (!activeShift) return
    const latestReports = await loadShiftReports()
    const reportedHours = latestReports.map(r => r.hour_start)
    const shiftHours = SHIFT_HOURS[activeShift.shift_type as ShiftType]
    // Tylko godziny które już minęły
    const missing = shiftHours.filter(h =>
      canEnterHourlyReport(activeShift.shift_date, activeShift.shift_type, h) && !reportedHours.includes(h)
    )
    if (missing.length > 0) {
      setMissingHours(missing)
      setShowEndWarning(true)
    } else {
      handleEndConfirm()
    }
  }

  const handleEndConfirm = async () => {
    setShowEndWarning(false)
    const { error: endError } = await endShift()
    if (endError) setError('Nie udało się zakończyć zmiany: ' + endError)
  }

  // ── ACTIVE SHIFT VIEW ────────────────────────────────────────────────────
  const activeShiftHours = activeShift ? SHIFT_HOURS[activeShift.shift_type as ShiftType] : []
  const reportedHours = shiftReports.map(r => r.hour_start)
  const openHours = activeShift
    ? activeShiftHours.filter(h => canEnterHourlyReport(activeShift.shift_date, activeShift.shift_type, h))
    : []
  const missingOpenHours = activeShiftHours.filter(h => openHours.includes(h) && !reportedHours.includes(h))
  const nextPendingHour = activeShiftHours.find(h => !reportedHours.includes(h))
  const nextPendingOpenAt = activeShift && nextPendingHour !== undefined
    ? getReportEntryOpenAt(activeShift.shift_date, activeShift.shift_type, nextPendingHour)
    : null
  const totalGood = shiftReports.reduce((s, r) => s + r.good_count, 0)
  const totalReject = shiftReports.reduce((s, r) => s + r.reject_count, 0)
  const totalRuntime = shiftReports.reduce((s, r) => s + r.runtime_min, 0)
  const avgEff = shiftReports.length
    ? Math.round(shiftReports.reduce((s, r) => s + Number(r.efficiency_pct), 0) / shiftReports.length)
    : 0
  const completePct = activeShiftHours.length
    ? Math.round(shiftReports.length / activeShiftHours.length * 100)
    : 0
  const shiftEndAt = activeShift ? getShiftEndAt(activeShift.shift_date, activeShift.shift_type) : null
  const autoCloseAt = activeShift ? getShiftAutoCloseAt(activeShift.shift_date, activeShift.shift_type) : null

  if (activeShift && !activeShift.ended_at && activeMachine) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Moja zmiana</h1>
          <p className="text-sm sm:text-base text-navy-400 mt-1">Aktywna zmiana produkcyjna</p>
        </div>

        {/* Ostrzeżenie przy kończeniu */}
        {showEndWarning && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.9)', backdropFilter: 'blur(8px)' }}>
            <div className="bg-navy-800 border-2 border-amber-500/50 rounded-2xl p-6 w-full max-w-md">
              <div className="text-3xl mb-3">⚠️</div>
              <h2 className="text-xl font-bold text-amber-400 mb-2">Za wcześnie na zakończenie zmiany!</h2>
              <p className="text-navy-300 text-sm mb-4">Brakuje raportów za następujące godziny:</p>
              <div className="bg-navy-900 rounded-xl p-3 mb-4">
                {missingHours.map(h => (
                  <div key={h} className="text-amber-400 font-mono text-sm">
                    • {String(h).padStart(2,'0')}:00 – {String((h+1)%24).padStart(2,'0')}:00
                  </div>
                ))}
              </div>
              <p className="text-navy-400 text-xs mb-5">Czy na pewno chcesz zakończyć zmianę bez wpisania tych wyników?</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button onClick={() => setShowEndWarning(false)} className="btn-primary flex-1 py-3">
                  Wróć i wpisz wyniki
                </button>
                <button onClick={handleEndConfirm} className="btn-danger px-5 py-3 text-sm">
                  Zakończ mimo to
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="card mb-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 font-semibold text-sm">Zmiana aktywna</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 mb-6">
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
            <div className="bg-navy-900 rounded-xl p-4 sm:col-span-2">
              <div className="label">Automatyczne zamkniecie</div>
              <div className="text-base font-bold text-amber-300 font-mono">
                {autoCloseAt?.toLocaleString('pl-PL', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </div>
              <div className="text-xs text-navy-400 mt-1">Koniec zmiany + 60 minut na uzupelnienie raportow</div>
            </div>
          </div>
          <div className="mb-6 rounded-xl border border-navy-700 bg-navy-900 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-white">Podsumowanie zmiany</div>
                <div className="text-xs text-navy-400">
                  Koniec produkcyjny: {shiftEndAt?.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} · bufor do {autoCloseAt?.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div className={cn('text-sm font-bold', missingOpenHours.length ? 'text-amber-300' : 'text-green-400')}>
                {shiftReports.length}/{activeShiftHours.length} raportow
              </div>
            </div>
            <div className="h-2 rounded-full bg-navy-700">
              <div className="h-full rounded-full bg-brand" style={{ width: `${completePct}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg bg-navy-800 p-3">
                <div className="text-xs text-navy-400">Dobre</div>
                <div className="font-mono text-lg font-bold text-green-400">{totalGood.toLocaleString('pl-PL')}</div>
              </div>
              <div className="rounded-lg bg-navy-800 p-3">
                <div className="text-xs text-navy-400">Odrzut</div>
                <div className="font-mono text-lg font-bold text-red-400">{totalReject.toLocaleString('pl-PL')}</div>
              </div>
              <div className="rounded-lg bg-navy-800 p-3">
                <div className="text-xs text-navy-400">Czas pracy</div>
                <div className="font-mono text-lg font-bold text-cyan-300">{minsToHHMM(totalRuntime)}</div>
              </div>
              <div className="rounded-lg bg-navy-800 p-3">
                <div className="text-xs text-navy-400">Srednia EPQ</div>
                <div className="font-mono text-lg font-bold text-white">{avgEff}%</div>
              </div>
            </div>
            {missingOpenHours.length > 0 ? (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                Brakuje otwartych blokow: {missingOpenHours.map(formatHourBlock).join(', ')}
              </div>
            ) : nextPendingHour !== undefined && nextPendingOpenAt ? (
              <div className="mt-3 rounded-lg border border-navy-700 bg-navy-800 p-3 text-xs text-navy-300">
                Nastepny blok {formatHourBlock(nextPendingHour)} bedzie dostepny od {nextPendingOpenAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}.
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs font-semibold text-green-300">
                Wszystkie bloki zmiany sa uzupelnione.
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button onClick={() => navigate('/operator/report')} className="btn-primary flex-1 py-3 text-base">
              ✏️ Wpisz wynik godziny
            </button>
            <button onClick={handleEndRequest} className="btn-danger px-6 py-3">
              Zakończ zmianę
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── START SHIFT VIEW ─────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-white">Rozpocznij zmianę</h1>
        <p className="text-sm sm:text-base text-navy-400 mt-1">Wybierz maszynę, zmianę i zlecenie</p>
      </div>
      <div className="card space-y-5">

        {/* Maszyna */}
        <div>
          <label className="label">Maszyna</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {machines.map(m => (
              <button key={m.id} onClick={() => setSelectedMachine(m.id)}
                className={cn('p-4 rounded-xl border-2 text-left transition-all',
                  selectedMachine === m.id ? 'border-brand bg-brand/10 text-white' : 'border-navy-600 bg-navy-900 text-navy-300 hover:border-navy-500')}>
                <div className="text-lg font-bold">🤖 {m.name}</div>
                <div className="text-xs mt-1 opacity-70">Target: {m.target_per_hour} szt/h</div>
              </button>
            ))}
          </div>
        </div>

        {/* Zmiana */}
        <div>
          <label className="label">Zmiana</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(['I','II','III'] as ShiftType[]).map(s => (
              <button key={s} onClick={() => setSelectedShift(s)}
                className={cn('p-3 rounded-xl border-2 text-center transition-all',
                  selectedShift === s ? 'border-brand bg-brand/10 text-white' : 'border-navy-600 bg-navy-900 text-navy-300 hover:border-navy-500')}>
                <div className="text-lg font-bold">Zmiana {s}</div>
                <div className="text-xs mt-0.5 opacity-70">{s === 'I' ? '06–14' : s === 'II' ? '14–22' : '22–06'}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Zlecenie */}
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
                          selectedOrderId === o.id ? 'border-brand bg-brand/10' : 'border-navy-600 bg-navy-900 hover:border-navy-500')}>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="font-bold font-mono text-white">{o.order_number}</div>
                            {o.assortment && <div className="text-xs text-brand mt-0.5">{o.assortment.name}</div>}
                            <div className="text-xs text-navy-400 mt-0.5">
                              {o.produced_qty.toLocaleString('pl-PL')} szt
                              {o.target_qty > 0 && ` / ${o.target_qty.toLocaleString('pl-PL')} szt`}
                            </div>
                          </div>
                          <span className={cn('text-xs font-bold sm:text-right', o.status === 'active' ? 'text-green-400' : 'text-amber-400')}>
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
                  <label className="label">Asortyment</label>
                  <select value={newOrderAssortment} onChange={e => setNewOrderAssortment(e.target.value)} className="input">
                    <option value="">— Wybierz asortyment —</option>
                    {assortments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
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

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}

        <button onClick={handleStart} disabled={isLoading || !selectedMachine} className="btn-primary w-full py-4 text-base">
          {isLoading ? 'Uruchamianie...' : '🚀 Rozpocznij zmianę'}
        </button>
      </div>
    </div>
  )
}
