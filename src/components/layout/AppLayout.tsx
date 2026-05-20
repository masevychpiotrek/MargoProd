import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useClock } from '@/hooks/useClock'
import { cn } from '@/lib/utils'
import { AlertProvider } from '@/features/notifications/AlertProvider'

// Tabler Icons jako komponenty SVG
const Icons = {
  dashboard:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>,
  shift:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>,
  report:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  history:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>,
  live:         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>,
  orders:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  assortment:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="6" height="6" rx="1"/><rect x="9" y="3" width="6" height="6" rx="1"/><rect x="16" y="3" width="6" height="6" rx="1"/><rect x="2" y="12" width="6" height="6" rx="1"/><rect x="9" y="12" width="6" height="6" rx="1"/><rect x="16" y="12" width="6" height="6" rx="1"/></svg>,
  export:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  admin:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  users:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  machines:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  targets:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  schedule:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  audit:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  reset:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  manager:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>,
  logout:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  warning:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  menu:         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
}

// Sześciokąt SVG jako logo
const HexLogo = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <path d="M11 2 L19.5 7 L19.5 15 L11 20 L2.5 15 L2.5 7 Z" stroke="#c9a84c" strokeWidth="1.5" fill="none"/>
    <path d="M11 2 L11 20 M2.5 7 L19.5 15 M19.5 7 L2.5 15" stroke="#c9a84c" strokeWidth="0.75" opacity="0.25"/>
    <circle cx="11" cy="11" r="2.5" fill="#c9a84c"/>
  </svg>
)

const NAV_OPERATOR = [
  { to: '/operator', label: 'Dashboard', icon: Icons.dashboard, end: true },
  { to: '/operator/shift', label: 'Moja zmiana', icon: Icons.shift },
  { to: '/operator/report', label: 'Wpisz wynik', icon: Icons.report },
  { to: '/operator/history', label: 'Historia', icon: Icons.history }
]

const NAV_MANAGER = [
  { to: '/manager', label: 'Live produkcja', icon: Icons.live, end: true },
  { to: '/manager/orders', label: 'Zlecenia', icon: Icons.orders },
  { to: '/manager/assortments', label: 'Asortyment', icon: Icons.assortment },
  { to: '/manager/export', label: 'Eksport', icon: Icons.export }
]

const NAV_ADMIN = [
  { to: '/admin', label: 'Panel admina', icon: Icons.admin, end: true },
  { to: '/admin/users', label: 'Użytkownicy', icon: Icons.users },
  { to: '/admin/machines', label: 'Maszyny', icon: Icons.machines },
  { to: '/admin/targets', label: 'Targety', icon: Icons.targets },
  { to: '/admin/schedules', label: 'Harmonogram', icon: Icons.schedule },
  { to: '/admin/orders', label: 'Zlecenia (admin)', icon: Icons.orders },
  { to: '/admin/audit', label: 'Audit log', icon: Icons.audit },
  { to: '/admin/reset', label: 'Reset danych', icon: Icons.reset },
  { to: '/manager', label: '── Live produkcja', icon: Icons.live },
  { to: '/manager/orders', label: '── Zlecenia', icon: Icons.orders },
  { to: '/manager/assortments', label: '── Asortyment', icon: Icons.assortment },
  { to: '/manager/export', label: '── Eksport', icon: Icons.export }
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
    const isOperator = profile?.role === 'operator'
    if (isOperator && activeShift) {
      if (window.confirm(
        'Masz aktywną zmianę produkcyjną.\n\n' +
        'Czy na pewno chcesz się wylogować?\n\n' +
        'Zmiana pozostanie aktywna — drugi operator lub Ty po ponownym zalogowaniu możecie kontynuować.'
      )) {
        await signOut()
        navigate('/login')
      }
    } else {
      await signOut()
      navigate('/login')
    }
  }

  return (
    <div className="flex min-h-screen bg-navy-900 text-white">
      {/* SIDEBAR */}
      <aside className={cn(
        'bg-navy-800 border-r border-navy-700 flex flex-col transition-all duration-200 sticky top-0 h-screen overflow-hidden flex-shrink-0',
        sidebarOpen ? 'w-60' : 'w-16'
      )}>
        {/* Brand */}
        <div className="p-4 border-b border-navy-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-navy-700 border border-yellow-600/40 flex items-center justify-center flex-shrink-0">
              <HexLogo />
            </div>
            {sidebarOpen && (
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-sm leading-tight">MargoLine</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-yellow-600/20 text-yellow-500 border border-yellow-600/30 leading-none">BETA</span>
                </div>
                <div className="text-navy-400 text-xs">v1.0 · MES</div>
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
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm font-medium transition-all',
                isActive
                  ? 'bg-brand/15 text-brand border border-brand/20'
                  : 'text-navy-300 hover:bg-navy-700 hover:text-white border border-transparent'
              )}
            >
              <span className="flex-shrink-0 w-[18px]">{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}

          {/* Role switcher links */}
          {sidebarOpen && profile?.role !== 'operator' && (
            <>
              <div className="text-xs font-bold text-navy-500 uppercase tracking-widest px-2 mb-2 mt-4">
                Inne widoki
              </div>
              {profile?.role === 'admin' && (
                <NavLink to="/manager" className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm text-navy-400 hover:bg-navy-700 hover:text-white transition-all">
                  <span className="flex-shrink-0 w-[18px]">{Icons.manager}</span>
                  <span>Widok kierownika</span>
                </NavLink>
              )}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-navy-700 p-3 flex-shrink-0">
          {sidebarOpen && (
            <div className="mb-2">
              <div className="font-mono text-xl font-bold text-white">{time}</div>
              <div className="text-xs text-navy-400">{date}</div>
            </div>
          )}

          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-brand/20 flex items-center justify-center text-brand text-xs font-bold flex-shrink-0">
              {profile?.full_name.slice(0, 2).toUpperCase()}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white truncate">{profile?.full_name}</div>
                <div className="text-xs text-navy-400 capitalize">{profile?.role}</div>
              </div>
            )}
          </div>

          {sidebarOpen ? (
            <button
              onClick={handleSignOut}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all w-full',
                (profile?.role === 'operator' && activeShift)
                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                  : 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20'
              )}
            >
              <span className="flex-shrink-0">
                {(profile?.role === 'operator' && activeShift) ? Icons.warning : Icons.logout}
              </span>
              <span>Wyloguj się</span>
              {(profile?.role === 'operator' && activeShift) && (
                <span className="ml-auto text-xs opacity-70">zmiana aktywna</span>
              )}
            </button>
          ) : (
            <button
              onClick={handleSignOut}
              title="Wyloguj się"
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all mx-auto"
            >
              {Icons.logout}
            </button>
          )}
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
            {Icons.menu}
          </button>
          <div className="flex-1" />
          <div className="text-xs text-navy-400 font-mono">{time}</div>
        </div>

        <AlertProvider>
          <div className="flex-1 p-6">
            <Outlet />
          </div>
        </AlertProvider>
      </main>
    </div>
  )
}
