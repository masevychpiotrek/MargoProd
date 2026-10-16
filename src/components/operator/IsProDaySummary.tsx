import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { HourlyReport, Shift } from '@/types/database'
import IsProProduction from './IsProProduction'

export default function IsProDaySummary({ date }: { date: string }) {
  const [shifts, setShifts] = useState<Shift[]>([])
  const [reports, setReports] = useState<HourlyReport[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [s, r] = await Promise.all([
        supabase.from('shifts').select('*, machine:machines(*)').eq('shift_date', date).order('started_at'),
        supabase.from('hourly_reports').select('*').eq('report_date', date).is('deleted_at', null)
      ])
      if (cancelled) return
      if (s.error || r.error) { setError('Nie udało się wczytać podsumowania asortymentów.'); return }
      setError(''); setShifts((s.data ?? []) as Shift[]); setReports((r.data ?? []) as HourlyReport[])
    }
    void load()
    const timer = window.setInterval(load, 30000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [date])
  return <details className="card p-4 my-4">
    <summary className="cursor-pointer text-white font-bold">Asortymenty i czas przezbrojeń — porównanie zmian</summary>
    {error && <p role="alert" className="text-amber-300 mt-3">{error}</p>}
    <div className="mt-4 grid gap-4 lg:grid-cols-2">{shifts.map(s => <div key={s.id}>
      <h3 className="text-white font-bold mb-2">{s.machine?.name} · zmiana {s.shift_type}</h3>
      <IsProProduction shift={s} reports={reports.filter(r => r.shift_id === s.id)} readOnly />
    </div>)}</div>
  </details>
}
