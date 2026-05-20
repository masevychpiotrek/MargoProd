import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { efficiencyColor, cn } from '@/lib/utils'
import type { HourlyReport } from '@/types/database'

const TARGET = 2100

export default function OperatorHistory() {
  const { profile } = useAuthStore()
  const [reports, setReports] = useState<HourlyReport[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'today' | 'week' | 'all'>('today')

  useEffect(() => { loadReports() }, [filter])

  const loadReports = async () => {
    if (!profile) return
    setLoading(true)
    let q = supabase.from('hourly_reports').select('*, machine:machines(name)')
      .eq('operator_id', profile.id).is('deleted_at', null).order('report_date', { ascending: false }).order('hour_start', { ascending: false })
    const today = new Date().toISOString().split('T')[0]
    if (filter === 'today') q = q.eq('report_date', today)
    else if (filter === 'week') {
      const w = new Date(); w.setDate(w.getDate() - 7)
      q = q.gte('report_date', w.toISOString().split('T')[0])
    }
    const { data } = await q.limit(200)
    if (data) setReports(data as HourlyReport[])
    setLoading(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Historia raportów</h1>
          <p className="text-navy-400 mt-1">Twoje wpisy godzinowe</p>
        </div>
        <div className="flex gap-2">
          {(['today', 'week', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn('btn text-xs py-1.5 px-3', filter === f ? 'btn-primary' : 'btn-secondary')}>
              {f === 'today' ? 'Dziś' : f === 'week' ? '7 dni' : 'Wszystkie'}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="text-center py-8 text-navy-400">Ładowanie...</div>
        ) : reports.length === 0 ? (
          <div className="text-center py-8 text-navy-500">Brak raportów w wybranym okresie</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700">
                  {['Data', 'Godzina', 'Maszyna', 'Przyrost', 'Odrzut', 'Efektywność', 'Czas pracy', 'Uwagi'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reports.map(r => {
                  const eff = Number(r.efficiency_pct)
                  return (
                    <tr key={r.id} className="border-b border-navy-800 hover:bg-navy-800/50">
                      <td className="py-2.5 px-3 font-mono text-xs text-navy-400">{r.report_date}</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-white">{r.hour_block}</td>
                      <td className="py-2.5 px-3 text-navy-300">{(r as unknown as { machine?: { name: string } }).machine?.name ?? '—'}</td>
                      <td className="py-2.5 px-3 font-bold font-mono text-white">{r.good_count.toLocaleString('pl-PL')}</td>
                      <td className="py-2.5 px-3 font-mono text-red-400">{r.reject_count || '—'}</td>
                      <td className="py-2.5 px-3">
                        <span className={cn('font-bold font-mono', efficiencyColor(eff))}>{eff}%</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-navy-400">{r.runtime_min} min</td>
                      <td className="py-2.5 px-3 text-xs text-navy-500 max-w-xs truncate">{r.notes || r.downtime_reason || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
