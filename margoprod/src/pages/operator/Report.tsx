import { useState, useEffect, useCallback } from 'react'
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

export default function OperatorReport() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const { activeShift, activeMachine } = useShiftStore()
  const hourBlock = useCurrentHourBlock()
  const { display: countdown, isUrgent } = useHourCountdown()
  const { hour, dateISO } = useClock()

  const [goodCount, setGoodCount] = useState('')
  const [rejectCount, setRejectCount] = useState('')
  const [totalCount, setTotalCount] = useState('')
  const [runtimeMin, setRuntimeMin] = useState('')
  const [downtimeMin, setDowntimeMin] = useState('')
  const [microMin, setMicroMin] = useState('')
  const [changeoverMin, setChangeoverMin] = useState('')
  const [failureMin, setFailureMin] = useState('')
  const [downtimeReason, setDowntimeReason] = useState('')
  const [notes, setNotes] = useState('')
  const [downtimes, setDowntimes] = useState<DowntimeEntry[]>([])
  const [existingReports, setExistingReports] = useState<HourlyReport[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [selectedHour, setSelectedHour] = useState(hour)

  const good = parseInt(goodCount) || 0
  const reject = parseInt(rejectCount) || 0
  const runtime = parseInt(runtimeMin) || 0
  const downtime = parseInt(downtimeMin) || 0
  const micro = parseInt(microMin) || 0
  const changeover = parseInt(changeoverMin) || 0
  const failure = parseInt(failureMin) || 0
  const timeSum = runtime + downtime + micro + changeover + failure
  const efficiency = good > 0 ? Math.round(good / TARGET * 100) : 0
  const rejectPct = (good + reject) > 0 ? Math.round(reject / (good + reject) * 100) : 0
  const belowTarget = good < TARGET && good > 0

  useEffect(() => {
    if (!activeShift) { navigate('/operator/shift'); return }
    loadReports()
  }, [activeShift])

  const loadReports = async () => {
    if (!activeShift) return
    const { data } = await supabase
      .from('hourly_reports')
      .select('*')
      .eq('shift_id', activeShift.id)
      .is('deleted_at', null)
      .order('hour_start')
    if (data) setExistingReports(data as HourlyReport[])
  }

  const addDowntime = () => {
    setDowntimes(prev => [...prev, { category: 'mechanical_failure', duration_min: 0, description: '' }])
  }
  const removeDowntime = (i: number) => setDowntimes(prev => prev.filter((_, idx) => idx !== i))
  const updateDowntime = (i: number, field: keyof DowntimeEntry, value: string | number) => {
    setDowntimes(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: value } : d))
  }

  const validate = (): string[] => {
    const errs: string[] = []
    if (!goodCount) errs.push('Wpisz przyrost dobrych sztuk')
    if (timeSum !== 60) errs.push(`Suma czasów wynosi ${timeSum} min — musi wynosić dokładnie 60 min`)
    if (belowTarget && !downtimeReason.trim()) errs.push(`Wynik poniżej targetu (${TARGET} szt) — wymagane wpisanie przyczyny`)
    if (existingReports.find(r => r.hour_start === selectedHour)) errs.push(`Raport za godzinę ${formatHourBlock(selectedHour)} już istnieje`)
    return errs
  }

  const handleSave = async () => {
    const errs = validate()
    if (errs.length) { setErrors(errs); return }
    if (!activeShift || !profile) return

    setSaving(true)
    setErrors([])
    try {
      const { data: report, error } = await supabase
        .from('hourly_reports')
        .insert({
          shift_id: activeShift.id,
          machine_id: activeShift.machine_id,
          operator_id: profile.id,
          hour_block: formatHourBlock(selectedHour),
          report_date: dateISO,
          hour_start: selectedHour,
          good_count: good,
          reject_count: reject,
          total_count: parseInt(totalCount) || null,
          target: activeMachine?.target_per_hour ?? TARGET,
          runtime_min: runtime,
          downtime_min: downtime,
          micro_stoppage_min: micro,
          changeover_min: changeover,
          failure_min: failure,
          downtime_reason: downtimeReason || null,
          notes: notes || null,
          status: 'submitted'
        })
        .select()
        .single()

      if (error) { setErrors([error.message]); return }

      // Save downtime events
      if (downtimes.length && report) {
        await supabase.from('downtime_events').insert(
          downtimes.map(d => ({
            report_id: report.id,
            shift_id: activeShift.id,
            machine_id: activeShift.machine_id,
            category: d.category,
            duration_min: d.duration_min,
            description: d.description || null
          }))
        )
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      // Reset form
      setGoodCount(''); setRejectCount(''); setTotalCount('')
      setRuntimeMin(''); setDowntimeMin(''); setMicroMin('')
      setChangeoverMin(''); setFailureMin('')
      setDowntimeReason(''); setNotes(''); setDowntimes([])
      loadReports()
    } finally {
      setSaving(false)
    }
  }

  if (!activeShift) return null

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Wpisz wynik godziny</h1>
          <p className="text-navy-400 mt-1">{activeMachine?.name} · Zmiana {activeShift.shift_type}</p>
        </div>
        <div className="text-right">
          <div className={cn('text-3xl font-bold font-mono', isUrgent ? 'text-red-400' : 'text-white')}>
            {countdown}
          </div>
          <div className="text-xs text-navy-400 mt-0.5">do końca godziny</div>
          {isUrgent && <div className="text-xs text-red-400 font-bold mt-0.5 animate-pulse">⚠ CZAS NA WPIS!</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* MAIN FORM */}
        <div className="lg:col-span-2 space-y-4">

          {/* Hour selector */}
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">Blok godziny</div><div className="card-sub">Wybierz godzinę której dotyczy raport</div></div>
            </div>
            <select
              value={selectedHour}
              onChange={e => setSelectedHour(parseInt(e.target.value))}
              className="input text-lg font-bold"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{formatHourBlock(h)}</option>
              ))}
            </select>
          </div>

          {/* Production counts */}
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">Produkcja</div><div className="card-sub">Wyniki za tę godzinę</div></div>
              {good > 0 && (
                <div className={cn('text-2xl font-bold font-mono', efficiencyColor(efficiency))}>
                  {efficiency}%
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="label">Przyrost dobrych</label>
                <input type="number" value={goodCount} onChange={e => setGoodCount(e.target.value)}
                  placeholder="0" min="0"
                  className={cn('input input-lg', belowTarget && goodCount ? 'border-red-500/50 focus:border-red-500' : '')} />
                {good > 0 && (
                  <div className="mt-1.5">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-navy-400">vs target {TARGET}</span>
                      <span className={efficiencyColor(efficiency)}>{efficiency}%</span>
                    </div>
                    <div className="h-1.5 bg-navy-900 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', efficiencyBg(efficiency))}
                        style={{ width: `${Math.min(efficiency, 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="label">Odrzut</label>
                <input type="number" value={rejectCount} onChange={e => setRejectCount(e.target.value)}
                  placeholder="0" min="0" className="input input-lg" />
                {rejectPct > 0 && (
                  <div className={cn('text-xs mt-1', rejectPct > 10 ? 'text-red-400' : rejectPct > 5 ? 'text-amber-400' : 'text-green-400')}>
                    % odrzutu: {rejectPct}%
                  </div>
                )}
              </div>
              <div>
                <label className="label">Wyroby łącznie</label>
                <input type="number" value={totalCount} onChange={e => setTotalCount(e.target.value)}
                  placeholder="0" min="0" className="input input-lg" />
                <div className="text-xs text-navy-500 mt-1">licznik kumulatywny</div>
              </div>
            </div>

            {/* Below target warning */}
            {belowTarget && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-3">
                <div className="text-red-400 font-bold text-sm mb-2">
                  ⚠ Wynik poniżej targetu ({TARGET} szt) — wymagane wpisanie przyczyny
                </div>
                <textarea
                  value={downtimeReason}
                  onChange={e => setDowntimeReason(e.target.value)}
                  placeholder="Opisz przyczynę niewykonania planu..."
                  rows={2}
                  className="input text-sm font-normal resize-none"
                />
              </div>
            )}
          </div>

          {/* Time breakdown - must sum to 60 */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Czasy pracy</div>
                <div className="card-sub">Suma musi wynosić dokładnie 60 minut</div>
              </div>
              <div className={cn('font-bold font-mono text-lg', timeSum === 60 ? 'text-green-400' : timeSum > 60 ? 'text-red-400' : 'text-amber-400')}>
                {timeSum} / 60 min
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-2 bg-navy-900 rounded-full overflow-hidden mb-4">
              <div className={cn('h-full rounded-full transition-all', timeSum === 60 ? 'bg-green-500' : timeSum > 60 ? 'bg-red-500' : 'bg-amber-500')}
                style={{ width: `${Math.min(timeSum / 60 * 100, 100)}%` }} />
            </div>

            <div className="grid grid-cols-5 gap-2">
              {[
                { label: 'Czas pracy', value: runtimeMin, set: setRuntimeMin, color: 'text-green-400' },
                { label: 'Postój', value: downtimeMin, set: setDowntimeMin, color: 'text-red-400' },
                { label: 'Mikroprzestoje', value: microMin, set: setMicroMin, color: 'text-amber-400' },
                { label: 'Przezbrojenie', value: changeoverMin, set: setChangeoverMin, color: 'text-blue-400' },
                { label: 'Awaria', value: failureMin, set: setFailureMin, color: 'text-purple-400' },
              ].map(({ label, value, set, color }) => (
                <div key={label}>
                  <label className={cn('label text-center block', color)}>{label}</label>
                  <input type="number" value={value} onChange={e => set(e.target.value)}
                    placeholder="0" min="0" max="60"
                    className="input text-center text-lg font-bold font-mono px-2" />
                </div>
              ))}
            </div>

            {timeSum === 60 && (
              <div className="mt-3 flex items-center gap-2 text-green-400 text-sm">
                <span>✓</span> Suma czasów poprawna
              </div>
            )}
          </div>

          {/* Downtime events */}
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">Zdarzenia przestojowe</div><div className="card-sub">Opcjonalnie — szczegóły przestojów</div></div>
              <button onClick={addDowntime} className="btn-secondary text-xs py-1.5 px-3">+ Dodaj</button>
            </div>
            {downtimes.length === 0 && (
              <div className="text-center py-6 text-navy-500 text-sm">Brak zdarzeń — kliknij "+ Dodaj" aby dodać przestój</div>
            )}
            {downtimes.map((d, i) => (
              <div key={i} className="bg-navy-900 rounded-xl p-3 mb-2">
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <select value={d.category} onChange={e => updateDowntime(i, 'category', e.target.value)} className="input text-sm col-span-2">
                    {Object.entries(DOWNTIME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input type="number" value={d.duration_min || ''} onChange={e => updateDowntime(i, 'duration_min', parseInt(e.target.value) || 0)}
                    placeholder="min" min="1" className="input text-sm" />
                </div>
                <div className="flex gap-2">
                  <input type="text" value={d.description} onChange={e => updateDowntime(i, 'description', e.target.value)}
                    placeholder="Opis (opcjonalnie)..." className="input text-sm flex-1" />
                  <button onClick={() => removeDowntime(i)} className="text-red-400 hover:text-red-300 px-2">✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="card">
            <label className="label">Uwagi ogólne</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Dodatkowe uwagi do tej godziny (opcjonalnie)..."
              rows={2} className="input text-sm font-normal resize-none" />
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <div className="font-bold text-red-400 mb-2 text-sm">Popraw błędy przed zapisaniem:</div>
              {errors.map((e, i) => <div key={i} className="text-red-300 text-sm">• {e}</div>)}
            </div>
          )}

          {/* Save button */}
          <button onClick={handleSave} disabled={saving}
            className={cn('btn w-full py-4 text-base font-bold',
              saved ? 'bg-green-500 text-white' : 'btn-primary'
            )}>
            {saving ? 'Zapisywanie...' : saved ? '✓ Zapisano!' : '💾 Zapisz raport godzinowy'}
          </button>
        </div>

        {/* SIDEBAR - today's reports */}
        <div className="space-y-4">
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">Dzisiaj</div><div className="card-sub">{existingReports.length} raportów</div></div>
            </div>
            {existingReports.length === 0 ? (
              <div className="text-center py-4 text-navy-500 text-sm">Brak raportów — zacznij wpisywać!</div>
            ) : (
              <div className="space-y-2">
                {existingReports.map(r => {
                  const eff = Math.round(r.good_count / TARGET * 100)
                  return (
                    <div key={r.id} className="bg-navy-900 rounded-xl p-3">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-mono text-xs text-navy-400">{r.hour_block}</span>
                        <span className={cn('font-bold text-sm', efficiencyColor(eff))}>{eff}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold text-white">{r.good_count.toLocaleString('pl-PL')} szt</span>
                        {r.reject_count > 0 && <span className="text-red-400 text-xs">odrzut: {r.reject_count}</span>}
                      </div>
                      <div className="h-1 bg-navy-700 rounded mt-2 overflow-hidden">
                        <div className={cn('h-full rounded', efficiencyBg(eff))} style={{ width: `${Math.min(eff, 100)}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Quick stats */}
          {existingReports.length > 0 && (
            <div className="card">
              <div className="card-title mb-3">Podsumowanie zmiany</div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-navy-400 text-sm">Produkcja łącznie</span>
                  <span className="font-bold text-white font-mono">
                    {existingReports.reduce((s, r) => s + r.good_count, 0).toLocaleString('pl-PL')} szt
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-navy-400 text-sm">Śr. efektywność</span>
                  <span className={cn('font-bold font-mono', efficiencyColor(
                    Math.round(existingReports.reduce((s, r) => s + Number(r.efficiency_pct), 0) / existingReports.length)
                  ))}>
                    {Math.round(existingReports.reduce((s, r) => s + Number(r.efficiency_pct), 0) / existingReports.length)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-navy-400 text-sm">Odrzut łącznie</span>
                  <span className="font-bold text-red-400 font-mono">
                    {existingReports.reduce((s, r) => s + r.reject_count, 0)} szt
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
