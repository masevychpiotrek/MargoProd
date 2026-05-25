import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { useHourCountdown, useClock } from '@/hooks/useClock'
import { useTestMode } from '@/hooks/useTestMode'
import { formatHourBlock, efficiencyColor, efficiencyBg, DOWNTIME_LABELS, cn, SHIFT_HOURS, canEnterHourlyReport, getReportEntryOpenAt, isShiftPastAutoClose } from '@/lib/utils'
import { TimeInput, isValidHHMM, parseHHMM, minsToHHMM } from '@/components/shared/FormControls'
import type { HourlyReport, DowntimeCategory, ShiftType } from '@/types/database'

const TARGET = 2100
const TEST_SLOTS = Array.from({ length: 20 }, (_, i) => i)

function getShiftHours(shiftType?: ShiftType) {
  return shiftType ? SHIFT_HOURS[shiftType] : Array.from({ length: 24 }, (_, h) => h)
}

function formatTestBlock(slot: number) {
  const start = slot * 3
  const end = start + 3
  return `Test ${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}-${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}

function getRobotHint(errors: string[]) {
  const first = errors[0]?.toLowerCase() ?? ''
  if (first.includes('suma')) return 'Czasy musza dac razem 01:00. Policz: praca + gotowosc + alarm, a ja puszcze raport dalej.'
  if (first.includes('target')) return 'Produkcja jest pod targetem. Dopisz krotko dlaczego, zeby kierownik nie musial zgadywac.'
  if (first.includes('istnieje')) return 'Ten przedzial jest juz zapisany. Wybierz kolejna godzine z listy.'
  if (first.includes('male')) return 'Liczniki sa narastajace. Nowy stan nie moze byc mniejszy od poprzedniego.'
  if (first.includes('wpisz')) return 'Brakuje mi kilku pol. Uzupelnij je po kolei, a przestane marudzic.'
  return 'Cos mi tu nie pasuje. Zerknij na liste ponizej i popraw dane przed zapisem.'
}

function ValidationRobot({ errors }: { errors: string[] }) {
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-3 flex gap-4 items-start animate-fade-in">
      <div className="relative shrink-0 mt-1">
        <div className="absolute -top-2 left-1/2 h-2 w-px bg-amber-300/80" />
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-amber-300 shadow-sm shadow-amber-300/60" />
        <div className="w-14 h-12 rounded-xl bg-navy-900 border border-amber-400/50 shadow-inner shadow-amber-500/10 flex flex-col items-center justify-center gap-1">
          <div className="flex gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-300 shadow-sm shadow-cyan-300/80 animate-pulse" />
            <span className="w-2 h-2 rounded-full bg-cyan-300 shadow-sm shadow-cyan-300/80 animate-pulse" />
          </div>
          <div className="w-5 h-1 rounded-full bg-amber-300/80" />
        </div>
        <div className="mx-auto mt-1 w-8 h-3 rounded-b-lg bg-navy-900 border-x border-b border-amber-400/40" />
      </div>
      <div className="min-w-0">
        <div className="text-amber-300 font-bold text-sm">Robokontroler mowi: chwila, chwila.</div>
        <div className="text-sm text-amber-100 mt-1">{getRobotHint(errors)}</div>
        {errors.length > 1 && <div className="text-xs text-amber-300/80 mt-2">Widze {errors.length} rzeczy do poprawy.</div>}
      </div>
    </div>
  )
}

interface DowntimeEntry { category: DowntimeCategory; duration_min: number; description: string }
interface ProductionOrder {
  id: string; order_number: string; machine_id: string
  target_qty: number; produced_qty: number
  status: 'active' | 'paused' | 'completed' | 'cancelled'; notes: string | null
}
interface ReportExt extends HourlyReport {
  counter_good?: number; counter_reject?: number
  counter_runtime?: number; counter_ready?: number; counter_alarm?: number
  ready_min?: number; alarm_min?: number; order_id?: string; order_qty?: number
}



// ── CounterInput ──────────────────────────────────────────────────────────
function CounterInput({ label, sublabel, value, onChange, prevValue, color = 'text-white', placeholder = '0' }:
  { label: string; sublabel?: string; value: string; onChange: (v: string) => void; prevValue: number; color?: string; placeholder?: string }) {
  const cur = parseInt(value) || 0
  const increment = value !== '' ? Math.max(0, cur - prevValue) : 0
  const hasError = value !== '' && prevValue > 0 && cur < prevValue
  return (
    <div>
      <label className="label">{label}</label>
      {sublabel && <div className="text-xs text-navy-500 mb-1.5">{sublabel}</div>}
      <input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} min="0"
        className={cn('input text-xl font-bold font-mono py-3.5', hasError && 'border-red-500/60')} />
      {prevValue > 0 && <div className="text-xs text-navy-500 mt-1">Poprzedni: <span className="font-mono text-navy-300">{prevValue.toLocaleString('pl-PL')}</span></div>}
      {value !== '' && (
        <div className={cn('text-sm font-bold mt-1', hasError ? 'text-red-400' : color)}>
          {hasError ? '⚠ Licznik nie może maleć' : `+${increment.toLocaleString('pl-PL')} szt`}
        </div>
      )}
    </div>
  )
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────
export default function OperatorReport() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { activeShift, activeMachine, loadActiveShift } = useShiftStore()
  const testMode = useTestMode()
  const { display: countdown, isUrgent } = useHourCountdown()
  const { now, hour } = useClock()
  const shiftHours = testMode ? TEST_SLOTS : getShiftHours(activeShift?.shift_type)
  const activeTarget = activeMachine?.target_per_hour ?? TARGET

  const [counterGood,    setCounterGood]    = useState('')
  const [counterReject,  setCounterReject]  = useState('')
  const [counterRuntime, setCounterRuntime] = useState('')
  const [counterReady,   setCounterReady]   = useState('')
  const [counterAlarm,   setCounterAlarm]   = useState('')

  const [downtimeReason, setDowntimeReason] = useState('')
  const [notes,          setNotes]          = useState('')
  const [downtimes,      setDowntimes]      = useState<DowntimeEntry[]>([])
  const [existingReports, setExistingReports] = useState<ReportExt[]>([])
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [errors,  setErrors]  = useState<string[]>([])
  const [selectedHour, setSelectedHour] = useState(() => {
    const currentSlot = testMode ? Math.floor(new Date().getMinutes() / 3) : hour
    return shiftHours.includes(currentSlot) ? currentSlot : shiftHours[0]
  })

  // Orders
  const [orders,         setOrders]         = useState<ProductionOrder[]>([])
  const [activeOrderId,  setActiveOrderId]  = useState('')
  const [orderQty,       setOrderQty]       = useState('')
  const [showNewOrder,   setShowNewOrder]   = useState(false)
  const [newOrderNumber, setNewOrderNumber] = useState('')
  const [newOrderTarget, setNewOrderTarget] = useState('')
  const [newOrderNotes,  setNewOrderNotes]  = useState('')
  const [savingOrder,    setSavingOrder]    = useState(false)
  const [showFinishOrder, setShowFinishOrder] = useState(false)
  const [finishCounterGood,    setFinishCounterGood]    = useState('')
  const [finishCounterReject,  setFinishCounterReject]  = useState('')
  const [finishCounterRuntime, setFinishCounterRuntime] = useState('')
  const [finishCounterReady,   setFinishCounterReady]   = useState('')
  const [finishCounterAlarm,   setFinishCounterAlarm]   = useState('')
  const [finishNotes,          setFinishNotes]          = useState('')
  const [savingFinish,         setSavingFinish]         = useState(false)

  useEffect(() => {
    if (!activeShift) { navigate('/operator/shift'); return }
    loadReports(); loadOrders()
  }, [activeShift])

  useEffect(() => {
    if (!activeShift) return

    const reloadShiftData = () => {
      loadReports()
      loadOrders()
    }

    const channel = supabase
      .channel(`operator-report-${activeShift.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'hourly_reports',
        filter: `shift_id=eq.${activeShift.id}`
      }, reloadShiftData)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'production_orders',
        filter: `machine_id=eq.${activeShift.machine_id}`
      }, loadOrders)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'shifts',
        filter: `id=eq.${activeShift.id}`
      }, loadActiveShift)
      .subscribe()

    const fallback = window.setInterval(reloadShiftData, 45000)

    return () => {
      window.clearInterval(fallback)
      supabase.removeChannel(channel)
    }
  }, [activeShift?.id, activeShift?.machine_id, loadActiveShift])
  useEffect(() => {
    const hoursForShift = testMode ? TEST_SLOTS : getShiftHours(activeShift?.shift_type)
    const currentSlot = testMode ? Math.floor(new Date().getMinutes() / 3) : hour
    setSelectedHour(prev => hoursForShift.includes(prev) ? prev : (hoursForShift.includes(currentSlot) ? currentSlot : hoursForShift[0]))
  }, [activeShift?.shift_type, hour, testMode])

  useEffect(() => {
    const reported = existingReports.map(r => r.hour_start)
    const firstMissing = shiftHours.find(h => !reported.includes(h))
    if (firstMissing !== undefined && selectedHour !== firstMissing) setSelectedHour(firstMissing)
  }, [activeShift?.shift_type, existingReports, selectedHour, testMode])

  const loadReports = async () => {
    if (!activeShift) return
    const { data } = await supabase.from('hourly_reports').select('*').eq('shift_id', activeShift.id).is('deleted_at', null).order('hour_start')
    if (data) {
      const hours = testMode ? TEST_SLOTS : getShiftHours(activeShift.shift_type)
      setExistingReports((data as ReportExt[]).sort((a, b) => hours.indexOf(a.hour_start) - hours.indexOf(b.hour_start)))
    }
  }
  const loadOrders = async () => {
    if (!activeShift) return
    const { data } = await supabase.from('production_orders').select('*').eq('machine_id', activeShift.machine_id).in('status', ['active','paused']).order('created_at', { ascending: false })
    if (data) {
      const list = data as ProductionOrder[]
      setOrders(list)
      const active = list.find(o => o.status === 'active')
      setActiveOrderId(current => active ? active.id : (list.some(o => o.id === current) ? current : ''))
    }
  }

  const handleCreateOrder = async () => {
    if (!newOrderNumber || !activeShift || !profile) return
    setSavingOrder(true)
    await supabase
      .from('production_orders')
      .update({ status: 'paused', paused_at: new Date().toISOString() })
      .eq('machine_id', activeShift.machine_id)
      .eq('status', 'active')
    const { data, error } = await supabase.from('production_orders').insert({
      order_number: newOrderNumber, machine_id: activeShift.machine_id,
      target_qty: parseInt(newOrderTarget) || 0, status: 'active',
      created_by: profile.id, notes: newOrderNotes || null
    }).select().single()
    if (!error && data) { setActiveOrderId(data.id); setShowNewOrder(false); setNewOrderNumber(''); setNewOrderTarget(''); setNewOrderNotes(''); loadOrders() }
    setSavingOrder(false)
  }
  const handlePauseOrder = async (id: string) => {
    await supabase.from('production_orders').update({ status: 'paused', paused_at: new Date().toISOString() }).eq('id', id)
    if (activeOrderId === id) setActiveOrderId(''); loadOrders()
  }
  const handleResumeOrder = async (id: string) => {
    if (!activeShift) return
    await supabase
      .from('production_orders')
      .update({ status: 'paused', paused_at: new Date().toISOString() })
      .eq('machine_id', activeShift.machine_id)
      .eq('status', 'active')
      .neq('id', id)
    await supabase.from('production_orders').update({ status: 'active', paused_at: null }).eq('id', id)
    setActiveOrderId(id); loadOrders()
  }
  // Prev report
  const getHourIndex = (h: number) => shiftHours.indexOf(h)
  const selectedHourIndex = getHourIndex(selectedHour)
  const orderedReports = [...existingReports]
    .filter(r => getHourIndex(r.hour_start) !== -1)
    .sort((a,b) => getHourIndex(a.hour_start) - getHourIndex(b.hour_start))
  const previousReports = orderedReports.filter(r => getHourIndex(r.hour_start) < selectedHourIndex)
  const prevReport = previousReports[previousReports.length - 1] as ReportExt | undefined
  const prevGood    = prevReport?.counter_good    ?? 0
  const prevReject  = prevReport?.counter_reject  ?? 0
  const prevRuntime = prevReport?.counter_runtime ?? 0
  const prevReady   = prevReport?.counter_ready   ?? 0
  const prevAlarm   = prevReport?.counter_alarm   ?? 0

  const curGood    = parseInt(counterGood)    || 0
  const curReject  = parseInt(counterReject)  || 0
  const curRuntime = parseHHMM(counterRuntime)
  const curReady   = parseHHMM(counterReady)
  const curAlarm   = parseHHMM(counterAlarm)

  const incGood    = counterGood    !== '' ? Math.max(0, curGood    - prevGood)    : 0
  const incReject  = counterReject  !== '' ? Math.max(0, curReject  - prevReject)  : 0
  const incRuntime = counterRuntime !== '' ? Math.max(0, curRuntime - prevRuntime) : 0
  const incReady   = counterReady   !== '' ? Math.max(0, curReady   - prevReady)   : 0
  const incAlarm   = counterAlarm   !== '' ? Math.max(0, curAlarm   - prevAlarm)   : 0

  const timeSum = incRuntime + incReady + incAlarm
  const allTimesFilled = counterRuntime !== '' && counterReady !== '' && counterAlarm !== ''
  const efficiency  = incGood > 0 ? Math.round(incGood / activeTarget * 100) : 0
  const rejectPct   = (incGood + incReject) > 0 ? Math.round(incReject / (incGood + incReject) * 100) : 0
  const machineRate = incRuntime > 0 ? Math.round(incGood / incRuntime * 60) : 0
  const availability = timeSum > 0 ? Math.round(incRuntime / timeSum * 100) : 0
  const belowTarget = !testMode && incGood > 0 && incGood < activeTarget
  const alreadyReported = existingReports.some(r => r.hour_start === selectedHour)
  const currentSlot = testMode ? Math.floor(now.getMinutes() / 3) : hour
  const currentSlotBelongsToShift = testMode || shiftHours.includes(currentSlot)
  const currentSlotReported = currentSlotBelongsToShift && existingReports.some(r => r.hour_start === currentSlot)
  const reportedHours = existingReports.map(r => r.hour_start)
  const firstMissingHour = shiftHours.find(h => !reportedHours.includes(h))
  const firstOpenMissingHour = shiftHours.find(h =>
    !reportedHours.includes(h) &&
    (testMode || !activeShift || canEnterHourlyReport(activeShift.shift_date, activeShift.shift_type, h, now))
  )
  const mustFillPreviousHour = firstMissingHour !== undefined && selectedHour !== firstMissingHour
  const shouldWarnCurrentSlot = firstOpenMissingHour !== undefined && !currentSlotReported
  const activeOrder = orders.find(o => o.id === activeOrderId)
  const selectedReportOpenAt = activeShift && !testMode
    ? getReportEntryOpenAt(activeShift.shift_date, activeShift.shift_type, selectedHour)
    : null
  const selectedReportCanBeEntered = !selectedReportOpenAt || new Date().getTime() >= selectedReportOpenAt.getTime()
  const lastReportForFinish = orderedReports[orderedReports.length - 1] as ReportExt | undefined
  const lastGood = lastReportForFinish?.counter_good ?? 0
  const lastReject = lastReportForFinish?.counter_reject ?? 0
  const lastRuntime = lastReportForFinish?.counter_runtime ?? 0
  const lastReady = lastReportForFinish?.counter_ready ?? 0
  const lastAlarm = lastReportForFinish?.counter_alarm ?? 0

  const handleFinishOrder = async () => {
    if (!activeShift || !profile || !activeOrderId) return
    const curG = parseInt(finishCounterGood)  || 0
    const curR = parseInt(finishCounterReject) || 0
    const curRt = parseHHMM(finishCounterRuntime)
    const curRd = parseHHMM(finishCounterReady)
    const curAl = parseHHMM(finishCounterAlarm)
    const incG  = Math.max(0, curG  - lastGood)
    const incRj = Math.max(0, curR  - lastReject)
    const incRt = Math.max(0, curRt - lastRuntime)
    const incRd = Math.max(0, curRd - lastReady)
    const incAl = Math.max(0, curAl - lastAlarm)
    const finishErrors: string[] = []
    if (!finishCounterGood) finishErrors.push('Wpisz stan licznika dobrych sztuk')
    if (!finishCounterRuntime) finishErrors.push('Wpisz stan licznika czasu pracy (HH:MM)')
    if (!finishCounterReady) finishErrors.push('Wpisz stan licznika czasu gotowosci (HH:MM)')
    if (!finishCounterAlarm) finishErrors.push('Wpisz stan licznika czasu alarmu (HH:MM)')
    if (finishCounterRuntime && !isValidHHMM(finishCounterRuntime)) finishErrors.push('Czas pracy wpisz w formacie HH:MM, z minutami 00-59')
    if (finishCounterReady && !isValidHHMM(finishCounterReady)) finishErrors.push('Czas gotowosci wpisz w formacie HH:MM, z minutami 00-59')
    if (finishCounterAlarm && !isValidHHMM(finishCounterAlarm)) finishErrors.push('Czas alarmu wpisz w formacie HH:MM, z minutami 00-59')
    if (finishCounterGood !== '' && lastGood > 0 && curG < lastGood) finishErrors.push('Licznik dobrych nie moze malec')
    if (finishCounterReject !== '' && lastReject > 0 && curR < lastReject) finishErrors.push('Licznik odrzutu nie moze malec')
    if (finishCounterRuntime !== '' && lastRuntime > 0 && curRt < lastRuntime) finishErrors.push('Licznik czasu pracy nie moze malec')
    if (finishCounterReady !== '' && lastReady > 0 && curRd < lastReady) finishErrors.push('Licznik czasu gotowosci nie moze malec')
    if (finishCounterAlarm !== '' && lastAlarm > 0 && curAl < lastAlarm) finishErrors.push('Licznik czasu alarmu nie moze malec')
    if (finishErrors.length) { setErrors(finishErrors); return }
    setSavingFinish(true)
    const now = new Date()
    const finishHour = now.getHours()
    const { error } = await supabase.from('hourly_reports').insert({
      shift_id: activeShift.id, machine_id: activeShift.machine_id, operator_id: profile.id,
      hour_block: `${String(finishHour).padStart(2,'0')}:00–${String(finishHour).padStart(2,'00')}:${String(now.getMinutes()).padStart(2,'0')}`,
      report_date: activeShift.shift_date, hour_start: finishHour,
      good_count: incG, reject_count: incRj, total_count: curG,
      counter_good: curG, counter_reject: curR,
      runtime_min: incRt, ready_min: incRd, alarm_min: incAl,
      downtime_min: 0, micro_stoppage_min: 0, changeover_min: 0, failure_min: 0,
      counter_runtime: curRt, counter_ready: curRd, counter_alarm: curAl,
      target: activeTarget,
      notes: finishNotes || 'Zakończenie zlecenia', status: 'submitted',
      order_id: activeOrderId, order_qty: incG
    })
    if (!error) {
      await supabase.from('production_orders').update({ status: 'completed', completed_at: now.toISOString() }).eq('id', activeOrderId)
      setActiveOrderId('')
      setShowFinishOrder(false)
      setFinishCounterGood(''); setFinishCounterReject('')
      setFinishCounterRuntime(''); setFinishCounterReady(''); setFinishCounterAlarm('')
      setFinishNotes('')
      loadReports(); loadOrders()
    } else {
      setErrors([error.message])
    }
    setSavingFinish(false)
  }

  const validate = (): string[] => {
    const errs: string[] = []
    const orderQtyVal = parseInt(orderQty) || incGood
    if (!counterGood)    errs.push('Wpisz stan licznika dobrych sztuk')
    if (!counterRuntime) errs.push('Wpisz stan licznika czasu pracy (HH:MM)')
    if (!counterReady)   errs.push('Wpisz stan licznika czasu gotowości (HH:MM)')
    if (!counterAlarm)   errs.push('Wpisz stan licznika czasu alarmu (HH:MM)')
    if (counterRuntime && !isValidHHMM(counterRuntime)) errs.push('Czas pracy wpisz w formacie HH:MM, z minutami 00-59')
    if (counterReady && !isValidHHMM(counterReady)) errs.push('Czas gotowości wpisz w formacie HH:MM, z minutami 00-59')
    if (counterAlarm && !isValidHHMM(counterAlarm)) errs.push('Czas alarmu wpisz w formacie HH:MM, z minutami 00-59')
    if (!testMode && activeShift && isShiftPastAutoClose(activeShift.shift_date, activeShift.shift_type)) errs.push('Zmiana zostala automatycznie zamknieta po buforze 60 minut')
    if (!testMode && activeShift && !canEnterHourlyReport(activeShift.shift_date, activeShift.shift_type, selectedHour)) {
      const openAt = getReportEntryOpenAt(activeShift.shift_date, activeShift.shift_type, selectedHour)
      errs.push(`Raport za ten blok mozna wpisac dopiero od ${openAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`)
    }
    if (mustFillPreviousHour && firstMissingHour !== undefined) errs.push(`Najpierw wpisz zalegly blok ${formatHourBlock(firstMissingHour)}`)
    if (!testMode && !activeOrderId) errs.push('Wybierz aktywne zlecenie produkcyjne')
    if (!testMode && allTimesFilled && timeSum !== 60) errs.push(`Suma przyrostów wynosi ${minsToHHMM(timeSum)} — musi być 01:00`)
    if (belowTarget && !downtimeReason.trim()) errs.push(`Przyrost ${incGood} szt poniżej targetu — wymagana przyczyna`)
    if (alreadyReported) errs.push(`Raport za ${testMode ? formatTestBlock(selectedHour) : formatHourBlock(selectedHour)} już istnieje`)
    if (activeOrderId && orderQtyVal > incGood) errs.push('Sztuki na zlecenie nie mogą być większe niż przyrost dobrych sztuk')
    if (downtimes.some(d => d.duration_min <= 0)) errs.push('Zdarzenie przestojowe musi mieć czas większy od 0 min')
    if (counterGood !== '' && prevGood > 0 && curGood < prevGood) errs.push('Licznik dobrych nie może maleć')
    if (counterReject !== '' && prevReject > 0 && curReject < prevReject) errs.push('Licznik odrzutu nie może maleć')
    if (counterRuntime !== '' && prevRuntime > 0 && curRuntime < prevRuntime) errs.push('Licznik czasu pracy nie może maleć')
    if (counterReady !== '' && prevReady > 0 && curReady < prevReady) errs.push('Licznik czasu gotowości nie może maleć')
    if (counterAlarm !== '' && prevAlarm > 0 && curAlarm < prevAlarm) errs.push('Licznik czasu alarmu nie może maleć')
    return errs
  }

  const handleSave = async () => {
    const errs = validate()
    if (errs.length) { setErrors(errs); return }
    if (!activeShift || !profile) return
    setSaving(true); setErrors([])
    try {
      const orderQtyVal = parseInt(orderQty) || incGood
      const { data: currentReports } = await supabase
        .from('hourly_reports')
        .select('id')
        .eq('shift_id', activeShift.id)
        .eq('hour_start', selectedHour)
        .is('deleted_at', null)
        .maybeSingle()
      if (currentReports) {
        setErrors([`Raport za ${testMode ? formatTestBlock(selectedHour) : formatHourBlock(selectedHour)} został już zapisany na innym urządzeniu`])
        await loadReports()
        return
      }
      const { data: report, error } = await supabase.from('hourly_reports').insert({
        shift_id: activeShift.id, machine_id: activeShift.machine_id, operator_id: profile.id,
        hour_block: testMode ? formatTestBlock(selectedHour) : formatHourBlock(selectedHour), report_date: activeShift.shift_date, hour_start: selectedHour,
        good_count: incGood, reject_count: incReject, total_count: curGood,
        counter_good: curGood, counter_reject: curReject,
        runtime_min: incRuntime, ready_min: incReady, alarm_min: incAlarm,
        downtime_min: 0, micro_stoppage_min: 0, changeover_min: 0, failure_min: 0,
        counter_runtime: curRuntime, counter_ready: curReady, counter_alarm: curAlarm,
        target: activeTarget,
        downtime_reason: downtimeReason || (testMode && incGood < activeTarget ? 'Tryb testowy' : null), notes: notes || null, status: 'submitted',
        order_id: activeOrderId || null, order_qty: activeOrderId ? orderQtyVal : null
      }).select().single()
      if (error) { setErrors([error.message]); return }
      if (downtimes.length && report) {
        await supabase.from('downtime_events').insert(downtimes.map(d => ({
          report_id: report.id, shift_id: activeShift.id, machine_id: activeShift.machine_id,
          category: d.category, duration_min: d.duration_min, description: d.description || null
        })))
      }
      setSaved(true); setTimeout(() => setSaved(false), 3000)
      setCounterGood(''); setCounterReject(''); setCounterRuntime(''); setCounterReady(''); setCounterAlarm('')
      setDowntimeReason(''); setNotes(''); setDowntimes([]); setOrderQty('')
      const nextReported = [...reportedHours, selectedHour]
      const nextOpenHour = shiftHours.find(h => !nextReported.includes(h))
      if (nextOpenHour !== undefined) setSelectedHour(nextOpenHour)
      loadReports(); loadOrders()
    } finally { setSaving(false) }
  }

  if (!activeShift) return null

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Wpisz wynik godziny</h1>
          <p className="text-navy-400 mt-1">{activeMachine?.name} · Zmiana {activeShift.shift_type}</p>
          {!testMode && firstOpenMissingHour !== undefined && firstOpenMissingHour !== currentSlot && (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-300">
              Masz zalegly raport: {formatHourBlock(firstOpenMissingHour)}. Kolejne godziny beda dostepne po jego zapisaniu.
            </div>
          )}
          {testMode && (
            <div className="mt-2 inline-flex rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-300">
              Tryb testowy: szybkie wpisy do analizy
            </div>
          )}
        </div>
        <div className="text-right">
          <div className={cn('text-3xl font-bold font-mono', isUrgent && shouldWarnCurrentSlot ? 'text-red-400' : currentSlotReported ? 'text-green-400' : 'text-white')}>{currentSlotReported ? 'OK' : countdown}</div>
          <div className="text-xs text-navy-400">{currentSlotReported ? 'obecny blok wpisany' : 'do konca godziny'}</div>
          {isUrgent && shouldWarnCurrentSlot && <div className="text-xs text-red-400 font-bold animate-pulse">⚠ CZAS NA WPIS!</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">

          {/* Hour selector */}
          <div className="card">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="card-title">Blok godziny</div>
                {prevReport
                  ? <div className="text-xs text-navy-400 mt-1">Poprzednia: dobre <span className="text-white font-mono font-bold">{prevGood.toLocaleString('pl-PL')}</span> · czas pracy <span className="text-green-400 font-mono font-bold">{minsToHHMM(prevRuntime)}</span></div>
                  : <div className="text-xs text-amber-400 mt-1">⚠ Pierwsza godzina zmiany</div>
                }
              </div>
              <select value={selectedHour} onChange={e => setSelectedHour(parseInt(e.target.value))} className="input w-auto text-sm font-bold">
                {(() => {
                  const hours = shiftHours
                  const currentHour = now.getHours()

                  return hours.map((h, idx) => {
                    const alreadyReported = reportedHours.includes(h)

                    // Czy godzina już minęła (uwzględnia zmianę nocną)
                    // Czy godzina już minęła — uwzględnia zmianę nocną
                    const canEnter = testMode || !activeShift || canEnterHourlyReport(activeShift.shift_date, activeShift.shift_type, h, now)
                    let hasPassed = canEnter
                    if (false && activeShift?.shift_type === 'III') {
                      // Nocna: 22,23,0,1,2,3,4,5
                      if (h >= 22) hasPassed = currentHour >= 22 ? currentHour > h : true
                      else hasPassed = currentHour >= 0 && currentHour < 22 ? true : currentHour > h
                    } else {
                      // Dzienna: jeśli aktualna godzina przekroczyła koniec zmiany — wszystkie godziny minęły
                      const shiftEnd = activeShift?.shift_type === 'I' ? 14 : 22
                      hasPassed = currentHour >= shiftEnd ? true : currentHour > h
                    }

                    // Pierwsza godzina zmiany zawsze dostępna
                    hasPassed = canEnter
                    const isFirstHour = idx === 0

                    // Kolejność — poprzednia godzina musi być wpisana (lub to pierwsza)
                    const prevHour = idx > 0 ? hours[idx - 1] : null
                    const prevReported = prevHour === null || reportedHours.includes(prevHour)

                    const isDisabled = alreadyReported ||
                      (!testMode && !hasPassed) ||
                      (!testMode && !isFirstHour && !prevReported) ||
                      (firstMissingHour !== undefined && h !== firstMissingHour && !alreadyReported)

                    return (
                      <option key={h} value={h} disabled={isDisabled}>
                        {testMode ? formatTestBlock(h) : `${String(h).padStart(2,'0')}:00–${String((h+1)%24).padStart(2,'00')}:00`}{alreadyReported ? ' ✓' : ''}
                      </option>
                    )
                  })
                })()}
              </select>
            </div>
            {!selectedReportCanBeEntered && selectedReportOpenAt && (
              <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-semibold text-amber-300">
                Ten blok bedzie dostepny do wpisania od {selectedReportOpenAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}.
              </div>
            )}
          </div>

          {/* Zlecenia */}
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">Zlecenie produkcyjne</div><div className="card-sub">Aktywne zlecenie</div></div>
              <button onClick={() => setShowNewOrder(true)} className="btn-secondary text-xs py-1.5 px-3">+ Nowe zlecenie</button>
            </div>

            {activeOrder ? (
              <div className="bg-brand/10 border border-brand/30 rounded-xl p-4 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-bold text-white text-lg font-mono">{activeOrder.order_number}</div>
                    <div className="text-xs text-green-400 font-bold">● AKTYWNE</div>
                  </div>
                  {activeOrder.target_qty > 0 && (
                    <div className="text-right">
                      <div className="text-lg font-bold font-mono text-white">{activeOrder.produced_qty.toLocaleString('pl-PL')} / {activeOrder.target_qty.toLocaleString('pl-PL')} szt</div>
                      <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden mt-1 w-40">
                        <div className="h-full bg-brand rounded-full" style={{ width: `${Math.min(activeOrder.produced_qty / activeOrder.target_qty * 100, 100)}%` }} />
                      </div>
                      <div className="text-xs text-navy-400 mt-0.5">{Math.round(activeOrder.produced_qty / activeOrder.target_qty * 100)}% · pozostało {Math.max(0, activeOrder.target_qty - activeOrder.produced_qty).toLocaleString('pl-PL')} szt</div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handlePauseOrder(activeOrder.id)} className="btn-secondary text-xs py-1.5 px-3">⏸ Pauzuj</button>
                  <button onClick={() => setShowFinishOrder(true)} className="bg-amber-500 hover:bg-amber-400 text-navy-900 font-bold text-xs py-1.5 px-3 rounded-xl transition-all">🏁 Zakończ zlecenie</button>
                </div>
              </div>
            ) : (
              <div className={cn(
                'text-center py-3 text-sm mb-2 rounded-xl border',
                testMode
                  ? 'text-navy-500 border-navy-700 bg-navy-900/60'
                  : 'text-amber-300 border-amber-500/30 bg-amber-500/10'
              )}>
                {testMode
                  ? 'Brak aktywnego zlecenia'
                  : 'Brak aktywnego zlecenia - wybierz, wznow albo utworz zlecenie przed zapisem raportu'}
              </div>
            )}

            {orders.filter(o => o.status === 'paused').map(o => (
              <div key={o.id} className="bg-navy-900 border border-navy-700 rounded-xl p-3 mb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white font-mono">{o.order_number}</div>
                    <div className="text-xs text-amber-400">⏸ ZAPAUZOWANE · {o.produced_qty.toLocaleString('pl-PL')} szt</div>
                  </div>
                  <button onClick={() => handleResumeOrder(o.id)} className="btn-primary text-xs py-1.5 px-3">▶ Wznów</button>
                </div>
              </div>
            ))}

            {activeOrderId && (
              <div className="mt-3">
                <label className="label">Sztuki na zlecenie tej godziny</label>
                <input type="number" value={orderQty} onChange={e => setOrderQty(e.target.value)}
                  placeholder={incGood > 0 ? `${incGood} (cały przyrost)` : 'Automatycznie'}
                  className="input" />
              </div>
            )}
          </div>

          {/* Modal nowe zlecenie */}
          {showNewOrder && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.9)', backdropFilter: 'blur(8px)' }}>
              <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-md">
                <h2 className="text-xl font-bold text-white mb-5">Nowe zlecenie produkcyjne</h2>
                <div className="space-y-4">
                  <div>
                    <label className="label">Numer zlecenia</label>
                    <input value={newOrderNumber} onChange={e => setNewOrderNumber(e.target.value)} placeholder="Z/01/05/26" className="input font-mono text-lg" />
                    <div className="text-xs text-navy-500 mt-1">Format: Z/numer/miesiąc/rok</div>
                  </div>
                  <div>
                    <label className="label">Wielkość zlecenia (szt)</label>
                    <input type="number" value={newOrderTarget} onChange={e => setNewOrderTarget(e.target.value)} placeholder="np. 50000" className="input text-lg font-bold font-mono" />
                  </div>
                  <div>
                    <label className="label">Uwagi</label>
                    <input value={newOrderNotes} onChange={e => setNewOrderNotes(e.target.value)} placeholder="Opcjonalnie..." className="input" />
                  </div>
                  {activeOrderId && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-400">
                      ⚠ Aktywne zlecenie zostanie zapauzowane automatycznie
                    </div>
                  )}
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={handleCreateOrder} disabled={savingOrder || !newOrderNumber} className="btn-primary flex-1 py-3">
                    {savingOrder ? 'Tworzenie...' : 'Utwórz zlecenie'}
                  </button>
                  <button onClick={() => setShowNewOrder(false)} className="btn-secondary px-5 py-3">Anuluj</button>
                </div>
              </div>
            </div>
          )}

          {/* Liczniki produkcji */}
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">Liczniki produkcji</div><div className="card-sub">Stan licznika na koniec godziny</div></div>
              {incGood > 0 && <div className={cn('text-2xl font-bold font-mono', efficiencyColor(efficiency))}>{efficiency}%</div>}
            </div>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <CounterInput label="Licznik dobrych (szt)" sublabel="Wyroby zgodne łącznie" value={counterGood} onChange={setCounterGood} prevValue={prevGood} color="text-green-400" placeholder="np. 4256" />
              <CounterInput label="Licznik odrzutu (szt)" sublabel="Odrzut łącznie" value={counterReject} onChange={setCounterReject} prevValue={prevReject} color="text-red-400" placeholder="np. 328" />
            </div>
            {incGood > 0 && (
              <div className="bg-navy-900 rounded-xl p-3 mb-3">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-navy-400">Przyrost tej godziny</span>
                  <span className={cn('font-bold font-mono', efficiencyColor(efficiency))}>+{incGood.toLocaleString('pl-PL')} szt ({efficiency}%)</span>
                </div>
                <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', efficiencyBg(efficiency))} style={{ width: `${Math.min(efficiency,100)}%` }} />
                </div>
                {incReject > 0 && <div className={cn('text-sm font-bold mt-2', rejectPct > 10 ? 'text-red-400' : rejectPct > 5 ? 'text-amber-400' : 'text-green-400')}>Odrzut: +{incReject} szt · {rejectPct}%</div>}
              </div>
            )}
            {belowTarget && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                <div className="text-red-400 font-bold text-sm mb-2">⚠ Przyrost {incGood} szt poniżej targetu ({TARGET}) — wymagana przyczyna</div>
                <textarea value={downtimeReason} onChange={e => setDowntimeReason(e.target.value)} placeholder="Opisz przyczynę..." rows={2} className="input text-sm font-normal resize-none" />
              </div>
            )}
          </div>

          {/* Liczniki czasów HH:MM */}
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">Liczniki czasów pracy</div><div className="card-sub">{testMode ? 'Tryb testowy — przyrost może mieć dowolną długość' : 'Format HH:MM — przyrost musi sumować się do 01:00'}</div></div>
              {allTimesFilled && (
                <div className={cn('font-bold font-mono text-lg', testMode || timeSum === 60 ? 'text-green-400' : timeSum > 60 ? 'text-red-400' : 'text-amber-400')}>
                  {minsToHHMM(timeSum)}{testMode ? '' : ' / 01:00'}
                </div>
              )}
            </div>
            {allTimesFilled && (
              <div className="mb-4">
                <div className="flex gap-px h-3 rounded-xl overflow-hidden">
                  <div className="bg-green-500 rounded-l" style={{ width: `${Math.min(incRuntime/60*100,100)}%` }} />
                  <div className="bg-amber-400" style={{ width: `${Math.min(incReady/60*100,100)}%` }} />
                  <div className="bg-red-500 rounded-r" style={{ width: `${Math.min(incAlarm/60*100,100)}%` }} />
                </div>
                <div className="flex gap-4 mt-1.5 text-xs">
                  <span className="text-green-400">● Praca: {minsToHHMM(incRuntime)}</span>
                  <span className="text-amber-400">● Gotowość: {minsToHHMM(incReady)}</span>
                  <span className="text-red-400">● Alarm: {minsToHHMM(incAlarm)}</span>
                  {(testMode || timeSum === 60) && <span className="text-green-400 ml-auto">✓ OK</span>}
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-4">
              <TimeInput label="Czas pracy" sublabel="Maszyna produkuje" value={counterRuntime} onChange={setCounterRuntime} prevValue={prevRuntime} color="text-green-400" />
              <TimeInput label="Czas gotowości" sublabel="Maszyna stoi, gotowa" value={counterReady} onChange={setCounterReady} prevValue={prevReady} color="text-amber-400" />
              <TimeInput label="Czas alarmu" sublabel="Maszyna zatrzymana" value={counterAlarm} onChange={setCounterAlarm} prevValue={prevAlarm} color="text-red-400" />
            </div>
          </div>

          {/* Live KPI */}
          {incGood > 0 && incRuntime > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {[
                { l: 'Efektywność',  v: efficiency + '%',       c: efficiencyColor(efficiency) },
                { l: '% odrzutu',    v: rejectPct + '%',        c: rejectPct > 10 ? 'text-red-400' : rejectPct > 5 ? 'text-amber-400' : 'text-green-400' },
                { l: 'Wyd. maszyny', v: machineRate + ' szt/h', c: 'text-cyan-400' },
                { l: 'Dostępność',   v: availability + '%',     c: availability > 90 ? 'text-green-400' : availability > 75 ? 'text-amber-400' : 'text-red-400' },
              ].map(k => (
                <div key={k.l} className="bg-navy-900 rounded-xl p-3 text-center">
                  <div className="text-xs text-navy-400 mb-1">{k.l}</div>
                  <div className={cn('text-lg font-bold font-mono', k.c)}>{k.v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Przestoje */}
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">Zdarzenia przestojowe</div><div className="card-sub">Opcjonalnie</div></div>
              <button onClick={() => setDowntimes(p => [...p, { category: 'mechanical_failure', duration_min: 0, description: '' }])} className="btn-secondary text-xs py-1.5 px-3">+ Dodaj</button>
            </div>
            {downtimes.length === 0
              ? <div className="text-center py-4 text-navy-500 text-sm">Brak zdarzeń</div>
              : downtimes.map((d, i) => (
                <div key={i} className="bg-navy-900 rounded-xl p-3 mb-2">
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <select value={d.category} onChange={e => setDowntimes(p => p.map((x,j) => j===i ? {...x, category: e.target.value as DowntimeCategory} : x))} className="input text-sm col-span-2">
                      {Object.entries(DOWNTIME_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <input type="number" value={d.duration_min||''} onChange={e => setDowntimes(p => p.map((x,j) => j===i ? {...x, duration_min: parseInt(e.target.value)||0} : x))} placeholder="min" className="input text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={d.description} onChange={e => setDowntimes(p => p.map((x,j) => j===i ? {...x, description: e.target.value} : x))} placeholder="Opis..." className="input text-sm flex-1" />
                    <button onClick={() => setDowntimes(p => p.filter((_,j) => j!==i))} className="text-red-400 px-2">✕</button>
                  </div>
                </div>
              ))
            }
          </div>

          <div className="card">
            <label className="label">Uwagi ogólne</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcjonalnie..." rows={2} className="input text-sm font-normal resize-none" />
          </div>

          {/* Modal zakończenia zlecenia */}
          {showFinishOrder && activeOrder && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.9)', backdropFilter: 'blur(8px)' }}>
              <div className="bg-navy-800 border border-amber-500/30 rounded-2xl p-6 w-full max-w-lg">
                <h2 className="text-xl font-bold text-white mb-1">🏁 Zakończ zlecenie</h2>
                <p className="text-navy-400 text-sm mb-5">Zlecenie: <span className="font-mono font-bold text-white">{activeOrder.order_number}</span> · Wpisz aktualny stan liczników</p>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-400 mb-4">
                  ⚠ Suma czasów NIE musi wynosić 60 minut — wpisz rzeczywisty czas od ostatniego raportu do teraz
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Licznik dobrych (szt)</label>
                      <input type="number" value={finishCounterGood} onChange={e => setFinishCounterGood(e.target.value)} placeholder="Stan licznika" className="input text-lg font-bold font-mono" />
                    </div>
                    <div>
                      <label className="label">Licznik odrzutu (szt)</label>
                      <input type="number" value={finishCounterReject} onChange={e => setFinishCounterReject(e.target.value)} placeholder="Stan licznika" className="input text-lg font-bold font-mono" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="label text-green-400">Czas pracy</label>
                      <TimeInput label="" value={finishCounterRuntime} onChange={setFinishCounterRuntime} prevValue={lastRuntime} color="text-green-400" compact />
                    </div>
                    <div>
                      <label className="label text-amber-400">Czas gotowości</label>
                      <TimeInput label="" value={finishCounterReady} onChange={setFinishCounterReady} prevValue={lastReady} color="text-amber-400" compact />
                    </div>
                    <div>
                      <label className="label text-red-400">Czas alarmu</label>
                      <TimeInput label="" value={finishCounterAlarm} onChange={setFinishCounterAlarm} prevValue={lastAlarm} color="text-red-400" compact />
                    </div>
                  </div>
                  <div>
                    <label className="label">Uwagi</label>
                    <input value={finishNotes} onChange={e => setFinishNotes(e.target.value)} placeholder="Opcjonalnie..." className="input" />
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={handleFinishOrder} disabled={savingFinish || !finishCounterGood}
                    className="flex-1 bg-amber-500 hover:bg-amber-400 text-navy-900 font-bold py-3 rounded-xl transition-all disabled:opacity-50">
                    {savingFinish ? 'Zapisywanie...' : '🏁 Zakończ i zapisz'}
                  </button>
                  <button onClick={() => setShowFinishOrder(false)} className="btn-secondary px-5 py-3">Anuluj</button>
                </div>
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <ValidationRobot errors={errors} />
              <div className="font-bold text-red-400 mb-2 text-sm">Popraw błędy:</div>
              {errors.map((e,i) => <div key={i} className="text-red-300 text-sm">• {e}</div>)}
            </div>
          )}

          <button onClick={handleSave} disabled={saving}
            className={cn('btn w-full py-4 text-base font-bold', saved ? 'bg-green-500 text-white' : 'btn-primary')}>
            {saving ? 'Zapisywanie...' : saved ? '✓ Zapisano!' : '💾 Zapisz raport godzinowy'}
          </button>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="card">
            <div className="card-header"><div><div className="card-title">Raporty tej zmiany</div><div className="card-sub">{existingReports.length} godzin</div></div></div>
            {existingReports.length === 0
              ? <div className="text-center py-4 text-navy-500 text-sm">Brak raportów</div>
              : <div className="space-y-2">
                {existingReports.map(r => {
                  const eff = Number(r.efficiency_pct)
                  const rj = Math.round(r.reject_count / Math.max(r.good_count + r.reject_count, 1) * 100)
                  return (
                    <div key={r.id} className="bg-navy-900 rounded-xl p-3">
                      <div className="flex justify-between mb-1">
                        <span className="font-mono text-xs text-navy-400">{r.hour_block}</span>
                        <span className={cn('font-bold text-sm', efficiencyColor(eff))}>{eff}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold text-white font-mono">+{r.good_count.toLocaleString('pl-PL')} szt</span>
                        {r.reject_count > 0 && <span className="text-red-400 text-xs">{rj}% odrz.</span>}
                      </div>
                      <div className="flex gap-2 mt-1 text-xs">
                        <span className="text-green-400">⏱ {minsToHHMM(r.runtime_min)}</span>
                        {(r as ReportExt).alarm_min != null && (r as ReportExt).alarm_min! > 0 && <span className="text-red-400">🔔 {minsToHHMM((r as ReportExt).alarm_min!)}</span>}
                      </div>
                      {(r as ReportExt).order_id && (
                        <div className="text-xs text-brand mt-1">📋 {orders.find(o => o.id === (r as ReportExt).order_id)?.order_number ?? 'zlecenie'}</div>
                      )}
                      <div className="h-1 bg-navy-700 rounded mt-1.5 overflow-hidden">
                        <div className={cn('h-full rounded', efficiencyBg(eff))} style={{ width: `${Math.min(eff,100)}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            }
          </div>

          {existingReports.length > 0 && (
            <div className="card">
              <div className="card-title mb-3">Podsumowanie zmiany</div>
              <div className="space-y-2 text-sm">
                {[
                  { l: 'Produkcja łącznie', v: existingReports.reduce((s,r)=>s+r.good_count,0).toLocaleString('pl-PL') + ' szt', c: 'text-white' },
                  { l: 'Śr. efektywność', v: Math.round(existingReports.reduce((s,r)=>s+Number(r.efficiency_pct),0)/existingReports.length) + '%', c: efficiencyColor(Math.round(existingReports.reduce((s,r)=>s+Number(r.efficiency_pct),0)/existingReports.length)) },
                  { l: 'Odrzut łącznie', v: existingReports.reduce((s,r)=>s+r.reject_count,0) + ' szt', c: 'text-red-400' },
                  { l: 'Czas pracy łącznie', v: minsToHHMM(existingReports.reduce((s,r)=>s+r.runtime_min,0)), c: 'text-green-400' },
                  { l: 'Czas alarmu łącznie', v: minsToHHMM(existingReports.reduce((s,r)=>s+((r as ReportExt).alarm_min??0),0)), c: 'text-red-400' },
                ].map(k => (
                  <div key={k.l} className="flex justify-between">
                    <span className="text-navy-400">{k.l}</span>
                    <span className={cn('font-bold font-mono', k.c)}>{k.v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
