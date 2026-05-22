import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useClock } from '@/hooks/useClock'
import { cn } from '@/lib/utils'
import { AlertProvider } from '@/features/notifications/AlertProvider'

const NAV_OPERATOR = [
  { to: '/operator', label: 'Dashboard', icon: '📊', end: true },
  { to: '/operator/shift', label: 'Moja zmiana', icon: '🔄' },
  { to: '/operator/report', label: 'Wpisz wynik', icon: '✏️' },
  { to: '/operator/history', label: 'Historia', icon: '📋' }
]

const NAV_MANAGER = [
  { to: '/manager', label: 'Live produkcja', icon: '📡', end: true },
  { to: '/manager/orders', label: 'Zlecenia', icon: '📋' },
  { to: '/manager/assortments', label: 'Asortyment', icon: '📊' },
  { to: '/manager/export', label: 'Eksport', icon: '📥' }
]

const NAV_ADMIN = [
  { to: '/admin', label: 'Panel admina', icon: '⚙️', end: true },
  { to: '/admin/users', label: 'Użytkownicy', icon: '👤' },
  { to: '/admin/machines', label: 'Maszyny', icon: '🤖' },
  { to: '/admin/targets', label: 'Targety', icon: '🎯' },
  { to: '/admin/schedules', label: 'Harmonogram', icon: '📅' },
  { to: '/admin/orders', label: 'Zlecenia (admin)', icon: '📋' },
  { to: '/admin/audit', label: 'Audit log', icon: '🔍' },
  { to: '/admin/reset', label: 'Reset danych', icon: '🗑️' },
  { to: '/manager', label: '── Live produkcja', icon: '📡' },
  { to: '/manager/orders', label: '── Zlecenia', icon: '📋' },
  { to: '/manager/assortments', label: '── Asortyment', icon: '📊' },
  { to: '/manager/export', label: '── Eksport', icon: '📥' }
]

export default function AppLayout() {
  const { profile, signOut } = useAuthStore()
  const { activeShift, activeMachine } = useShiftStore()
  const { time, date } = useClock()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const navItems = profile?.role === 'admin' ? NAV_ADMIN
    : profile?.role === 'manager' ? NAV_MANAGER
    : NAV_OPERATOR

  const handleSignOut = async () => {
    if (activeShift) {
      if (!window.confirm(
        'Masz aktywną zmianę produkcyjną.\n\nCzy na pewno chcesz się wylogować?\n\nZmiana pozostanie aktywna — możesz do niej wrócić po ponownym zalogowaniu.'
      )) return
    }
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen bg-navy-900 text-white">
      {/* SIDEBAR */}
      <aside className={cn(
        'bg-navy-800 border-r border-navy-700 flex flex-col transition-all duration-200 sticky top-0 h-screen',
        sidebarOpen ? 'w-60' : 'w-16'
      )}>
        {/* Brand */}
        <div className="p-4 border-b border-navy-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-blue-400 flex items-center justify-center text-lg flex-shrink-0 shadow-md shadow-brand/20">
              🏭
            </div>
            {sidebarOpen && (
              <div>
                <div className="font-bold text-white text-sm leading-tight">MargoProd</div>
                <div className="text-navy-400 text-xs">MES v1.0</div>
              </div>
            )}
          </div>
        </div>

        {/* Active shift info */}
        {sidebarOpen && activeShift && (
          <div className="px-4 py-3 border-b border-navy-700 bg-brand/5">
            <div className="text-xs font-bold text-brand uppercase tracking-wider mb-1">
              {activeMachine?.name}
            </div>
            <div className="text-xs text-navy-300">
              Zmiana {activeShift.shift_type} · {profile?.full_name}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400">Zmiana aktywna</span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto">
          {sidebarOpen && (
            <div className="text-xs font-bold text-navy-500 uppercase tracking-widest px-2 mb-2">
              {profile?.role === 'admin' ? 'Administracja' : profile?.role === 'manager' ? 'Kierownik' : 'Operator'}
            </div>
          )}
          {navItems.map(item => (
            <NavLink
              key={item.to + item.label}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm font-medium transition-all',
                isActive
                  ? 'bg-brand/15 text-brand border border-brand/20'
                  : 'text-navy-300 hover:bg-navy-700 hover:text-white border border-transparent'
              )}
            >
              <span className="text-base flex-shrink-0">{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer — user info + logout */}
        <div className="border-t border-navy-700 p-3 space-y-2">
          {/* Zegar */}
          {sidebarOpen && (
            <div className="px-1 mb-1">
              <div className="font-mono text-lg font-bold text-white">{time}</div>
              <div className="text-xs text-navy-400">{date}</div>
            </div>
          )}

          {/* User info */}
          <div className="flex items-center gap-2 px-1">
            <div className="w-8 h-8 rounded-lg bg-brand/20 flex items-center justify-center text-brand text-xs font-bold flex-shrink-0">
              {profile?.full_name?.slice(0,2).toUpperCase()}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-white truncate">{profile?.full_name}</div>
                <div className="text-xs text-navy-400 capitalize">{profile?.role}</div>
              </div>
            )}
          </div>

          {/* Logout button — pełna szerokość, na dole */}
          <button
            onClick={handleSignOut}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all border',
              activeShift
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
            )}
          >
            <span className="text-base flex-shrink-0">{activeShift ? '⚠️' : '🚪'}</span>
            {sidebarOpen && (
              <span className="flex-1 text-left">
                {activeShift ? 'Wyloguj (zmiana aktywna)' : 'Wyloguj się'}
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <div className="bg-navy-800/80 backdrop-blur border-b border-navy-700 px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="text-navy-400 hover:text-white transition-colors"
          >
            ☰
          </button>
          <div className="flex-1" />
          <div className="text-xs text-navy-400 font-mono">{time}</div>
        </div>

        {/* Page content */}
        <AlertProvider>
          <div className="flex-1 p-6">
            <Outlet />
          </div>
        </AlertProvider>
      </main>
    </div>
  )
}