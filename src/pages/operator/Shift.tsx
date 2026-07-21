import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { supabase, getMachines, getProfiles } from '@/lib/supabase'
import { canEnterHourlyReport, cn, efficiencyColor, formatHourBlock, getReportEntryOpenAt, getShiftAutoCloseAt, getShiftDateForStart, getShiftEndAt, isShiftPastAutoClose, SHIFT_HOURS } from '@/lib/utils'
import { TimeInput } from '@/components/shared/FormControls'
import ShiftStatPhotosCard from '@/components/operator/ShiftStatPhotosCard'
import type { HourlyReport, Machine, Profile, ShiftType } from '@/types/database'

interface ProductionOrder {
  id: string; order_number: string; target_qty: number
  produced_qty: number; status: 'active' | 'paused' | 'completed' | 'cancelled'
  notes: string | null; assortment_id: string | null
  assortment?: { name: string }
}
interface Assortment { id: string; name: string; code: string }
interface ExistingShift { id: string; ended_at: string | null; started_at?: string | null; shift_date: string; shift_type: ShiftType }
const ORDERS_ENABLED = false
const TARGET_PER_SHIFT = 18000

function minsToHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

function parseHHMM(value: string): number | null {
  const clean = value.trim()
  const match = clean.match(/^(\d{1,2}):([0-5]\d)$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

interface ShiftEndForm {
  good: string
  reject: string
  runtime: string
  ready: string
  alarm: string
  downtime: string
  notes: string
}

function hourlyRate(pieces: number, runtimeMin: number) {
  return runtimeMin > 0 ? Math.round(pieces / runtimeMin * 60) : 0
}

function rejectPct(good: number, reject: number) {
  return good + reject > 0 ? Math.round(reject / (good + reject) * 1000) / 10 : 0
}

function isSelectableOperator(profile: Profile | null | undefined) {
  return profile?.role === 'operator' && profile.is_active !== false && !profile.deleted_at
}

// Godziny poszczególnych zmian
export default function OperatorShift() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { profile } = useAuthStore()
  const { activeShift, activeMachine, startShift, endShift, reopenShift, isLoading } = useShiftStore()
  const [machines, setMachines]     = useState<Machine[]>([])
  const [operators, setOperators]   = useState<Profile[]>([])
  const [assortments, setAssortments] = useState<Assortment[]>([])
  const [selectedMachine, setSelectedMachine] = useState('')
  const [selectedShift,   setSelectedShift]   = useState<ShiftType>('I')
  const [selectedOp2,     setSelectedOp2]     = useState('')
  const [error, setError] = useState('')
  const [restorableShift, setRestorableShift] = useState<ExistingShift | null>(null)

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
  const [endConfirmText, setEndConfirmText] = useState('')
  const [missingHours,   setMissingHours]   = useState<number[]>([])
  const [shiftReports,   setShiftReports]   = useState<HourlyReport[]>([])
  const [earlyEndRequested, setEarlyEndRequested] = useState(false)
  const [earlyEndReason,    setEarlyEndReason]    = useState('')
  const EARLY_END_MIN_REASON_LENGTH = 15
  const [endForm, setEndForm] = useState<ShiftEndForm>({
    good: '0',
    reject: '0',
    runtime: '00:00',
    ready: '00:00',
    alarm: '00:00',
    downtime: '00:00',
    notes: ''
  })
  const reportsRequestSeq = useRef(0)

  useEffect(() => {
    getMachines().then(({ data }) => { if (data) setMachines(data as Machine[]) })
    getProfiles().then(({ data }) => {
      if (data) setOperators((data as Profile[]).filter(isSelectableOperator))
    })
    if (ORDERS_ENABLED) {
      supabase.from('assortments').select('*').eq('is_active', true).order('sort_order')
        .then(({ data }) => { if (data) setAssortments(data as Assortment[]) })
    }
    const h = new Date().getHours()
    if (h >= 6 && h < 14) setSelectedShift('I')
    else if (h >= 14 && h < 22) setSelectedShift('II')
    else setSelectedShift('III')
  }, [])

  useEffect(() => {
    if (ORDERS_ENABLED && selectedMachine) loadOrders(selectedMachine)
  }, [selectedMachine])

  useEffect(() => {
    setRestorableShift(null)
  }, [selectedMachine, selectedShift])

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
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') loadShiftReports()
    }
    window.addEventListener('focus', loadShiftReports)
    document.addEventListener('visibilitychange', refreshOnFocus)

    return () => {
      window.removeEventListener('focus', loadShiftReports)
      document.removeEventListener('visibilitychange', refreshOnFocus)
      supabase.removeChannel(channel)
    }
  }, [activeShift?.id])

  const loadShiftReports = async () => {
    if (!activeShift) return []
    const requestId = ++reportsRequestSeq.current
    const shiftId = activeShift.id
    const { data, error } = await supabase
      .from('hourly_reports')
      .select('*')
      .eq('shift_id', shiftId)
      .is('deleted_at', null)
      .order('hour_start')
    if (error || requestId !== reportsRequestSeq.current) return shiftReports
    const list = (data ?? []) as HourlyReport[]
    setShiftReports(list)
    return list
  }

  const loadOrders = async (machineId: string) => {
    if (!ORDERS_ENABLED) return
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
    const { data, error } = await supabase
      .from('shifts')
      .select('id, ended_at, started_at, shift_date, shift_type')
      .eq('machine_id', selectedMachine)
      .eq('shift_date', shiftDate)
      .eq('shift_type', selectedShift)
      .order('started_at', { ascending: false })
      .limit(20)

    if (error) return { data: null, error }

    const shifts = (data ?? []) as ExistingShift[]
    const activeShift = shifts.find(shift => !shift.ended_at)
    return { data: activeShift ?? shifts[0] ?? null, error: null }
  }

  const handleExistingShiftBlock = (existingShift: ExistingShift) => {
    const canRestore = !!existingShift.ended_at && !isShiftPastAutoClose(existingShift.shift_date, existingShift.shift_type)
    if (canRestore) setRestorableShift(existingShift)
    else setRestorableShift(null)

    setError(existingShift.ended_at
      ? canRestore
        ? 'Ta zmiana byla juz uruchomiona na tej maszynie. Nie mozna rozpoczac jej drugi raz.'
        : 'Ta zmiana byla juz uruchomiona i minal czas na jej przywrocenie. Kierownik musi usunac bledny rekord albo skorygowac zmiane.'
      : 'Ta zmiana jest juz aktywna na tej maszynie. Najpierw zakoncz obecna zmiane albo wybierz inna maszyne.')
  }

  // Właściwy start — po potwierdzeniu
  const doStart = async () => {
    if (!selectedMachine) { setError('Wybierz maszynę'); return }
    if (ORDERS_ENABLED && !selectedOrderId && !showNewOrder) { setError('Wybierz zlecenie produkcyjne lub utworz nowe'); return }
    if (ORDERS_ENABLED && showNewOrder && !newOrderNumber) { setError('Wpisz numer zlecenia'); return }
    setError('')
    const { data: existingShift } = await findExistingShift()
    if (existingShift) {
      handleExistingShiftBlock(existingShift)
      return
    }
    let orderId = selectedOrderId
    if (ORDERS_ENABLED && showNewOrder && newOrderNumber) {
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
    } else if (ORDERS_ENABLED && orderId) {
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
      handleExistingShiftBlock(existingShift)
      return
    }
    doStart()
  }

  const handleReopenShift = async () => {
    if (!restorableShift) return
    setError('')
    const { error: reopenError } = await reopenShift(restorableShift.id, selectedOp2 || undefined)
    if (reopenError) {
      setError('Nie udalo sie przywrocic zmiany: ' + reopenError)
      return
    }
    setRestorableShift(null)
    navigate('/operator/report')
  }

  // Sprawdź brakujące godziny przed zakończeniem zmiany
  const handleEndRequest = async () => {
    if (!activeShift) return
    const latestReports = await loadShiftReports()
    const reportedHours = latestReports.map(r => r.hour_start)
    const shiftHours = SHIFT_HOURS[activeShift.shift_type as ShiftType]
    // Wszystkie zaplanowane godziny zmiany bez wpisu - rowniez te, ktorych okno wpisu
    // jeszcze sie nie otworzylo (np. ostatni blok otwiera sie dopiero 10 min przed koncem
    // zmiany). Bez tego operator mogl zamknac zmiane tuz przed otwarciem ostatniego bloku
    // i bezpowrotnie stracic ten wpis.
    const missing = shiftHours.filter(h => !reportedHours.includes(h))
    const good = latestReports.reduce((s, r) => s + r.good_count, 0)
    const reject = latestReports.reduce((s, r) => s + r.reject_count, 0)
    setMissingHours(missing)
    setEndForm({
      good: String(good),
      reject: String(reject),
      runtime: activeShift.summary_runtime_min != null ? minsToHHMM(activeShift.summary_runtime_min) : '00:00',
      ready: activeShift.summary_ready_min != null ? minsToHHMM(activeShift.summary_ready_min) : '00:00',
      alarm: activeShift.summary_alarm_min != null ? minsToHHMM(activeShift.summary_alarm_min) : '00:00',
      downtime: activeShift.summary_downtime_min != null ? minsToHHMM(activeShift.summary_downtime_min) : '00:00',
      notes: activeShift.notes ?? ''
    })
    setEndConfirmText('')
    setEarlyEndRequested(false)
    setEarlyEndReason('')
    setShowEndWarning(true)
  }

  // Operator wpisal ostatni zaplanowany blok godzinowy w Report.tsx - od razu
  // pokaz okno rozliczenia koncowego, zamiast wymagac recznego wejscia i klikniecia
  // "Zakoncz zmiane".
  useEffect(() => {
    if (searchParams.get('openEndSummary') !== '1') return
    if (!activeShift || activeShift.ended_at) return
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('openEndSummary'); return next }, { replace: true })
    void handleEndRequest()
  }, [activeShift?.id, searchParams])

  const handleEndConfirm = async () => {
    if (missingHours.length > 0) {
      if (!earlyEndRequested) {
        setError('Nie mozna zakonczyc zmiany, dopoki brakuje raportow godzinowych. Jesli to zamierzone (np. awaria na reszte zmiany), zaznacz opcje zakonczenia przedwczesnego i podaj powod.')
        return
      }
      if (earlyEndReason.trim().length < EARLY_END_MIN_REASON_LENGTH) {
        setError(`Podaj konkretny powod zakonczenia przedwczesnego (min. ${EARLY_END_MIN_REASON_LENGTH} znakow) - to trafi do raportow kierownika.`)
        return
      }
    }
    if (endConfirmText.trim().toUpperCase() !== 'ZAMKNIJ') {
      setError('Aby zakończyć zmianę, wpisz ZAMKNIJ w oknie potwierdzenia.')
      return
    }
    const runtime = parseHHMM(endForm.runtime)
    const ready = parseHHMM(endForm.ready)
    const alarm = parseHHMM(endForm.alarm)
    const downtime = parseHHMM(endForm.downtime)
    if ([runtime, ready, alarm, downtime].some(value => value === null)) {
      setError('Czasy wpisz w formacie GG:MM, np. 07:35.')
      return
    }
    const good = Math.max(0, Number.parseInt(endForm.good || '0', 10) || 0)
    const reject = Math.max(0, Number.parseInt(endForm.reject || '0', 10) || 0)
    const totalTime = (runtime ?? 0) + (ready ?? 0) + (alarm ?? 0) + (downtime ?? 0)
    const expected = TARGET_PER_SHIFT
    const lowResult = expected > 0 && good < Math.round(expected * 0.85)
    const highReject = rejectPct(good, reject) > 5
    if (totalTime <= 0) {
      setError('Wpisz rozliczenie czasu zmiany. Suma czasu nie moze wynosic 00:00.')
      return
    }
    if ((lowResult || highReject) && !endForm.notes.trim()) {
      setError('Dopisz uwagi do zmiany, bo wynik jest slaby albo odrzut przekracza 5%.')
      return
    }
    setShowEndWarning(false)
    setEndConfirmText('')
    const isEarlyEnd = missingHours.length > 0 && earlyEndRequested
    const missingHoursLabel = missingHours.map(formatHourBlock).join(', ')
    const earlyEndNote = isEarlyEnd
      ? `[ZAKONCZENIE PRZEDWCZESNE] Powod: ${earlyEndReason.trim()}. Brakujace bloki: ${missingHoursLabel}.`
      : null
    const combinedNotes = [earlyEndNote, endForm.notes.trim() || null].filter(Boolean).join('\n') || null
    const { error: endError } = await endShift({
      summary_good_count: good,
      summary_reject_count: reject,
      summary_runtime_min: runtime ?? 0,
      summary_ready_min: ready ?? 0,
      summary_alarm_min: alarm ?? 0,
      summary_downtime_min: downtime ?? 0,
      summary_notes: combinedNotes,
      ended_early: isEarlyEnd,
      early_end_reason: isEarlyEnd ? earlyEndReason.trim() : null
    })
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
  const totalExpected = TARGET_PER_SHIFT
  const shiftRejectPct = rejectPct(totalGood, totalReject)
  const avgEff = shiftReports.length && activeMachine
    ? Math.round(totalGood / totalExpected * 100)
    : 0
  const completePct = activeShiftHours.length
    ? Math.round(shiftReports.length / activeShiftHours.length * 100)
    : 0
  const shiftEndAt = activeShift ? getShiftEndAt(activeShift.shift_date, activeShift.shift_type) : null
  const autoCloseAt = activeShift ? getShiftAutoCloseAt(activeShift.shift_date, activeShift.shift_type) : null
  const shiftOperator1 = activeShift?.operator_1?.full_name ?? profile?.full_name ?? 'Operator 1'
  const shiftOperator2 = activeShift?.operator_2?.full_name ?? null
  const endFormGood = Math.max(0, Number.parseInt(endForm.good || '0', 10) || 0)
  const endFormReject = Math.max(0, Number.parseInt(endForm.reject || '0', 10) || 0)
  const endFormRejectPct = rejectPct(endFormGood, endFormReject)
  const endFormRuntime = parseHHMM(endForm.runtime) ?? 0
  const endFormReady = parseHHMM(endForm.ready) ?? 0
  const endFormAlarm = parseHHMM(endForm.alarm) ?? 0
  const endFormDowntime = parseHHMM(endForm.downtime) ?? 0
  const endFormTotalTime = endFormRuntime + endFormReady + endFormAlarm + endFormDowntime
  const endFormMachineRate = hourlyRate(endFormGood + endFormReject, endFormRuntime)
  const endExpected = TARGET_PER_SHIFT
  const endEff = endExpected > 0 ? Math.round(endFormGood / endExpected * 100) : 0
  const endNeedsNotes = (endExpected > 0 && endFormGood < Math.round(endExpected * 0.85)) || endFormRejectPct > 5

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
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-amber-500/50 bg-navy-800 p-6">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-xl font-bold text-amber-400">Potwierdz zakonczenie zmiany</h2>
                {missingHours.length > 0 && earlyEndRequested && (
                  <span className="rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    Zakonczenie przedwczesne
                  </span>
                )}
              </div>
              <p className="text-navy-300 text-sm mb-4">
                Zamkniesz aktywna zmiane na maszynie {activeMachine.name}. Po zamknieciu operator nie bedzie juz wpisywal wynikow w tej zmianie.
              </p>
              {missingHours.length > 0 ? (
                <>
                  <p className="text-red-300 text-sm font-semibold mb-4">
                    Nie mozna zamknac zmiany, bo brakuje raportow za nastepujace godziny:
                  </p>
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4">
                    {missingHours.map(h => {
                      const canEnter = activeShift && canEnterHourlyReport(activeShift.shift_date, activeShift.shift_type, h)
                      const opensAt = activeShift ? getReportEntryOpenAt(activeShift.shift_date, activeShift.shift_type, h) : null
                      return (
                        <div key={h} className="text-amber-400 font-mono text-sm">
                          - {String(h).padStart(2,'0')}:00 - {String((h+1)%24).padStart(2,'0')}:00
                          {!canEnter && opensAt && (
                            <span className="text-navy-400"> (blok otworzy sie o {opensAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })})</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="bg-green-500/10 border border-green-500/25 rounded-xl p-3 mb-4 text-sm font-semibold text-green-300">
                  Wszystkie raporty godzinowe sa uzupelnione.
                </div>
              )}

              {missingHours.length > 0 && (
                <div className={cn(
                  'mb-4 rounded-xl border-2 p-4',
                  earlyEndRequested ? 'border-amber-500/60 bg-amber-500/10' : 'border-navy-700 bg-navy-900'
                )}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={earlyEndRequested}
                      onChange={e => { setEarlyEndRequested(e.target.checked); setError('') }}
                      className="mt-0.5 w-5 h-5 rounded accent-amber-500"
                    />
                    <span>
                      <span className="block text-sm font-bold text-amber-300">Zakoncz zmiane przedwczesnie</span>
                      <span className="block text-xs text-navy-400 mt-0.5">
                        Uzyj tylko gdy dalsza produkcja w tej zmianie jest niemozliwa (np. trwala awaria, koniec zlecenia).
                        Zmiana zostanie oznaczona jako <span className="font-semibold text-amber-300">zakonczona przedwczesnie</span> wraz z podanym powodem
                        i brakujacymi blokami - bedzie to widoczne dla kierownika w raportach.
                      </span>
                    </span>
                  </label>

                  {earlyEndRequested && (
                    <div className="mt-3">
                      <label className="label">Powod zakonczenia przedwczesnego *</label>
                      <textarea
                        value={earlyEndReason}
                        onChange={e => { setEarlyEndReason(e.target.value); setError('') }}
                        rows={3}
                        placeholder="Np. Awaria napedu glownego, brak mozliwosci naprawy do konca zmiany, UR przejmuje maszyne."
                        className="input mt-1 text-sm resize-none"
                      />
                      <div className={cn(
                        'text-xs mt-1',
                        earlyEndReason.trim().length < EARLY_END_MIN_REASON_LENGTH ? 'text-red-300' : 'text-green-400'
                      )}>
                        {earlyEndReason.trim().length}/{EARLY_END_MIN_REASON_LENGTH} znakow minimum
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mb-5 rounded-xl border border-navy-700 bg-navy-900 p-4">
                <div className="mb-3">
                  <div className="text-sm font-bold text-white">Rozliczenie koncowe zmiany</div>
                  <div className="text-xs text-navy-400">Produkcja i odrzut sa podpowiedziane z wpisow godzinowych. Czasy wpisujesz dopiero tutaj.</div>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-navy-800 p-3">
                    <div className="text-xs text-navy-400">Wynik</div>
                    <div className={cn('font-mono text-lg font-bold', efficiencyColor(endEff))}>{endEff || '-'}{endEff ? '%' : ''}</div>
                  </div>
                  <div className="rounded-lg bg-navy-800 p-3">
                    <div className="text-xs text-navy-400">Odrzut</div>
                    <div className={cn('font-mono text-lg font-bold', endFormRejectPct > 5 ? 'text-red-400' : 'text-green-400')}>{endFormRejectPct}%</div>
                  </div>
                  <div className="rounded-lg bg-navy-800 p-3">
                    <div className="text-xs text-navy-400">Czas razem</div>
                    <div className={cn('font-mono text-lg font-bold', endFormTotalTime > 0 ? 'text-cyan-300' : 'text-red-300')}>{minsToHHMM(endFormTotalTime)}</div>
                  </div>
                  <div className="rounded-lg bg-navy-800 p-3">
                    <div className="text-xs text-navy-400">Wyd. maszyny</div>
                    <div className="font-mono text-lg font-bold text-cyan-300">{endFormMachineRate ? endFormMachineRate.toLocaleString('pl-PL') : '-'}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label>
                    <span className="label">Produkcja razem</span>
                    <input
                      type="number"
                      min="0"
                      value={endForm.good}
                      onChange={e => setEndForm(prev => ({ ...prev, good: e.target.value }))}
                      className="input mt-1 font-mono"
                    />
                  </label>
                  <label>
                    <span className="label">Odrzut razem</span>
                    <input
                      type="number"
                      min="0"
                      value={endForm.reject}
                      onChange={e => setEndForm(prev => ({ ...prev, reject: e.target.value }))}
                      className="input mt-1 font-mono"
                    />
                  </label>
                  <TimeInput
                    label="Czas pracy"
                    value={endForm.runtime}
                    onChange={value => setEndForm(prev => ({ ...prev, runtime: value }))}
                    compact
                    showDelta={false}
                  />
                  <TimeInput
                    label="Gotowosc"
                    value={endForm.ready}
                    onChange={value => setEndForm(prev => ({ ...prev, ready: value }))}
                    compact
                    showDelta={false}
                  />
                  <TimeInput
                    label="Alarm"
                    value={endForm.alarm}
                    onChange={value => setEndForm(prev => ({ ...prev, alarm: value }))}
                    compact
                    showDelta={false}
                  />
                  <TimeInput
                    label="Postoj / awaria"
                    value={endForm.downtime}
                    onChange={value => setEndForm(prev => ({ ...prev, downtime: value }))}
                    compact
                    showDelta={false}
                  />
                </div>
                <label className="mt-3 block">
                  <span className="label">Uwagi do zmiany</span>
                  <textarea
                    value={endForm.notes}
                    onChange={e => setEndForm(prev => ({ ...prev, notes: e.target.value }))}
                    className="input mt-1 min-h-[88px]"
                    placeholder="Np. przyczyna slabszej pracy, szkolenie, problem na stacji..."
                  />
                  {endNeedsNotes && !endForm.notes.trim() && (
                    <div className="mt-2 text-xs font-semibold text-red-300">
                      Uwagi sa wymagane, bo wynik jest niski albo odrzut przekracza 5%.
                    </div>
                  )}
                </label>
              </div>
              <label className="block mb-5">
                <span className="label">Wpisz ZAMKNIJ, aby potwierdzic</span>
                <input
                  value={endConfirmText}
                  onChange={e => setEndConfirmText(e.target.value)}
                  className="input mt-1 font-mono uppercase"
                  placeholder="ZAMKNIJ"
                  autoFocus
                />
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => { setShowEndWarning(false); setEndConfirmText(''); setEarlyEndRequested(false); setEarlyEndReason('') }}
                  className="btn-primary flex-1 py-3"
                >
                  Wroc do zmiany
                </button>
                <button
                  onClick={handleEndConfirm}
                  disabled={
                    (missingHours.length > 0 && (!earlyEndRequested || earlyEndReason.trim().length < EARLY_END_MIN_REASON_LENGTH)) ||
                    endConfirmText.trim().toUpperCase() !== 'ZAMKNIJ' ||
                    endFormTotalTime <= 0 ||
                    (endNeedsNotes && !endForm.notes.trim()) ||
                    isLoading
                  }
                  className="btn-danger px-5 py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading
                    ? 'Zamykanie...'
                    : missingHours.length > 0 && earlyEndRequested
                      ? 'Zakoncz zmiane przedwczesnie'
                      : 'Zakoncz zmiane'}
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
              <div className="text-xs text-navy-400 mt-1">Wydajnosc: {activeMachine.target_per_hour} szt/h</div>
            </div>
            <div className="bg-navy-900 rounded-xl p-4">
              <div className="label">Zmiana</div>
              <div className="text-xl font-bold text-white">Zmiana {activeShift.shift_type}</div>
              <div className="text-xs text-navy-400 mt-1">{activeShift.shift_date}</div>
            </div>
            <div className="bg-navy-900 rounded-xl p-4 sm:col-span-2">
              <div className="label">Sklad zmiany</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-navy-700 bg-navy-800 p-3">
                  <div className="text-xs text-navy-400">Operator 1</div>
                  <div className="mt-1 font-bold text-white">{shiftOperator1}</div>
                </div>
                <div className="rounded-lg border border-navy-700 bg-navy-800 p-3">
                  <div className="text-xs text-navy-400">Operator 2</div>
                  <div className={cn('mt-1 font-bold', shiftOperator2 ? 'text-white' : 'text-navy-500')}>
                    {shiftOperator2 ?? 'Nie przypisano'}
                  </div>
                </div>
              </div>
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
                <div className={cn('font-mono text-lg font-bold', shiftRejectPct > 5 ? 'text-red-400' : 'text-green-400')}>
                  {totalReject.toLocaleString('pl-PL')} ({shiftRejectPct}%)
                </div>
              </div>
              <div className="rounded-lg bg-navy-800 p-3">
                <div className="text-xs text-navy-400">Cel zmiany</div>
                <div className="font-mono text-lg font-bold text-cyan-300">{totalExpected.toLocaleString('pl-PL')}</div>
              </div>
              <div className="rounded-lg bg-navy-800 p-3">
                <div className="text-xs text-navy-400">Realizacja celu</div>
                <div className="font-mono text-lg font-bold text-white">{avgEff}%</div>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-blue-500/25 bg-blue-500/10 p-3 text-xs text-blue-200">
              Czasy pracy, gotowosci, alarmow i postojow wpisujesz dopiero przy zakonczeniu zmiany.
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
          <div className="mb-6">
            <ShiftStatPhotosCard />
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
        <p className="text-sm sm:text-base text-navy-400 mt-1">Wybierz maszyne i zmiane</p>
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
                <div className="text-xs mt-1 opacity-70">Wydajnosc: {m.target_per_hour} szt/h</div>
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
        {ORDERS_ENABLED && selectedMachine && (
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
            {operators.filter(o => isSelectableOperator(o) && o.id !== profile?.id).map(o => (
              <option key={o.id} value={o.id}>{o.full_name}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
            <div>{error}</div>
            {restorableShift && (
              <button
                type="button"
                onClick={handleReopenShift}
                disabled={isLoading}
                className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300 transition-all hover:bg-amber-500/20 disabled:opacity-50"
              >
                Przywroc te zmiane
              </button>
            )}
          </div>
        )}

        <button onClick={handleStart} disabled={isLoading || !selectedMachine} className="btn-primary w-full py-4 text-base">
          {isLoading ? 'Uruchamianie...' : '🚀 Rozpocznij zmianę'}
        </button>
      </div>
    </div>
  )
}
