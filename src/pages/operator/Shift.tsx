import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShiftStore } from '@/stores/shiftStore'
import { useTutorial } from '@/features/tutorial/TutorialContext'
import { useAuthStore } from '@/stores/authStore'
import { getMachines, getProfiles } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Machine, Profile, ShiftType } from '@/types/database'

export default function OperatorShift() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { activeShift, activeMachine, startShift, endShift, isLoading } = useShiftStore()
  const { notifyCondition } = useTutorial()
  const [machines, setMachines] = useState<Machine[]>([])
  const [operators, setOperators] = useState<Profile[]>([])
  const [selectedMachine, setSelectedMachine] = useState('')
  const [selectedShift, setSelectedShift] = useState<ShiftType>('I')
  const [selectedOp2, setSelectedOp2] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    getMachines().then(({ data }) => { if (data) setMachines(data) })
    getProfiles().then(({ data }) => { if (data) setOperators(data) })
    const h = new Date().getHours()
    if (h >= 6 && h < 14) setSelectedShift('I')
    else if (h >= 14 && h < 22) setSelectedShift('II')
    else setSelectedShift('III')
  }, [])

  const handleStart = async () => {
    if (!selectedMachine) { setError('Wybierz maszynę'); return }
    setError('')
    const { error: err } = await startShift(selectedMachine, selectedShift, selectedOp2 || undefined)
    if (err) { setError(err); return }
    notifyCondition('shift-started')
    navigate('/operator/report')
  }

  const handleEnd = async () => {
    if (!confirm('Zakończyć zmianę? Upewnij się że wszystkie raporty są wpisane.')) return
    await endShift()
  }

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
            <button onClick={handleEnd} data-tutorial="shift-end-btn" className="btn-danger px-6 py-3">
              Zakończ zmianę
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Rozpocznij zmianę</h1>
        <p className="text-navy-400 mt-1">Wybierz maszynę i zmianę</p>
      </div>
      <div className="card space-y-5">
        <div>
          <label className="label">Maszyna</label>
          <div className="grid grid-cols-2 gap-3" data-tutorial="shift-machine">
            {machines.map(m => (
              <button key={m.id} onClick={() => { setSelectedMachine(m.id); notifyCondition('machine-selected') }}
                className={cn('p-4 rounded-xl border-2 text-left transition-all',
                  selectedMachine === m.id ? 'border-brand bg-brand/10 text-white' : 'border-navy-600 bg-navy-900 text-navy-300 hover:border-navy-500'
                )}>
                <div className="text-lg font-bold">🤖 {m.name}</div>
                <div className="text-xs mt-1 opacity-70">Target: {m.target_per_hour} szt/h</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Zmiana</label>
          <div className="grid grid-cols-3 gap-2" data-tutorial="shift-type">
            {(['I', 'II', 'III'] as ShiftType[]).map(s => (
              <button key={s} onClick={() => { setSelectedShift(s); notifyCondition('shift-selected') }}
                className={cn('p-3 rounded-xl border-2 text-center transition-all',
                  selectedShift === s ? 'border-brand bg-brand/10 text-white' : 'border-navy-600 bg-navy-900 text-navy-300 hover:border-navy-500'
                )}>
                <div className="text-lg font-bold">Zmiana {s}</div>
                <div className="text-xs mt-0.5 opacity-70">{s === 'I' ? '06–14' : s === 'II' ? '14–22' : '22–06'}</div>
              </button>
            ))}
          </div>
        </div>
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
        <button onClick={handleStart} disabled={isLoading || !selectedMachine} data-tutorial="shift-start-btn" className="btn-primary w-full py-4 text-base">
          {isLoading ? 'Uruchamianie...' : '🚀 Rozpocznij zmianę'}
        </button>
      </div>
    </div>
  )
}
