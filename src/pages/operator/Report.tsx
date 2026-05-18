import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { useCurrentHourBlock, useHourCountdown, useClock } from '@/hooks/useClock'
import { formatHourBlock, efficiencyColor, efficiencyBg, DOWNTIME_LABELS, cn } from '@/lib/utils'
import type { HourlyReport, DowntimeCategory } from '@/types/database'

const TARGET = 2100

interface DowntimeEntry {
  category: DowntimeCategory
  duration_min: number
  description: string
}

// Rozszerzony typ raportu z licznikami
interface ReportExt extends HourlyReport {
  counter_good?:    number
  counter_reject?:  number
  counter_runtime?: number
  counter_ready?:   number
  counter_alarm?:   number
  ready_min?:       number
  alarm_min?:       number
  reject_pct?:      number
  machine_rate?:    number
  availability_pct?: number
}

function CounterInput({
  label, sublabel, value, onChange, prevValue, color = 'text-white', placeholder = '0'
}: {
  label: string, sublabel?: string, value: string,
  onChange: (v: string) => void, prevValue: number,
  color?: string, placeholder?: string
}) {
  const cur = parseInt(value) || 0
  const increment = value ? Math.max(0, cur - prevValue) : 0
  const hasError = value !== '' && prevValue > 0 && cur < prevValue

  return (
    <div>
      <label className="label">{label}</label>
      {sublabel && <div className="text-xs text-navy-500 mb-1.5">{sublabel}</div>}
      <input
        type="number" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} min="0"
        className={cn('input text-xl font-bold font-mono py-3.5', hasError && 'border-red-500/60')}
      />
      {prevValue > 0 && (
        <div className="text-xs text-navy-500 mt-1">
          Poprzedni: <span className="font-mono text-navy-300">{prevValue.toLocaleString('pl-PL')}</span>
        </div>
      )}
      {value !== '' && (
        <div className={cn('text-sm font-bold mt-1', hasError ? 'text-red-400' : color)}>
          {hasError
            ? '⚠ Licznik nie może maleć'
            : `+${increment.toLocaleString('pl-PL')} ${label.includes('min') || label.includes('czas') || label.includes('Czas') ? 'min' : 'szt'}`
          }
        </div>
      )}
    </div>
  )
}

