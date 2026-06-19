import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { AuditLog } from '@/types/database'
import { usePresenceList, type PresenceUser } from '@/hooks/usePresence'

type AuditRow = AuditLog & { profile?: { full_name: string; role?: string } | null }

const ACTION_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  login:                    { label: 'Logowanie',              color: 'text-green-400',  icon: '→' },
  logout:                   { label: 'Wylogowanie',            color: 'text-navy-400',   icon: '←' },
  report_create:            { label: 'Nowy raport',            color: 'text-brand',      icon: '+' },
  report_update:            { label: 'Edycja raportu',         color: 'text-amber-400',  icon: '✎' },
  report_delete:            { label: 'Usunięcie raportu',      color: 'text-red-400',    icon: '✕' },
  user_create:              { label: 'Nowy użytkownik',        color: 'text-cyan-400',   icon: '+' },
  user_update:              { label: 'Edycja użytkownika',     color: 'text-amber-400',  icon: '✎' },
  user_delete:              { label: 'Usunięcie użytkownika',  color: 'text-red-400',    icon: '✕' },
  password_change:          { label: 'Zmiana hasła',           color: 'text-purple-400', icon: '🔑' },
  shift_start:              { label: 'Start zmiany',           color: 'text-green-400',  icon: '▶' },
  shift_end:                { label: 'Koniec zmiany',          color: 'text-navy-400',   icon: '■' },
  config_change:            { label: 'Zmiana konfiguracji',    color: 'text-amber-400',  icon: '⚙' },
  failure_report_create:    { label: 'Zgłoszenie awarii',      color: 'text-red-400',    icon: '!' },
  failure_report_update:    { label: 'Aktualizacja awarii',    color: 'text-amber-400',  icon: '✎' },
  shift_manager_correction: { label: 'Korekta kierownika',     color: 'text-amber-400',  icon: '✎' },
  manager_report_update:    { label: 'Edycja przez kier.',     color: 'text-amber-400',  icon: '✎' },
  manager_report_delete:    { label: 'Usun. przez kier.',      color: 'text-red-400',    icon: '✕' },
  manager_order_update:     { label: 'Aktualizacja zlecenia',  color: 'text-amber-400',  icon: '✎' },
  manager_order_report_update: { label: 'Edycja raportu zlec.', color: 'text-amber-400', icon: '✎' },
}

