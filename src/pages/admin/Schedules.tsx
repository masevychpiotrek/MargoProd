import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Schedule } from '@/types/database'

const DAYS = ['Niedziela','Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota']
const SHIFTS = ['I','II','III']

export default function AdminSchedules() {
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [exceptions, setExceptions] = useState<{ id: string; exception_date: string; is_working_day: boolean; note: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [newException, setNewException] = useState({ date: '', is_working: false, note: '' })
  const [edits, setEdits] = useState<Partial<Schedule>>({})

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data: sData } = await supabase.from('schedules').select('*').limit(1).single()
    const { data: eData } = await supabase.from('schedule_exceptions').select('*').order('exception_date', { ascending: false })
    if (sData) setSchedule(sData as Schedule)
    if (eData) setExceptions(eData as never)
    setLoading(false)
  }

  const sch = { ...schedule, ...edits } as Schedule

  const toggleOffDay = (day: number) => {
    const current = sch.off_weekdays ?? []
    const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day]
    setEdits(e => ({ ...e, off_weekdays: next }))
  }

  const toggleShift = (shift: string) => {
    const current = (sch.active_shifts as string[]) ?? []
    const next = current.includes(shift) ? current.filter(s => s !== shift) : [...current, shift]
    setEdits(e => ({ ...e, active_shifts: next as never }))
  }

  const saveSchedule = async () => {
    if (!schedule) return
    setSaving(true)
    await supabase.from('schedules').update(edits).eq('id', schedule.id)
    setSaving(false)
    setMsg('Harmonogram zapisany')
    setEdits({})
    load()
    setTimeout(() => setMsg(''), 3000)
  }

  const addException = async () => {
    if (!newException.date || !schedule) return
    await supabase.from('schedule_exceptions').insert({
      schedule_id: schedule.id,
      exception_date: newException.date,
      is_working_day: newException.is_working,
      note: newException.note || null
    })
    setNewException({ date: '', is_working: false, note: '' })
    load()
  }

  const removeException = async (id: string) => {
    await supabase.from('schedule_exceptions').delete().eq('id', id)
    load()
  }

  if (loading) return <div className="text-navy-400 p-4">Ładowanie...</div>

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Harmonogram produkcji</h1>
        <p className="text-navy-400 mt-1">Godziny pracy, dni wolne, wyjątki</p>
      </div>

      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">{msg}</div>}

      {/* Main schedule */}
      <div className="card">
        <div className="card-header"><div className="card-title">Podstawowy harmonogram</div></div>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="label">Godzina rozpoczęcia pracy</label>
            <input type="time" value={edits.work_start ?? sch.work_start ?? '06:00'}
              onChange={e => setEdits(ed => ({ ...ed, work_start: e.target.value }))}
              className="input text-lg font-bold font-mono" />
          </div>
          <div>
            <label className="label">Godzina zakończenia pracy</label>
            <input type="time" value={edits.work_end ?? sch.work_end ?? '22:00'}
              onChange={e => setEdits(ed => ({ ...ed, work_end: e.target.value }))}
              className="input text-lg font-bold font-mono" />
          </div>
        </div>

        <div className="mb-5">
          <label className="label">Aktywne zmiany</label>
          <div className="flex gap-3">
            {SHIFTS.map(s => (
              <button key={s} onClick={() => toggleShift(s)}
                className={`px-5 py-2.5 rounded-xl border-2 font-bold transition-all ${
                  (sch.active_shifts as string[] ?? []).includes(s)
                    ? 'border-brand bg-brand/10 text-white'
                    : 'border-navy-600 bg-navy-900 text-navy-400'
                }`}>
                Zmiana {s}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <label className="label">Wolne dni tygodnia</label>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <button key={i} onClick={() => toggleOffDay(i)}
                className={`px-4 py-2 rounded-xl border-2 text-sm font-medium transition-all ${
                  (sch.off_weekdays ?? []).includes(i)
                    ? 'border-red-500/50 bg-red-500/10 text-red-400'
                    : 'border-navy-600 bg-navy-900 text-navy-300'
                }`}>
                {d}
              </button>
            ))}
          </div>
          <p className="text-xs text-navy-500 mt-2">Zaznaczone dni = brak alertów i raportów wymaganych</p>
        </div>

        {Object.keys(edits).length > 0 && (
          <button onClick={saveSchedule} disabled={saving} className="btn-primary px-6 py-2.5">
            {saving ? 'Zapisywanie...' : '💾 Zapisz harmonogram'}
          </button>
        )}
      </div>

      {/* Exceptions */}
      <div className="card">
        <div className="card-header">
          <div><div className="card-title">Wyjątki i dni wolne</div><div className="card-sub">Święta, przestoje, specjalne dni robocze</div></div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className="label">Data</label>
            <input type="date" value={newException.date}
              onChange={e => setNewException(n => ({ ...n, date: e.target.value }))}
              className="input" />
          </div>
          <div>
            <label className="label">Typ</label>
            <select value={newException.is_working ? '1' : '0'}
              onChange={e => setNewException(n => ({ ...n, is_working: e.target.value === '1' }))}
              className="input">
              <option value="0">Dzień wolny (brak produkcji)</option>
              <option value="1">Dodatkowy dzień roboczy</option>
            </select>
          </div>
          <div>
            <label className="label">Notatka</label>
            <div className="flex gap-2">
              <input value={newException.note}
                onChange={e => setNewException(n => ({ ...n, note: e.target.value }))}
                placeholder="Np. Boże Narodzenie..."
                className="input flex-1" />
              <button onClick={addException} disabled={!newException.date} className="btn-primary px-4 py-2">+</button>
            </div>
          </div>
        </div>

        {exceptions.length === 0
          ? <div className="text-center py-6 text-navy-500 text-sm">Brak wyjątków — system używa standardowego harmonogramu</div>
          : (
            <div className="space-y-2">
              {exceptions.map(ex => (
                <div key={ex.id} className="flex items-center justify-between bg-navy-900 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-white">{ex.exception_date}</span>
                    <span className={ex.is_working_day ? 'status-ok text-xs' : 'status-alarm text-xs'}>
                      {ex.is_working_day ? '✓ Dzień roboczy' : '✕ Dzień wolny'}
                    </span>
                    {ex.note && <span className="text-xs text-navy-400">{ex.note}</span>}
                  </div>
                  <button onClick={() => removeException(ex.id)} className="btn-danger text-xs py-1 px-3">Usuń</button>
                </div>
              ))}
            </div>
          )
        }
      </div>
    </div>
  )
}