export default function OperatorReport() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { activeShift, activeMachine } = useShiftStore()
  const { display: countdown, isUrgent } = useHourCountdown()
  const { hour, dateISO } = useClock()

  // Liczniki produkcji
  const [counterGood,   setCounterGood]   = useState('')
  const [counterReject, setCounterReject] = useState('')

  // Liczniki czasów
  const [counterRuntime, setCounterRuntime] = useState('') // czas pracy
  const [counterReady,   setCounterReady]   = useState('') // czas w gotowości
  const [counterAlarm,   setCounterAlarm]   = useState('') // czas w alarmie

  const [downtimeReason, setDowntimeReason] = useState('')
  const [notes,          setNotes]          = useState('')
  const [downtimes,      setDowntimes]      = useState<DowntimeEntry[]>([])
  const [existingReports, setExistingReports] = useState<ReportExt[]>([])
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [errors,  setErrors]  = useState<string[]>([])
  const [selectedHour, setSelectedHour] = useState(hour)

  useEffect(() => {
    if (!activeShift) { navigate('/operator/shift'); return }
    loadReports()
  }, [activeShift])

  useEffect(() => { setSelectedHour(hour) }, [hour])

  const loadReports = async () => {
    if (!activeShift) return
    const { data } = await supabase
      .from('hourly_reports').select('*')
      .eq('shift_id', activeShift.id).is('deleted_at', null).order('hour_start')
    if (data) setExistingReports(data as ReportExt[])
  }

  // Poprzedni raport (ostatni przed wybraną godziną)
  const prevReport = [...existingReports]
    .filter(r => r.hour_start < selectedHour)
    .sort((a, b) => b.hour_start - a.hour_start)[0] as ReportExt | undefined

  // Poprzednie stany liczników
  const prevGood    = prevReport?.counter_good    ?? 0
  const prevReject  = prevReport?.counter_reject  ?? 0
  const prevRuntime = prevReport?.counter_runtime ?? 0
  const prevReady   = prevReport?.counter_ready   ?? 0
  const prevAlarm   = prevReport?.counter_alarm   ?? 0

  // Aktualne wartości
  const curGood    = parseInt(counterGood)    || 0
  const curReject  = parseInt(counterReject)  || 0
  const curRuntime = parseInt(counterRuntime) || 0
  const curReady   = parseInt(counterReady)   || 0
  const curAlarm   = parseInt(counterAlarm)   || 0

  // Przyrosty
  const incGood    = counterGood    !== '' ? Math.max(0, curGood    - prevGood)    : 0
  const incReject  = counterReject  !== '' ? Math.max(0, curReject  - prevReject)  : 0
  const incRuntime = counterRuntime !== '' ? Math.max(0, curRuntime - prevRuntime) : 0
  const incReady   = counterReady   !== '' ? Math.max(0, curReady   - prevReady)   : 0
  const incAlarm   = counterAlarm   !== '' ? Math.max(0, curAlarm   - prevAlarm)   : 0

  const timeSum    = incRuntime + incReady + incAlarm
  const allTimesFilled = counterRuntime !== '' && counterReady !== '' && counterAlarm !== ''

  // Wskaźniki
  const efficiency  = incGood > 0 ? Math.round(incGood / TARGET * 100) : 0
  const rejectPct   = (incGood + incReject) > 0 ? Math.round(incReject / (incGood + incReject) * 100) : 0
  const machineRate = incRuntime > 0 ? Math.round(incGood / incRuntime * 60) : 0
  const availability = timeSum > 0 ? Math.round(incRuntime / timeSum * 100) : 0
  const belowTarget = incGood > 0 && incGood < TARGET
  const alreadyReported = existingReports.some(r => r.hour_start === selectedHour)

  const validate = (): string[] => {
    const errs: string[] = []
    if (!counterGood)    errs.push('Wpisz stan licznika dobrych sztuk')
    if (!counterRuntime) errs.push('Wpisz stan licznika czasu pracy')
    if (!counterReady)   errs.push('Wpisz stan licznika czasu w gotowości')
    if (!counterAlarm)   errs.push('Wpisz stan licznika czasu w alarmie')
    if (allTimesFilled && timeSum !== 60) errs.push(`Suma przyrostów czasów wynosi ${timeSum} min — musi wynosić dokładnie 60 min`)
    if (belowTarget && !downtimeReason.trim()) errs.push(`Przyrost ${incGood} szt poniżej targetu (${TARGET}) — wymagana przyczyna`)
    if (alreadyReported) errs.push(`Raport za ${formatHourBlock(selectedHour)} już istnieje`)
    if (counterGood   !== '' && prevGood   > 0 && curGood   < prevGood)   errs.push('Licznik dobrych nie może być mniejszy niż poprzednio')
    if (counterReject !== '' && prevReject > 0 && curReject < prevReject)  errs.push('Licznik odrzutu nie może być mniejszy niż poprzednio')
    if (counterRuntime !== '' && prevRuntime > 0 && curRuntime < prevRuntime) errs.push('Licznik czasu pracy nie może być mniejszy niż poprzednio')
    if (counterReady   !== '' && prevReady   > 0 && curReady   < prevReady)   errs.push('Licznik czasu gotowości nie może być mniejszy niż poprzednio')
    if (counterAlarm   !== '' && prevAlarm   > 0 && curAlarm   < prevAlarm)   errs.push('Licznik czasu alarmu nie może być mniejszy niż poprzednio')
    return errs
  }

  const handleSave = async () => {
    const errs = validate()
    if (errs.length) { setErrors(errs); return }
    if (!activeShift || !profile) return

    setSaving(true); setErrors([])
    try {
      const { data: report, error } = await supabase
        .from('hourly_reports').insert({
          shift_id:    activeShift.id,
          machine_id:  activeShift.machine_id,
          operator_id: profile.id,
          hour_block:  formatHourBlock(selectedHour),
          report_date: dateISO,
          hour_start:  selectedHour,
          // Przyrosty produkcji
          good_count:   incGood,
          reject_count: incReject,
          total_count:  curGood,
          // Stany liczników produkcji
          counter_good:   curGood,
          counter_reject: curReject,
          // Przyrosty czasów
          runtime_min:        incRuntime,
          ready_min:          incReady,
          alarm_min:          incAlarm,
          // Stany liczników czasów
          counter_runtime: curRuntime,
          counter_ready:   curReady,
          counter_alarm:   curAlarm,
          // Stare kolumny — zerujemy (nie używane)
          downtime_min:       0,
          micro_stoppage_min: 0,
          changeover_min:     0,
          failure_min:        0,
          target:       activeMachine?.target_per_hour ?? TARGET,
          downtime_reason: downtimeReason || null,
          notes:           notes || null,
          status:          'submitted'
        }).select().single()

      if (error) { setErrors([error.message]); return }

      if (downtimes.length && report) {
        await supabase.from('downtime_events').insert(
          downtimes.map(d => ({
            report_id:    report.id,
            shift_id:     activeShift.id,
            machine_id:   activeShift.machine_id,
            category:     d.category,
            duration_min: d.duration_min,
            description:  d.description || null
          }))
        )
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      setCounterGood(''); setCounterReject('')
      setCounterRuntime(''); setCounterReady(''); setCounterAlarm('')
      setDowntimeReason(''); setNotes(''); setDowntimes([])
      loadReports()
    } finally { setSaving(false) }
  }

  if (!activeShift) return null

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Wpisz wynik godziny</h1>
          <p className="text-navy-400 mt-1">{activeMachine?.name} · Zmiana {activeShift.shift_type}</p>
        </div>
        <div className="text-right">
          <div className={cn('text-3xl font-bold font-mono', isUrgent ? 'text-red-400' : 'text-white')}>{countdown}</div>
          <div className="text-xs text-navy-400 mt-0.5">do końca godziny</div>
          {isUrgent && <div className="text-xs text-red-400 font-bold mt-0.5 animate-pulse">⚠ CZAS NA WPIS!</div>}
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
                  ? <div className="text-xs text-navy-400 mt-1">
                      Poprzednia godzina: dobre <span className="text-white font-mono font-bold">{prevGood.toLocaleString('pl-PL')}</span> ·
                      odrzut <span className="text-red-400 font-mono font-bold">{prevReject.toLocaleString('pl-PL')}</span> ·
                      czas pracy <span className="text-green-400 font-mono font-bold">{prevRuntime}</span> min
                    </div>
                  : <div className="text-xs text-amber-400 mt-1">⚠ Pierwsza godzina zmiany — wpisz aktualny stan liczników</div>
                }
              </div>
              <select value={selectedHour} onChange={e => setSelectedHour(parseInt(e.target.value))} className="input w-auto text-sm font-bold">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{formatHourBlock(h)}{existingReports.some(r => r.hour_start === h) ? ' ✓' : ''}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Liczniki produkcji */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Liczniki produkcji</div>
                <div className="card-sub">Aktualny stan licznika na koniec godziny {String(selectedHour+1).padStart(2,'0')}:00</div>
              </div>
              {incGood > 0 && (
                <div className={cn('text-2xl font-bold font-mono', efficiencyColor(efficiency))}>{efficiency}%</div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 mb-3">
              <CounterInput
                label="Licznik dobrych (szt)"
                sublabel="Stan licznika — wyroby zgodne łącznie"
                value={counterGood} onChange={setCounterGood}
                prevValue={prevGood} color="text-green-400"
                placeholder="np. 4256"
              />
              <CounterInput
                label="Licznik odrzutu (szt)"
                sublabel="Stan licznika — odrzut łącznie"
                value={counterReject} onChange={setCounterReject}
                prevValue={prevReject} color="text-red-400"
                placeholder="np. 328"
              />
            </div>

            {/* Pasek efektywności */}
            {incGood > 0 && (
              <div className="bg-navy-900 rounded-xl p-3 mb-3">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-navy-400">Przyrost tej godziny</span>
                  <span className={cn('font-bold font-mono', efficiencyColor(efficiency))}>
                    +{incGood.toLocaleString('pl-PL')} szt ({efficiency}% targetu)
                  </span>
                </div>
                <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', efficiencyBg(efficiency))}
                    style={{ width: `${Math.min(efficiency, 100)}%` }} />
                </div>
                {incReject > 0 && (
                  <div className={cn('text-sm font-bold mt-2', rejectPct > 10 ? 'text-red-400' : rejectPct > 5 ? 'text-amber-400' : 'text-green-400')}>
                    Odrzut tej godziny: +{incReject} szt · {rejectPct}%
                  </div>
                )}
              </div>
            )}

            {/* Below target */}
            {belowTarget && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                <div className="text-red-400 font-bold text-sm mb-2">
                  ⚠ Przyrost {incGood} szt poniżej targetu ({TARGET}) — wymagana przyczyna
                </div>
                <textarea value={downtimeReason} onChange={e => setDowntimeReason(e.target.value)}
                  placeholder="Opisz przyczynę niewykonania planu..."
                  rows={2} className="input text-sm font-normal resize-none" />
              </div>
            )}
          </div>

          {/* Liczniki czasów */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Liczniki czasów pracy</div>
                <div className="card-sub">Aktualny stan licznika — przyrost musi sumować się do 60 min</div>
              </div>
              {allTimesFilled && (
                <div className={cn('font-bold font-mono text-lg', timeSum === 60 ? 'text-green-400' : timeSum > 60 ? 'text-red-400' : 'text-amber-400')}>
                  {timeSum} / 60 min
                </div>
              )}
            </div>

            {/* Progress bar */}
            {allTimesFilled && (
              <div className="mb-4">
                <div className="flex gap-px h-3 rounded-xl overflow-hidden">
                  <div className="bg-green-500 rounded-l transition-all" style={{ width: `${Math.min(incRuntime/60*100, 100)}%` }} title={`Czas pracy: ${incRuntime} min`} />
                  <div className="bg-amber-400 transition-all" style={{ width: `${Math.min(incReady/60*100, 100)}%` }} title={`Gotowość: ${incReady} min`} />
                  <div className="bg-red-500 rounded-r transition-all" style={{ width: `${Math.min(incAlarm/60*100, 100)}%` }} title={`Alarm: ${incAlarm} min`} />
                </div>
                <div className="flex gap-4 mt-1.5 text-xs">
                  <span className="text-green-400">● Praca: {incRuntime} min</span>
                  <span className="text-amber-400">● Gotowość: {incReady} min</span>
                  <span className="text-red-400">● Alarm: {incAlarm} min</span>
                  {timeSum === 60 && <span className="text-green-400 ml-auto">✓ suma OK</span>}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <CounterInput
                label="Czas pracy (min)"
                sublabel="Maszyna produkuje"
                value={counterRuntime} onChange={setCounterRuntime}
                prevValue={prevRuntime} color="text-green-400"
                placeholder="np. 315"
              />
              <CounterInput
                label="Czas gotowości (min)"
                sublabel="Maszyna stoi, gotowa"
                value={counterReady} onChange={setCounterReady}
                prevValue={prevReady} color="text-amber-400"
                placeholder="np. 12"
              />
              <CounterInput
                label="Czas alarmu (min)"
                sublabel="Maszyna zatrzymana"
                value={counterAlarm} onChange={setCounterAlarm}
                prevValue={prevAlarm} color="text-red-400"
                placeholder="np. 8"
              />
            </div>
          </div>

          {/* Live KPI */}
          {incGood > 0 && incRuntime > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {[
                { l: 'Efektywność', v: efficiency + '%', c: efficiencyColor(efficiency) },
                { l: '% odrzutu', v: rejectPct + '%', c: rejectPct > 10 ? 'text-red-400' : rejectPct > 5 ? 'text-amber-400' : 'text-green-400' },
                { l: 'Wyd. maszyny', v: machineRate + ' szt/h', c: 'text-cyan-400', sub: 'aktywny czas' },
                { l: 'Dostępność', v: availability + '%', c: availability > 90 ? 'text-green-400' : availability > 75 ? 'text-amber-400' : 'text-red-400' },
              ].map(k => (
                <div key={k.l} className="bg-navy-900 rounded-xl p-3 text-center">
                  <div className="text-xs text-navy-400 mb-1">{k.l}</div>
                  <div className={cn('text-lg font-bold font-mono', k.c)}>{k.v}</div>
                  {k.sub && <div className="text-xs text-navy-600">{k.sub}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Zdarzenia przestojowe */}
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">Zdarzenia przestojowe</div><div className="card-sub">Opcjonalnie</div></div>
              <button onClick={() => setDowntimes(p => [...p, { category: 'mechanical_failure', duration_min: 0, description: '' }])}
                className="btn-secondary text-xs py-1.5 px-3">+ Dodaj</button>
            </div>
            {downtimes.length === 0
              ? <div className="text-center py-4 text-navy-500 text-sm">Brak zdarzeń</div>
              : downtimes.map((d, i) => (
                <div key={i} className="bg-navy-900 rounded-xl p-3 mb-2">
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <select value={d.category}
                      onChange={e => setDowntimes(p => p.map((x,j) => j===i ? {...x, category: e.target.value as DowntimeCategory} : x))}
                      className="input text-sm col-span-2">
                      {Object.entries(DOWNTIME_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <input type="number" value={d.duration_min || ''}
                      onChange={e => setDowntimes(p => p.map((x,j) => j===i ? {...x, duration_min: parseInt(e.target.value)||0} : x))}
                      placeholder="min" className="input text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={d.description}
                      onChange={e => setDowntimes(p => p.map((x,j) => j===i ? {...x, description: e.target.value} : x))}
                      placeholder="Opis..." className="input text-sm flex-1" />
                    <button onClick={() => setDowntimes(p => p.filter((_,j) => j!==i))} className="text-red-400 px-2">✕</button>
                  </div>
                </div>
              ))
            }
          </div>

          {/* Notes */}
          <div className="card">
            <label className="label">Uwagi ogólne</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Opcjonalnie..." rows={2} className="input text-sm font-normal resize-none" />
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
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
            <div className="card-header">
              <div><div className="card-title">Raporty tej zmiany</div><div className="card-sub">{existingReports.length} godzin</div></div>
            </div>
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
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-white font-mono">+{r.good_count.toLocaleString('pl-PL')} szt</span>
                        {r.reject_count > 0 && <span className="text-red-400 text-xs">{rj}% odrz.</span>}
                      </div>
                      <div className="flex gap-2 mt-1 text-xs">
                        <span className="text-green-400">⏱ {r.runtime_min}min</span>
                        {(r as ReportExt).ready_min != null && (r as ReportExt).ready_min! > 0 && <span className="text-amber-400">⏸ {(r as ReportExt).ready_min}min</span>}
                        {(r as ReportExt).alarm_min != null && (r as ReportExt).alarm_min! > 0 && <span className="text-red-400">🔔 {(r as ReportExt).alarm_min}min</span>}
                      </div>
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
                  { l: 'Śr. efektywność', v: Math.round(existingReports.reduce((s,r)=>s+Number(r.efficiency_pct),0)/existingReports.length) + '%',
                    c: efficiencyColor(Math.round(existingReports.reduce((s,r)=>s+Number(r.efficiency_pct),0)/existingReports.length)) },
                  { l: 'Odrzut łącznie', v: existingReports.reduce((s,r)=>s+r.reject_count,0) + ' szt', c: 'text-red-400' },
                  { l: 'Czas pracy łącznie', v: existingReports.reduce((s,r)=>s+r.runtime_min,0) + ' min', c: 'text-green-400' },
                  { l: 'Czas alarmu łącznie', v: existingReports.reduce((s,r)=>s+((r as ReportExt).alarm_min??0),0) + ' min', c: 'text-red-400' },
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