const ACTION_GROUPS: Record<string, string[]> = {
  auth:    ['login', 'logout'],
  reports: ['report_create', 'report_update', 'report_delete', 'manager_report_update', 'manager_report_delete', 'manager_order_report_update'],
  shifts:  ['shift_start', 'shift_end', 'shift_manager_correction'],
  users:   ['user_create', 'user_update', 'user_delete', 'password_change'],
  config:  ['config_change', 'manager_order_update'],
  failures: ['failure_report_create', 'failure_report_update'],
}

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function describeAction(row: AuditRow): string {
  const next = asObj(row.new_values)
  const prev = asObj(row.old_values)

  if (row.action === 'login') {
    const method = next.method ? ` (${next.method})` : ''
    return `Zalogowanie do systemu${method}`
  }
  if (row.action === 'logout') return 'Wylogowanie z systemu'
  if (row.action === 'password_change') return 'Zmiana hasła do konta'
  if (row.action === 'shift_start') {
    const machine = next.machine_id ? ` — maszyna: ${String(next.machine_id).slice(0, 8)}` : ''
    const st = next.shift_type ? `, zmiana ${next.shift_type}` : ''
    return `Rozpoczęcie zmiany${machine}${st}${next.reopened ? ' (wznowienie)' : ''}`
  }
  if (row.action === 'shift_end') {
    const good = next.summary_good_count != null ? `, produkcja: ${next.summary_good_count} szt` : ''
    const auto = next.auto_closed ? ' (auto-zamknięcie)' : ''
    return `Zakończenie zmiany${good}${auto}`
  }
  if (row.action === 'report_create') {
    const h = next.hour_start != null ? `, godz. ${next.hour_start}:00` : ''
    const g = next.good_count != null ? `, produkcja: ${next.good_count} szt` : ''
    return `Nowy raport godzinowy${h}${g}`
  }
  if (row.action === 'report_update') {
    const h = next.hour_start != null ? `, godz. ${next.hour_start}:00` : ''
    const changed = Object.keys(next).filter(k => next[k] !== prev[k]).slice(0, 4)
    return `Edycja raportu${h}${changed.length ? ` — zmienione: ${changed.join(', ')}` : ''}`
  }
  if (row.action === 'report_delete') return 'Usunięcie raportu godzinowego'
  if (row.action === 'user_create') return `Utworzono konto: ${next.full_name ?? ''} (${next.role ?? ''})`
  if (row.action === 'user_update') {
    const changed = Object.keys(next).filter(k => next[k] !== prev[k] && k !== 'full_name').slice(0, 4)
    return `Zmiana konta ${next.full_name ?? prev.full_name ?? ''}: ${changed.join(', ')}`
  }
  if (row.action === 'user_delete') return `Usunięto konto: ${prev.full_name ?? ''}`
  if (row.action === 'config_change') {
    const name = next.name ?? prev.name ?? ''
    const changed = Object.keys(next).filter(k => !['name', 'source'].includes(k)).slice(0, 4)
    return `Konfiguracja${name ? ` [${name}]` : ''}: ${changed.join(', ')}`
  }
  if (row.action === 'shift_manager_correction') {
    const changed = Object.keys(next).filter(k => next[k] !== prev[k]).slice(0, 4)
    return `Korekta kierownika — zmienione: ${changed.join(', ')}`
  }
  if (row.action === 'manager_report_update') {
    const changed = Object.keys(next).filter(k => next[k] !== prev[k]).slice(0, 4)
    return `Edycja raportu przez kierownika${changed.length ? ` — ${changed.join(', ')}` : ''}`
  }
  if (row.action === 'manager_report_delete') return 'Usunięcie raportu przez kierownika'
  if (row.action === 'failure_report_create') return `Zgłoszenie awarii: ${String(next.description ?? '').slice(0, 60)}`
  if (row.action === 'failure_report_update') return `Aktualizacja statusu awarii: ${next.status ?? ''}`

  const direct = next.reason ?? next.downtime_reason ?? next.note ?? next.notes
  if (typeof direct === 'string' && direct.trim()) return direct.slice(0, 100)
  const changed = Object.keys(next).filter(k => next[k] !== prev[k])
  return changed.length ? `Zmienione: ${changed.slice(0, 6).join(', ')}` : 'brak opisu'
}

function formatTs(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    relative: (() => {
      const diffMs = Date.now() - d.getTime()
      const diffMin = Math.floor(diffMs / 60000)
      if (diffMin < 1) return 'przed chwilą'
      if (diffMin < 60) return `${diffMin} min temu`
      const diffH = Math.floor(diffMin / 60)
      if (diffH < 24) return `${diffH}h temu`
      return `${Math.floor(diffH / 24)} dni temu`
    })()
  }
}

