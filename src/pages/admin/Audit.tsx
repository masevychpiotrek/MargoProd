import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { AuditLog } from '@/types/database'

const ACTION_LABELS: Record<string, { label: string, color: string }> = {
  login:          { label: 'Logowanie',      color: 'text-green-400' },
  logout:         { label: 'Wylogowanie',    color: 'text-navy-400' },
  report_create:  { label: 'Nowy raport',    color: 'text-brand' },
  report_update:  { label: 'Edycja raportu', color: 'text-amber-400' },
  report_delete:  { label: 'Usunięcie raportu', color: 'text-red-400' },
  user_create:    { label: 'Nowy użytkownik', color: 'text-cyan-400' },
  user_update:    { label: 'Edycja użytkownika', color: 'text-amber-400' },
  user_delete:    { label: 'Usunięcie użytkownika', color: 'text-red-400' },
  password_change:{ label: 'Zmiana hasła',   color: 'text-purple-400' },
  shift_start:    { label: 'Start zmiany',   color: 'text-green-400' },
  shift_end:      { label: 'Koniec zmiany',  color: 'text-navy-400' },
  config_change:  { label: 'Zmiana konfiguracji', color: 'text-amber-400' },
}

export default function AdminAudit() {
  const [logs, setLogs] = useState<(AuditLog & { profile?: { full_name: string } })[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'today' | 'week' | 'all'>('today')

  useEffect(() => { loadLogs() }, [filter])

  const loadLogs = async () => {
    setLoading(true)
    let q = supabase.from('audit_logs')
      .select('*, profile:profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(200)

    const today = new Date().toISOString().split('T')[0]
    if (filter === 'today') q = q.gte('created_at', today + 'T00:00:00Z')
    else if (filter === 'week') {
      const w = new Date(); w.setDate(w.getDate() - 7)
      q = q.gte('created_at', w.toISOString())
    }

    const { data } = await q
    if (data) setLogs(data as never)
    setLoading(false)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Audit Log</h1>
          <p className="text-navy-400 mt-1">Historia wszystkich zdarzeń systemowych</p>
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

      <div className="card overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr className="border-b border-navy-700 bg-navy-800">
                {['Czas','Użytkownik','Akcja','Tabela','Szczegóły'].map(h => (
                  <th key={h} className="text-left py-2.5 px-4 text-xs font-bold text-navy-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? <tr><td colSpan={5} className="text-center py-8 text-navy-500">Ładowanie...</td></tr>
                : logs.length === 0
                  ? <tr><td colSpan={5} className="text-center py-8 text-navy-500">Brak zdarzeń</td></tr>
                  : logs.map(l => {
                      const a = ACTION_LABELS[l.action] ?? { label: l.action, color: 'text-navy-300' }
                      return (
                        <tr key={l.id} className="border-b border-navy-800 hover:bg-navy-800/40">
                          <td className="py-2 px-4 font-mono text-xs text-navy-400 whitespace-nowrap">
                            {new Date(l.created_at).toLocaleString('pl-PL', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td className="py-2 px-4 text-sm text-white">
                            {(l as never as { profile?: { full_name: string } }).profile?.full_name ?? '—'}
                          </td>
                          <td className="py-2 px-4">
                            <span className={cn('font-bold text-xs', a.color)}>{a.label}</span>
                          </td>
                          <td className="py-2 px-4 text-xs text-navy-400 font-mono">{l.table_name ?? '—'}</td>
                          <td className="py-2 px-4 text-xs text-navy-500 max-w-xs truncate">
                            {l.record_id ? l.record_id.slice(0, 8) + '...' : '—'}
                          </td>
                        </tr>
                      )
                    })
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
