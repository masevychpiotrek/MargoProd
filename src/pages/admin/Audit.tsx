import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { AuditLog } from '@/types/database'

type AuditRow = AuditLog & { profile?: { full_name: string } | null }

const ACTION_LABELS: Record<string, { label: string, color: string }> = {
  login:          { label: 'Logowanie',      color: 'text-green-400' },
  logout:         { label: 'Wylogowanie',    color: 'text-navy-400' },
  report_create:  { label: 'Nowy raport',    color: 'text-brand' },
  report_update:  { label: 'Edycja raportu', color: 'text-amber-400' },
  report_delete:  { label: 'Usuniecie raportu', color: 'text-red-400' },
  user_create:    { label: 'Nowy uzytkownik', color: 'text-cyan-400' },
  user_update:    { label: 'Edycja uzytkownika', color: 'text-amber-400' },
  user_delete:    { label: 'Usuniecie uzytkownika', color: 'text-red-400' },
  password_change:{ label: 'Zmiana hasla',   color: 'text-purple-400' },
  shift_start:    { label: 'Start zmiany',   color: 'text-green-400' },
  shift_end:      { label: 'Koniec zmiany',  color: 'text-navy-400' },
  config_change:  { label: 'Zmiana konfiguracji', color: 'text-amber-400' },
}

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function why(row: AuditRow) {
  const next = asObj(row.new_values)
  const prev = asObj(row.old_values)
  const direct = next.reason ?? next.downtime_reason ?? next.note ?? next.notes ?? next.scope
  if (typeof direct === 'string' && direct.trim()) return direct
  if (row.table_name === 'reset') return 'reset danych testowych'
  if (row.action === 'login') return 'wejscie do aplikacji'
  if (row.action === 'logout') return 'zakonczenie sesji'
  if (row.action === 'password_change') return 'zmiana zabezpieczen konta'
  const changed = Object.keys(next).filter(k => next[k] !== prev[k])
  if (changed.length) return `zmienione: ${changed.slice(0, 6).join(', ')}`
  return 'brak opisu'
}

function details(row: AuditRow) {
  const next = asObj(row.new_values)
  const pairs = Object.entries(next)
    .filter(([, v]) => typeof v !== 'object')
    .slice(0, 5)
    .map(([k, v]) => `${k}: ${String(v)}`)
  if (pairs.length) return pairs.join(' · ')
  return row.record_id ? row.record_id.slice(0, 8) + '...' : '-'
}

export default function AdminAudit() {
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'today' | 'week' | 'all'>('today')
  const [live, setLive] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => { loadLogs() }, [filter])

  useEffect(() => {
    channel.current?.unsubscribe()
    if (!live) return
    channel.current = supabase.channel('admin-audit-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, loadLogs)
      .subscribe()
    return () => { channel.current?.unsubscribe() }
  }, [live, filter])

  const loadLogs = async () => {
    setLoading(true)
    let q = supabase.from('audit_logs')
      .select('*, profile:profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(300)

    const today = new Date().toISOString().split('T')[0]
    if (filter === 'today') q = q.gte('created_at', today + 'T00:00:00Z')
    else if (filter === 'week') {
      const w = new Date(); w.setDate(w.getDate() - 7)
      q = q.gte('created_at', w.toISOString())
    }

    const { data } = await q
    if (data) setLogs(data as AuditRow[])
    setLoading(false)
  }

  const filtered = logs.filter(l => {
    const haystack = `${l.profile?.full_name ?? ''} ${l.action} ${l.table_name ?? ''} ${why(l)} ${details(l)}`.toLowerCase()
    return haystack.includes(search.toLowerCase())
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Audit live</h1>
          <p className="mt-1 text-navy-400">Kto, co zrobil, kiedy i po co</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['today', 'week', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn('btn text-xs py-1.5 px-3', filter === f ? 'btn-primary' : 'btn-secondary')}>
              {f === 'today' ? 'Dzis' : f === 'week' ? '7 dni' : 'Wszystkie'}
            </button>
          ))}
          <button onClick={() => setLive(v => !v)}
            className={cn('btn text-xs py-1.5 px-3', live ? 'btn-primary' : 'btn-secondary')}>
            {live ? 'Live wlaczone' : 'Live pauza'}
          </button>
        </div>
      </div>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Szukaj osoby, akcji, tabeli lub powodu..."
        className="input max-w-xl"
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto max-h-[72vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr className="border-b border-navy-700 bg-navy-800">
                {['Czas','Kto','Co','Gdzie','Po co','Szczegoly'].map(h => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-navy-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? <tr><td colSpan={6} className="py-8 text-center text-navy-500">Ladowanie...</td></tr>
                : filtered.length === 0
                  ? <tr><td colSpan={6} className="py-8 text-center text-navy-500">Brak zdarzen</td></tr>
                  : filtered.map(l => {
                      const a = ACTION_LABELS[l.action] ?? { label: l.action, color: 'text-navy-300' }
                      return (
                        <tr key={l.id} className="border-b border-navy-800 hover:bg-navy-800/40">
                          <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-navy-400">
                            {new Date(l.created_at).toLocaleString('pl-PL', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td className="px-4 py-2 text-white">{l.profile?.full_name ?? 'System'}</td>
                          <td className="px-4 py-2"><span className={cn('text-xs font-bold', a.color)}>{a.label}</span></td>
                          <td className="px-4 py-2 font-mono text-xs text-navy-400">{l.table_name ?? '-'}</td>
                          <td className="max-w-[260px] px-4 py-2 text-xs text-navy-200">{why(l)}</td>
                          <td className="max-w-[360px] truncate px-4 py-2 text-xs text-navy-500">{details(l)}</td>
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
