import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useClock } from '@/hooks/useClock'
import { cn } from '@/lib/utils'
import { AlertProvider } from '@/features/notifications/AlertProvider'
import LoadingScreen from '@/components/shared/LoadingScreen'

const Icons = {
  dashboard:  (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><rect x="2" y="2" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/><rect x="12" y="2" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/><rect x="2" y="12" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/><rect x="12" y="12" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/></svg>),
  shift:      (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5"/><path d="M11 6v5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  report:     (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M14 2H6a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-4-6z" stroke="currentColor" strokeWidth="1.5"/><path d="M14 2v6h6M8 13h6M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  history:    (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M3 11a8 8 0 1016 0 8 8 0 00-16 0z" stroke="currentColor" strokeWidth="1.5"/><path d="M11 7v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  live:       (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="3" fill="currentColor"/><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/><circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5" opacity="0.25"/></svg>),
  orders:     (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="1.5"/><rect x="9" y="3" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M8 12h6M8 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  plan:       (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><rect x="3" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M16 2v4M8 2v4M3 10h16M8 14h6M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  export:     (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M21 15v4a2 2 0 01-2 2H3a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.5"/><polyline points="7 10 12 15 17 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  admin:      (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M11 2v2M11 18v2M2 11h2M18 11h2M4.93 4.93l1.41 1.41M15.66 15.66l1.41 1.41M4.93 17.07l1.41-1.41M15.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  users:      (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M2 20v-1a7 7 0 0114 0v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M16 3.13a4 4 0 010 7.75M21 20v-1a4 4 0 00-3-3.85" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  machines:   (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><rect x="2" y="7" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 7V5a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.5"/><circle cx="11" cy="13" r="2" stroke="currentColor" strokeWidth="1.5"/></svg>),
  targets:    (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5"/><circle cx="11" cy="11" r="5" stroke="currentColor" strokeWidth="1.5"/><circle cx="11" cy="11" r="1.5" fill="currentColor"/></svg>),
  schedule:   (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><rect x="3" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M16 2v4M8 2v4M3 10h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  audit:      (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M11 20l-7-4V6l7-4 7 4v10l-7 4z" stroke="currentColor" strokeWidth="1.5"/><path d="M11 12a2 2 0 100-4 2 2 0 000 4zM11 12v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  reset:      (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><polyline points="1 4 1 10 7 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  logo:       (<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 2 L19.5 7 L19.5 15 L11 20 L2.5 15 L2.5 7 Z" stroke="#c9a84c" strokeWidth="1.5" fill="none"/><path d="M11 2 L11 20 M2.5 7 L19.5 15 M19.5 7 L2.5 15" stroke="#c9a84c" strokeWidth="0.75" opacity="0.25"/><circle cx="11" cy="11" r="2.5" fill="#c9a84c"/></svg>),
}

const NAV_OPERATOR = [
  { to: '/operator',         label: 'Dashboard',    icon: Icons.dashboard, end: true },
  { to: '/operator/shift',   label: 'Moja zmiana',  icon: Icons.shift },
  { to: '/operator/report',  label: 'Wpisz wynik',  icon: Icons.report },
  { to: '/operator/history', label: 'Historia',     icon: Icons.history }
]

const NAV_MANAGER = [
  { to: '/manager',              label: 'Live produkcja',   icon: Icons.live,    end: true },
  { to: '/manager/plan',         label: 'Plan produkcyjny', icon: Icons.plan },
  { to: '/manager/orders',       label: 'Zlecenia',         icon: Icons.orders },
  { to: '/manager/export',       label: 'Eksport',          icon: Icons.export }
]

const NAV_ADMIN = [
  { to: '/admin',              label: 'Panel admina',     icon: Icons.admin,    end: true },
  { to: '/admin/users',        label: 'Użytkownicy',      icon: Icons.users },
  { to: '/admin/machines',     label: 'Maszyny',          icon: Icons.machines },
  { to: '/admin/targets',      label: 'Targety',          icon: Icons.targets },
  { to: '/admin/schedules',    label: 'Harmonogram',      icon: Icons.schedule },
  { to: '/admin/orders',       label: 'Zlecenia (admin)', icon: Icons.orders },
  { to: '/admin/audit',        label: 'Audit log',        icon: Icons.audit },
  { to: '/admin/reset',        label: 'Reset danych',     icon: Icons.reset },
  { to: '/manager',            label: '── Live produkcja',   icon: Icons.live },
  { to: '/manager/plan',       label: '── Plan produkcyjny', icon: Icons.plan },
  { to: '/manager/orders',     label: '── Zlecenia',         icon: Icons.orders },
  { to: '/manager/export',     label: '── Eksport',          icon: Icons.export }
]

export default function AppLayout() {
  const { profile, signOut, isLoading } = useAuthStore()
  const { activeShift, activeMachine } = useShiftStore()
  const { time, date } = useClock()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [showLoading, setShowLoading] = useState(false)

  useEffect(() => {
    // Show loading animation only on first mount
    const shown = sessionStorage.getItem('ml_loaded')
    if (!shown) {
      setShowLoading(true)
      sessionStorage.setItem('ml_loaded', '1')
    }
  }, [])

  const navItems = profile?.role === 'admin' ? NAV_ADMIN
    : profile?.role === 'manager' ? NAV_MANAGER
    : NAV_OPERATOR

  const handleSignOut = async () => {
    if (activeShift && profile?.role === 'operator') {
      setShowLogoutModal(true)
      return
    }
    await signOut()
    navigate('/login')
  }

  const confirmSignOut = async () => {
    setShowLogoutModal(false)
    await signOut()
    navigate('/login')
  }

  if (isLoading || !profile) {
    return (
      <div style={{ display:'flex', minHeight:'100vh', background:'#07080D', alignItems:'center', justifyContent:'center' }}>
        <style>{`
          @keyframes pulse-ring { 0%,100%{opacity:0.15;transform:scale(0.95)} 50%{opacity:0.5;transform:scale(1.15)} }
          @keyframes pulse-ring2 { 0%,100%{opacity:0.08;transform:scale(0.9)} 50%{opacity:0.3;transform:scale(1.3)} }
          @keyframes pulse-ring3 { 0%,100%{opacity:0.04;transform:scale(0.85)} 50%{opacity:0.15;transform:scale(1.5)} }
          @keyframes glow-burst { 0%,100%{opacity:0.6} 50%{opacity:1} }
          @keyframes fade-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
          .margo-ring1{animation:pulse-ring 2s ease-in-out infinite}
          .margo-ring2{animation:pulse-ring2 2s ease-in-out infinite 0.3s}
          .margo-ring3{animation:pulse-ring3 2s ease-in-out infinite 0.6s}
          .margo-logo{animation:glow-burst 2s ease-in-out infinite}
          .margo-text{animation:fade-in 0.8s ease forwards 0.4s;opacity:0}
        `}</style>
        <div style={{ textAlign:'center', position:'relative' }}>
          {/* Pierścienie pulsujące */}
          <div style={{ position:'relative', width:120, height:120, margin:'0 auto 24px' }}>
            <div className="margo-ring3" style={{ position:'absolute', inset:-24, borderRadius:'50%', border:'1px solid #c9a84c', transformOrigin:'center' }} />
            <div className="margo-ring2" style={{ position:'absolute', inset:-12, borderRadius:'50%', border:'1px solid #c9a84c', transformOrigin:'center' }} />
            <div className="margo-ring1" style={{ position:'absolute', inset:0, borderRadius:'50%', border:'1.5px solid #c9a84c', transformOrigin:'center' }} />
            {/* Logo */}
            <div className="margo-logo" style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="72" height="72" viewBox="0 0 22 22" fill="none">
                <path d="M11 2 L19.5 7 L19.5 15 L11 20 L2.5 15 L2.5 7 Z" stroke="#c9a84c" strokeWidth="1.2" fill="none"/>
                <path d="M11 2 L11 20 M2.5 7 L19.5 15 M19.5 7 L2.5 15" stroke="#c9a84c" strokeWidth="0.5" opacity="0.3"/>
                <circle cx="11" cy="11" r="2.5" fill="#c9a84c"/>
              </svg>
            </div>
          </div>
          <div className="margo-text">
            <div style={{ color:'#fff', fontWeight:700, fontSize:18, letterSpacing:'0.05em', marginBottom:6 }}>MargoLine</div>
            <div style={{ color:'#c9a84c', fontSize:12, letterSpacing:'0.12em', textTransform:'uppercase', opacity:0.7 }}>MES v1.0 · Ładowanie...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-navy-900 text-white">
      {showLoading && <LoadingScreen onComplete={() => setShowLoading(false)} />}
      {/* Mobile overlay backdrop - only on mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 md:hidden"
          style={{ zIndex: 35 }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={cn(
        'bg-navy-800 border-r border-navy-700 flex flex-col transition-all duration-300 h-screen overflow-hidden flex-shrink-0',
        'fixed md:sticky top-0',
        sidebarOpen ? 'z-40 translate-x-0' : 'md:translate-x-0 -translate-x-full md:z-auto',
        sidebarOpen ? 'w-64 translate-x-0' : 'w-0 md:w-16 -translate-x-full md:translate-x-0'
      )}>
        {/* Brand */}
        <div className="p-4 border-b border-navy-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-navy-900 border border-yellow-600/30 flex items-center justify-center flex-shrink-0">
              {Icons.logo}
            </div>
            {sidebarOpen && (
              <div>
                <div className="font-bold text-white text-sm leading-tight tracking-wide">MargoLine</div>
                <div className="text-navy-400 text-xs">MES v1.0</div>
              </div>
            )}
          </div>
        </div>

        {/* Active shift */}
        {sidebarOpen && activeShift && (
          <div className="px-4 py-3 border-b border-navy-700 bg-brand/5 flex-shrink-0">
            <div className="text-xs font-bold text-brand uppercase tracking-wider mb-1">{activeMachine?.name}</div>
            <div className="text-xs text-navy-300">Zmiana {activeShift.shift_type} · {profile?.full_name}</div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400">Zmiana aktywna</span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto min-h-0">
          {sidebarOpen && (
            <div className="text-xs font-bold text-navy-500 uppercase tracking-widest px-2 mb-2">
              {profile?.role === 'admin' ? 'Administracja' : profile?.role === 'manager' ? 'Kierownik' : 'Operator'}
            </div>
          )}
          {navItems.map(item => (
            <NavLink
              key={item.to + item.label}
              to={item.to}
              end={(item as { end?: boolean }).end}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm font-medium transition-all',
                isActive
                  ? 'bg-brand/15 text-brand border border-brand/20'
                  : 'text-navy-300 hover:bg-navy-700 hover:text-white border border-transparent'
              )}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-navy-700 p-3 space-y-2 flex-shrink-0">
          {sidebarOpen && (
            <div className="px-1">
              <div className="font-mono text-lg font-bold text-white">{time}</div>
              <div className="text-xs text-navy-400">{date}</div>
            </div>
          )}
          <div className="flex items-center gap-2 px-1">
            <div className="w-8 h-8 rounded-lg bg-brand/20 flex items-center justify-center text-brand text-xs font-bold flex-shrink-0">
              {profile?.full_name?.slice(0,2).toUpperCase() ?? '??'}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-white truncate">{profile?.full_name}</div>
                <div className="text-xs text-navy-400 capitalize">{profile?.role}</div>
              </div>
            )}
          </div>
          <button
            onClick={handleSignOut}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all border',
              activeShift
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
            )}
          >
            <svg width="16" height="16" viewBox="0 0 22 22" fill="none" className="flex-shrink-0">
              <path d="M9 21H5a2 2 0 01-2-2V3a2 2 0 012-2h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <polyline points="16 17 21 12 16 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            {sidebarOpen && (
              <span>{activeShift ? 'Wyloguj (zmiana aktywna)' : 'Wyloguj się'}</span>
            )}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <div className="bg-navy-800/80 backdrop-blur border-b border-navy-700 px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(v => !v)} className="text-navy-400 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
              <line x1="3" y1="6" x2="19" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="3" y1="11" x2="19" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="3" y1="16" x2="19" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
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

      {/* Modal wylogowania */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border-2 border-amber-500/30 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
                  <path d="M11 4L2 19h18L11 4z" stroke="#F59E0B" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M11 9v5M11 16.5v.5" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <div className="font-bold text-white">Aktywna zmiana produkcyjna</div>
                <div className="text-xs text-amber-400">{activeMachine?.name} · Zmiana {activeShift?.shift_type}</div>
              </div>
            </div>
            <p className="text-sm text-navy-300 mb-2">
              Masz aktywną zmianę produkcyjną. Jeśli się wylogujesz — zmiana pozostanie aktywna w systemie.
            </p>
            <p className="text-sm text-navy-400 mb-5">
              Możesz wrócić do niej po ponownym zalogowaniu.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowLogoutModal(false)}
                className="flex-1 btn-secondary py-2.5 font-semibold">
                Zostań
              </button>
              <button onClick={confirmSignOut}
                className="flex-1 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 py-2.5 rounded-xl font-semibold text-sm transition-all">
                Wyloguj się
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
