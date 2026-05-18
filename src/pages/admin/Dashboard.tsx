import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface Stats {
  users: number
  operators: number
  reportsToday: number
  shiftsToday: number
  auditToday: number
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats>({ users: 0, operators: 0, reportsToday: 0, shiftsToday: 0, auditToday: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    Promise.all([
      supabase.from('profiles').select('id', { count: 'exact' }).is('deleted_at', null),
      supabase.from('profiles').select('id', { count: 'exact' }).eq('role', 'operator').is('deleted_at', null),
      supabase.from('hourly_reports').select('id', { count: 'exact' }).eq('report_date', today).is('deleted_at', null),
      supabase.from('shifts').select('id', { count: 'exact' }).eq('shift_date', today).is('ended_at', null),
      supabase.from('audit_logs').select('id', { count: 'exact' }).gte('created_at', today + 'T00:00:00Z')
    ]).then(([u, op, r, s, a]) => {
      setStats({
        users: u.count ?? 0,
        operators: op.count ?? 0,
        reportsToday: r.count ?? 0,
        shiftsToday: s.count ?? 0,
        auditToday: a.count ?? 0
      })
      setLoading(false)
    })
  }, [])

  const tiles = [
    { icon: '👥', label: 'Użytkownicy', value: stats.users, sub: `w tym ${stats.operators} operatorów`, to: '/admin/users', color: 'border-brand/30' },
    { icon: '🤖', label: 'Aktywne zmiany', value: stats.shiftsToday, sub: 'dziś', to: '/manager', color: 'border-green-500/30' },
    { icon: '📋', label: 'Raporty dziś', value: stats.reportsToday, sub: 'wpisów godzinowych', to: '/manager', color: 'border-cyan-500/30' },
    { icon: '🔍', label: 'Zdarzeń audit', value: stats.auditToday, sub: 'dziś w systemie', to: '/admin/audit', color: 'border-amber-500/30' },
  ]

  const quickLinks = [
    { icon: '👤', label: 'Zarządzaj użytkownikami', sub: 'Dodaj, edytuj, resetuj hasła', to: '/admin/users' },
    { icon: '🤖', label: 'Konfiguracja maszyn', sub: 'Targety, nazwy, działy', to: '/admin/machines' },
    { icon: '🎯', label: 'Targety produkcji', sub: 'Progi efektywności', to: '/admin/targets' },
    { icon: '📅', label: 'Harmonogram', sub: 'Dni wolne, przerwy', to: '/admin/schedules' },
    { icon: '🔍', label: 'Audit log', sub: 'Historia wszystkich zmian', to: '/admin/audit' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Panel Administratora</h1>
        <p className="text-navy-400 mt-1">Zarządzanie systemem MargoProd MES</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(t => (
          <button key={t.label} onClick={() => navigate(t.to)}
            className={cn('card border-2 text-left hover:bg-navy-700 transition-all active:scale-95', t.color)}>
            <div className="text-3xl mb-2">{t.icon}</div>
            <div className="kpi-label">{t.label}</div>
            <div className="kpi-value">{loading ? '...' : t.value}</div>
            <div className="kpi-sub">{t.sub}</div>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">Szybki dostęp</div></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {quickLinks.map(l => (
            <button key={l.label} onClick={() => navigate(l.to)}
              className="flex items-center gap-3 bg-navy-900 hover:bg-navy-700 rounded-xl p-4 text-left transition-all border border-navy-700 hover:border-brand/30">
              <span className="text-2xl">{l.icon}</span>
              <div>
                <div className="font-semibold text-white text-sm">{l.label}</div>
                <div className="text-xs text-navy-400 mt-0.5">{l.sub}</div>
              </div>
              <span className="ml-auto text-navy-600">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
