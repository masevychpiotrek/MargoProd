import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { AuditLog, Machine, Profile, Shift } from '@/types/database'

interface Stats {
  users: number
  inactiveUsers: number
  operators: number
  machines: number
  activeShifts: number
  reportsToday: number
  openOrders: number
  auditToday: number
}

type Activity = AuditLog & { profile?: { full_name: string } | null }
type ActiveShiftRow = Shift & {
  machine?: Pick<Machine, 'name' | 'code'> | null
  operator_1?: Pick<Profile, 'full_name'> | null
  operator_2?: Pick<Profile, 'full_name'> | null
}

const ACTION_LABELS: Record<string, string> = {
  login: 'zalogowal sie',
  logout: 'wylogowal sie',
  report_create: 'dodany raport',
  report_update: 'edytowany raport',
  report_delete: 'usuniety raport',
  user_create: 'utworzono konto',
  user_update: 'zmieniono konto',
  user_delete: 'usunieto konto',
  password_change: 'zmieniono haslo',
  shift_start: 'rozpoczeto zmiane',
  shift_end: 'zakonczono zmiane',
  config_change: 'zmiana konfiguracji'
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function describeWhy(log: Activity) {
  const values = (log.new_values ?? {}) as Record<string, unknown>
  const oldValues = (log.old_values ?? {}) as Record<string, unknown>
  const reason = values.reason ?? values.downtime_reason ?? values.note ?? values.notes ?? values.scope
  if (typeof reason === 'string' && reason.trim()) return reason
  if (log.table_name === 'reset') return 'reset danych testowych'
  if (log.action === 'login') return 'wejscie do systemu'
  if (log.action === 'logout') return 'koniec pracy w sesji'
  if (log.action === 'password_change') return 'bezpieczenstwo konta'
  const changed = Object.keys(values).filter(k => oldValues[k] !== values[k])
  if (changed.length) return `zmienione pola: ${changed.slice(0, 4).join(', ')}`
  return 'brak opisu'
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const [stats, setStats] = useState<Stats>({
    users: 0, inactiveUsers: 0, operators: 0, machines: 0,
    activeShifts: 0, reportsToday: 0, openOrders: 0, auditToday: 0
  })
  const [activities, setActivities] = useState<Activity[]>([])
  const [activeShifts, setActiveShifts] = useState<ActiveShiftRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const today = todayISO()
    const dayStart = `${today}T00:00:00Z`
    const [users, inactive, operators, machines, shifts, reports, orders, audit, activity] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact' }).is('deleted_at', null),
      supabase.from('profiles').select('id', { count: 'exact' }).eq('is_active', false).is('deleted_at', null),
      supabase.from('profiles').select('id', { count: 'exact' }).eq('role', 'operator').is('deleted_at', null),
      supabase.from('machines').select('id', { count: 'exact' }).eq('is_active', true).is('deleted_at', null),
      supabase.from('shifts')
        .select('*, machine:machines(name,code), operator_1:profiles!operator_1_id(full_name), operator_2:profiles!operator_2_id(full_name)')
        .is('ended_at', null)
        .order('started_at', { ascending: false }),
      supabase.from('hourly_reports').select('id', { count: 'exact' }).eq('report_date', today).is('deleted_at', null),
      supabase.from('production_orders').select('id', { count: 'exact' }).in('status', ['active', 'paused']),
      supabase.from('audit_logs').select('id', { count: 'exact' }).gte('created_at', dayStart),
      supabase.from('audit_logs')
        .select('*, profile:profiles(full_name)')
        .order('created_at', { ascending: false })
        .limit(12)
    ])

    setStats({
      users: users.count ?? 0,
      inactiveUsers: inactive.count ?? 0,
      operators: operators.count ?? 0,
      machines: machines.count ?? 0,
      activeShifts: shifts.data?.length ?? 0,
      reportsToday: reports.count ?? 0,
      openOrders: orders.count ?? 0,
      auditToday: audit.count ?? 0
    })
    setActiveShifts((shifts.data ?? []) as ActiveShiftRow[])
    setActivities((activity.data ?? []) as Activity[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    channel.current?.unsubscribe()
    channel.current = supabase.channel('admin-live-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
      .subscribe()
    return () => { channel.current?.unsubscribe() }
  }, [])

  const issues = useMemo(() => {
    const list: { label: string; desc: string; to: string; tone: string }[] = []
    if (stats.inactiveUsers > 0) list.push({ label: 'Nieaktywne konta', desc: `${stats.inactiveUsers} kont do sprawdzenia`, to: '/admin/users', tone: 'amber' })
    if (stats.activeShifts > 0) list.push({ label: 'Aktywne zmiany', desc: `${stats.activeShifts} zmian w toku`, to: '/manager', tone: 'green' })
    if (stats.openOrders > 0) list.push({ label: 'Otwarte zlecenia', desc: `${stats.openOrders} aktywnych lub zapauzowanych`, to: '/manager/orders', tone: 'cyan' })
    if (list.length === 0) list.push({ label: 'System spokojny', desc: 'Brak rzeczy wymagajacych reakcji', to: '/admin/audit', tone: 'green' })
    return list
  }, [stats])

  const tiles = [
    { label: 'Uzytkownicy', value: stats.users, sub: `${stats.operators} operatorow`, to: '/admin/users', tone: 'brand' },
    { label: 'Maszyny', value: stats.machines, sub: 'aktywne', to: '/admin/machines', tone: 'cyan' },
    { label: 'Raporty dzis', value: stats.reportsToday, sub: 'wpisow', to: '/manager', tone: 'green' },
    { label: 'Zdarzenia dzis', value: stats.auditToday, sub: 'audit live', to: '/admin/audit', tone: 'amber' }
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Panel admina</h1>
          <p className="mt-1 text-navy-400">Kontrola systemu, uzytkownikow i aktywnosci na zywo</p>
        </div>
        <button onClick={() => load()} className="btn-secondary px-4 py-2 text-sm">Odswiez</button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(t => (
          <button key={t.label} onClick={() => navigate(t.to)}
            className={cn('card border-2 text-left transition-all hover:bg-navy-700',
              t.tone === 'brand' ? 'border-brand/30' :
              t.tone === 'cyan' ? 'border-cyan-500/30' :
              t.tone === 'green' ? 'border-green-500/30' : 'border-amber-500/30')}>
            <div className="kpi-label">{t.label}</div>
            <div className="kpi-value">{loading ? '...' : t.value}</div>
            <div className="kpi-sub">{t.sub}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card xl:col-span-2">
          <div className="card-header">
            <div><div className="card-title">Aktywne zmiany</div><div className="card-sub">kto teraz pracuje i na czym</div></div>
          </div>
          {activeShifts.length === 0 ? (
            <div className="py-8 text-center text-sm text-navy-500">Brak aktywnych zmian</div>
          ) : (
            <div className="space-y-2">
              {activeShifts.map(s => (
                <button key={s.id} onClick={() => navigate('/manager')}
                  className="w-full rounded-xl border border-navy-700 bg-navy-900 p-3 text-left transition-all hover:border-brand/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-white">{s.machine?.name ?? 'Maszyna'} · Zmiana {s.shift_type}</div>
                      <div className="mt-1 text-xs text-navy-400">
                        {[s.operator_1?.full_name, s.operator_2?.full_name].filter(Boolean).join(' / ') || 'brak operatorow'}
                      </div>
                    </div>
                    <div className="text-right text-xs text-green-400">aktywna od {new Date(s.started_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div><div className="card-title">Wymaga uwagi</div><div className="card-sub">najwazniejsze skroty</div></div>
          </div>
          <div className="space-y-2">
            {issues.map(i => (
              <button key={i.label} onClick={() => navigate(i.to)}
                className={cn('w-full rounded-xl border p-3 text-left transition-all hover:bg-navy-700',
                  i.tone === 'green' ? 'border-green-500/30 bg-green-500/5' :
                  i.tone === 'cyan' ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
                <div className="text-sm font-bold text-white">{i.label}</div>
                <div className="mt-1 text-xs text-navy-300">{i.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div><div className="card-title">Aktywnosc na zywo</div><div className="card-sub">kto, co zrobil i po co</div></div>
          <button onClick={() => navigate('/admin/audit')} className="btn-secondary px-3 py-1.5 text-xs">Pelny audit</button>
        </div>
        {activities.length === 0 ? (
          <div className="py-8 text-center text-sm text-navy-500">Brak zdarzen</div>
        ) : (
          <div className="space-y-2">
            {activities.map(a => (
              <div key={a.id} className="grid gap-2 rounded-xl border border-navy-700 bg-navy-900 p-3 text-sm md:grid-cols-[150px_1fr_1fr]">
                <div className="font-mono text-xs text-navy-400">{new Date(a.created_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                <div>
                  <span className="font-bold text-white">{a.profile?.full_name ?? 'System'}</span>
                  <span className="text-navy-300"> · {ACTION_LABELS[a.action] ?? a.action}</span>
                </div>
                <div className="text-xs text-navy-400">Po co: <span className="text-navy-200">{describeWhy(a)}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