function exportCsv(rows: AuditRow[]) {
  const header = ['Czas', 'Użytkownik', 'Akcja', 'Tabela', 'Opis', 'IP', 'User-Agent']
  const lines = rows.map(r => [
    new Date(r.created_at).toLocaleString('pl-PL'),
    r.profile?.full_name ?? 'System',
    ACTION_LABELS[r.action]?.label ?? r.action,
    r.table_name ?? '',
    describeAction(r).replace(/,/g, ';'),
    r.ip_address ?? '',
    (r.user_agent ?? '').slice(0, 80).replace(/,/g, ';')
  ].map(v => `"${v}"`).join(','))
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url
  a.download = `audit_${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

const ROLE_COLORS: Record<string, string> = {
  admin:      'bg-purple-500/20 text-purple-300 border-purple-500/30',
  manager:    'bg-blue-500/20 text-blue-300 border-blue-500/30',
  executive:  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  operator:   'bg-green-500/20 text-green-300 border-green-500/30',
  specialist: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  viewer:     'bg-navy-700/50 text-navy-300 border-navy-600',
}
const ROLE_LABELS_PL: Record<string, string> = {
  admin: 'Admin', manager: 'Kierownik', executive: 'Zarząd',
  operator: 'Operator', specialist: 'Serwis', viewer: 'Gość'
}

function OnlinePanel() {
  const [users, setUsers] = useState<PresenceUser[]>([])
  const { subscribe } = usePresenceList()

  useEffect(() => subscribe(setUsers), [])

  return (
    <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm font-bold text-white">Aktywni teraz</span>
        </div>
        <span className="text-xs font-mono text-green-400 font-bold">{users.length} online</span>
      </div>
      {users.length === 0 ? (
        <p className="text-xs text-navy-500 italic">Brak aktywnych użytkowników</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {users.map(u => (
            <div key={u.user_id} className="flex items-center gap-3 rounded-xl bg-navy-900/70 border border-navy-700 px-3 py-2.5">
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-navy-700 flex items-center justify-center text-xs font-bold text-white">
                  {u.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-navy-900" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-white truncate">{u.full_name}</div>
                <div className="text-xs text-navy-400 truncate">{u.page}</div>
              </div>
              <span className={cn('text-xs font-bold rounded-full border px-2 py-0.5 whitespace-nowrap', ROLE_COLORS[u.role] ?? 'bg-navy-700 text-navy-300 border-navy-600')}>
                {ROLE_LABELS_PL[u.role] ?? u.role}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AdminAudit() {
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'today' | 'week' | 'month' | 'all'>('today')
  const [live, setLive] = useState(true)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [stats, setStats] = useState<{ logins: number; actions: number; users: number; lastLogin: string }>({ logins: 0, actions: 0, users: 0, lastLogin: '' })

  useEffect(() => { loadLogs() }, [filter])

  useEffect(() => {
    channel.current?.unsubscribe()
    if (!live) return
    channel.current = supabase.channel('admin-audit-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, () => loadLogs())
      .subscribe()
    return () => { channel.current?.unsubscribe() }
  }, [live, filter])

  const loadLogs = async () => {
    setLoading(true)
    let q = supabase.from('audit_logs')
      .select('*, profile:profiles(full_name, role)')
      .order('created_at', { ascending: false })
      .limit(500)

    const now = new Date()
    if (filter === 'today') {
      q = q.gte('created_at', now.toISOString().slice(0, 10) + 'T00:00:00Z')
    } else if (filter === 'week') {
      const w = new Date(now); w.setDate(w.getDate() - 7)
      q = q.gte('created_at', w.toISOString())
    } else if (filter === 'month') {
      const m = new Date(now); m.setDate(m.getDate() - 30)
      q = q.gte('created_at', m.toISOString())
    }

    const { data } = await q
    if (data) {
      const rows = data as AuditRow[]
      setLogs(rows)
      const uniqueUsers = new Set(rows.filter(r => r.user_id).map(r => r.user_id)).size
      const logins = rows.filter(r => r.action === 'login').length
      const lastLogin = rows.find(r => r.action === 'login')?.created_at ?? ''
      setStats({ logins, actions: rows.length, users: uniqueUsers, lastLogin })
    }
    setLoading(false)
  }

  const filtered = logs.filter(l => {
    if (groupFilter !== 'all') {
      const group = ACTION_GROUPS[groupFilter]
      if (!group?.includes(l.action)) return false
    }
    if (search) {
      const haystack = `${l.profile?.full_name ?? ''} ${l.action} ${l.table_name ?? ''} ${describeAction(l)}`.toLowerCase()
      if (!haystack.includes(search.toLowerCase())) return false
    }
    return true
  })

  const userActivity = logs.reduce<Record<string, { name: string; count: number; lastSeen: string }>>((acc, l) => {
    if (!l.user_id) return acc
    const name = l.profile?.full_name ?? l.user_id.slice(0, 8)
    if (!acc[l.user_id]) acc[l.user_id] = { name, count: 0, lastSeen: l.created_at }
    acc[l.user_id].count++
    if (l.created_at > acc[l.user_id].lastSeen) acc[l.user_id].lastSeen = l.created_at
    return acc
  }, {})
  const topUsers = Object.values(userActivity).sort((a, b) => b.count - a.count).slice(0, 6)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-brand">Panel bezpieczeństwa</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Audit Log — Pełna historia aktywności</h1>
          <p className="mt-1 text-navy-400 text-sm">Każde logowanie, wylogowanie, zmiana danych i akcja użytkownika</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => exportCsv(filtered)}
            className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
          >
            ↓ Eksport CSV
          </button>
          <button
            onClick={() => setLive(v => !v)}
            className={cn('btn text-xs py-1.5 px-3 flex items-center gap-1.5', live ? 'btn-primary' : 'btn-secondary')}
          >
            <span className={cn('inline-block w-1.5 h-1.5 rounded-full', live ? 'bg-green-400 animate-pulse' : 'bg-navy-500')} />
            {live ? 'Live' : 'Pauza'}
          </button>
        </div>
      </div>

      {/* Live presence */}
      <OnlinePanel />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Zdarzenia łącznie', value: stats.actions, color: 'text-brand' },
          { label: 'Logowania', value: stats.logins, color: 'text-green-400' },
          { label: 'Aktywni użytkownicy', value: stats.users, color: 'text-amber-300' },
          { label: 'Ostatnie logowanie', value: stats.lastLogin ? formatTs(stats.lastLogin).relative : '—', color: 'text-navy-300' },
        ].map(item => (
          <div key={item.label} className="kpi-card">
            <div className="kpi-label">{item.label}</div>
            <div className={cn('kpi-value text-xl', item.color)}>{loading ? '...' : item.value}</div>
          </div>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex flex-wrap gap-1.5">
          {([['today', 'Dziś'], ['week', '7 dni'], ['month', '30 dni'], ['all', 'Wszystko']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)}
              className={cn('btn text-xs py-1.5 px-3', filter === key ? 'btn-primary' : 'btn-secondary')}>
              {label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-navy-700 hidden xl:block" />
        <div className="flex flex-wrap gap-1.5">
          {[['all', 'Wszystkie'], ['auth', 'Auth'], ['reports', 'Raporty'], ['shifts', 'Zmiany'], ['users', 'Użytkownicy'], ['config', 'Konfiguracja'], ['failures', 'Awarie']].map(([key, label]) => (
            <button key={key} onClick={() => setGroupFilter(key)}
              className={cn('btn text-xs py-1.5 px-3', groupFilter === key ? 'btn-primary' : 'btn-secondary')}>
              {label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Szukaj osoby, akcji..."
          className="input ml-auto max-w-xs text-sm py-1.5"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        {/* Main log table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: '68vh' }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-navy-700 bg-navy-850">
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-navy-400 whitespace-nowrap">Czas</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-navy-400">Kto</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-navy-400">Akcja</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-navy-400">Opis</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-navy-400">Tabela</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? <tr><td colSpan={5} className="py-10 text-center text-navy-500">Ładowanie...</td></tr>
                  : filtered.length === 0
                    ? <tr><td colSpan={5} className="py-10 text-center text-navy-500">Brak zdarzeń</td></tr>
                    : filtered.map(l => {
                        const a = ACTION_LABELS[l.action] ?? { label: l.action, color: 'text-navy-300', icon: '·' }
                        const ts = formatTs(l.created_at)
                        const isExpanded = expanded === l.id
                        const hasDetails = l.new_values || l.old_values || l.ip_address
                        return (
                          <>
                            <tr
                              key={l.id}
                              onClick={() => hasDetails && setExpanded(isExpanded ? null : l.id)}
                              className={cn(
                                'border-b border-navy-800 transition-colors',
                                hasDetails && 'cursor-pointer hover:bg-navy-800/50',
                                isExpanded && 'bg-navy-800/60'
                              )}
                            >
                              <td className="px-4 py-2.5 whitespace-nowrap">
                                <div className="font-mono text-xs text-white">{ts.time}</div>
                                <div className="font-mono text-xs text-navy-500">{ts.date}</div>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="text-white font-medium">{l.profile?.full_name ?? 'System'}</div>
                                {l.profile?.role && <div className="text-xs text-navy-500 capitalize">{l.profile.role}</div>}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={cn('inline-flex items-center gap-1 text-xs font-bold rounded-full px-2 py-0.5', a.color.replace('text-', 'bg-').replace('400', '500/15'), a.color)}>
                                  <span>{a.icon}</span> {a.label}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 max-w-[400px]">
                                <span className="text-xs text-navy-200 leading-relaxed">{describeAction(l)}</span>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className="text-xs font-mono text-navy-500">{l.table_name ?? '—'}</span>
                                {hasDetails && <span className="ml-2 text-navy-600 text-xs">{isExpanded ? '▲' : '▼'}</span>}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${l.id}-detail`} className="bg-navy-900/80 border-b border-navy-800">
                                <td colSpan={5} className="px-6 py-4">
                                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 text-xs">
                                    {l.record_id && (
                                      <div>
                                        <div className="text-navy-500 uppercase tracking-wider font-bold mb-1">Record ID</div>
                                        <div className="font-mono text-navy-300">{l.record_id}</div>
                                      </div>
                                    )}
                                    {l.ip_address && (
                                      <div>
                                        <div className="text-navy-500 uppercase tracking-wider font-bold mb-1">IP</div>
                                        <div className="font-mono text-navy-300">{l.ip_address}</div>
                                      </div>
                                    )}
                                    {l.user_agent && (
                                      <div className="md:col-span-2 xl:col-span-1">
                                        <div className="text-navy-500 uppercase tracking-wider font-bold mb-1">Przeglądarka / Urządzenie</div>
                                        <div className="text-navy-400 break-words leading-relaxed">{l.user_agent.slice(0, 120)}</div>
                                      </div>
                                    )}
                                    {l.old_values && Object.keys(l.old_values).length > 0 && (
                                      <div>
                                        <div className="text-red-500/70 uppercase tracking-wider font-bold mb-1">Poprzednia wartość</div>
                                        <pre className="text-red-400/70 text-xs leading-relaxed whitespace-pre-wrap">{JSON.stringify(l.old_values, null, 2)}</pre>
                                      </div>
                                    )}
                                    {l.new_values && Object.keys(l.new_values).length > 0 && (
                                      <div>
                                        <div className="text-green-500/70 uppercase tracking-wider font-bold mb-1">Nowa wartość</div>
                                        <pre className="text-green-400/70 text-xs leading-relaxed whitespace-pre-wrap">{JSON.stringify(l.new_values, null, 2)}</pre>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })
                }
              </tbody>
            </table>
          </div>
          {!loading && (
            <div className="border-t border-navy-800 px-4 py-2 text-xs text-navy-500 flex items-center justify-between">
              <span>Pokazano {filtered.length} z {logs.length} zdarzeń</span>
              {logs.length >= 500 && <span className="text-amber-400">Limit 500 — zawęź zakres dat</span>}
            </div>
          )}
        </div>

        {/* Sidebar: user activity */}
        <div className="space-y-4">
          <div className="card">
            <div className="card-title mb-3">Aktywność użytkowników</div>
            <div className="space-y-2">
              {topUsers.length === 0 && <div className="text-xs text-navy-500">Brak danych</div>}
              {topUsers.map(u => (
                <div key={u.name} className="flex items-center justify-between gap-2 rounded-xl bg-navy-900 px-3 py-2.5">
                  <div>
                    <div className="text-sm font-medium text-white">{u.name}</div>
                    <div className="text-xs text-navy-500">{formatTs(u.lastSeen).relative}</div>
                  </div>
                  <div className="text-brand font-mono font-bold text-sm">{u.count}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Action breakdown */}
          <div className="card">
            <div className="card-title mb-3">Rozkład akcji</div>
            <div className="space-y-2">
              {Object.entries(ACTION_GROUPS).map(([group, actions]) => {
                const count = logs.filter(l => actions.includes(l.action)).length
                if (!count) return null
                const labels: Record<string, string> = { auth: 'Auth', reports: 'Raporty', shifts: 'Zmiany', users: 'Użytkownicy', config: 'Konfiguracja', failures: 'Awarie' }
                const maxCount = Math.max(...Object.entries(ACTION_GROUPS).map(([, a]) => logs.filter(l => a.includes(l.action)).length))
                return (
                  <div key={group}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-navy-300">{labels[group]}</span>
                      <span className="font-mono text-brand">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-navy-800">
                      <div className="h-full rounded-full bg-brand/60" style={{ width: `${(count / maxCount) * 100}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
