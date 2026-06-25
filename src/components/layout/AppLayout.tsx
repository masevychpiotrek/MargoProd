import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useShiftStore } from '@/stores/shiftStore'
import { supabase } from '@/lib/supabase'
import { useClock } from '@/hooks/useClock'
import { cn } from '@/lib/utils'
import { AlertProvider } from '@/features/notifications/AlertProvider'
import RobotAssistant from '@/components/shared/RobotAssistant'
import type { SaSession, Shift } from '@/types/database'
import { setTestModeEnabled, useTestMode } from '@/hooks/useTestMode'
import { usePresence } from '@/hooks/usePresence'

const Icons = {
  dashboard:  (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><rect x="2" y="2" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/><rect x="12" y="2" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/><rect x="2" y="12" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/><rect x="12" y="12" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/></svg>),
  shift:      (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5"/><path d="M11 6v5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  report:     (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M14 2H6a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-4-6z" stroke="currentColor" strokeWidth="1.5"/><path d="M14 2v6h6M8 13h6M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  history:    (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M3 11a8 8 0 1016 0 8 8 0 00-16 0z" stroke="currentColor" strokeWidth="1.5"/><path d="M11 7v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  failure:    (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d="M11 3l9 16H2L11 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M11 8v5M11 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>),
  tasks:      (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><rect x="4" y="3" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M8 8l1.5 1.5L13 6M8 14l1.5 1.5L14 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  password:   (<svg width="18" height="18" viewBox="0 0 22 22" fill="none"><rect x="4" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 10V7a4 4 0 018 0v3M11 14v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
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
  { to: '/operator/failure', label: 'Zgloś awarie', icon: Icons.failure },
  { to: '/operator/tasks',   label: 'Zadania',      icon: Icons.tasks },
  { to: '/operator/password', label: 'Zmien haslo',  icon: Icons.password },
  { to: '/operator/history', label: 'Historia',     icon: Icons.history },
  { to: '/tpm',              label: '── TPM/PM IS PRO', icon: Icons.machines },
  { to: '/tpm/checklist',    label: '── Checklista AM',  icon: Icons.tasks },
  { to: '/tpm/report',       label: '── Zgłoś awarię TPM', icon: Icons.failure }
]

const NAV_MANAGER = [
  { to: '/manager',              label: 'Produkcja',        icon: Icons.live,    end: true },
  { to: '/manager/monthly',      label: 'Realizacja mies.', icon: Icons.plan },
  { to: '/manager/operators',    label: 'Ranking operatorow', icon: Icons.users },
  { to: '/manager/forecast',     label: 'Prognoza dnia',    icon: Icons.dashboard },
  { to: '/manager/day-report',   label: 'Raport dnia',      icon: Icons.report },
  { to: '/manager/failures',     label: 'Awarie i technik', icon: Icons.failure },
  { to: '/password',             label: 'Zmien haslo',      icon: Icons.password },
  { to: '/manager/export',       label: 'Eksport',          icon: Icons.export },
  { to: '/syringe/supervisor',   label: '── Strzykawki SA',  icon: Icons.machines },
  { to: '/syringe/history',      label: '── Historia SA',    icon: Icons.history },
  { to: '/admin/syringe',        label: '── Strzykawki konfig.', icon: Icons.targets },
  { to: '/tpm/manager',          label: '── TPM/PM nadzór',  icon: Icons.machines },
  { to: '/tpm/issues',           label: '── TPM zgłoszenia', icon: Icons.failure },
  { to: '/tpm/pm',               label: '── TPM karty PM',   icon: Icons.tasks },
  { to: '/tpm/parameters',       label: '── TPM parametry',  icon: Icons.targets },
  { to: '/tpm/parts',            label: '── TPM części',     icon: Icons.machines },
  { to: '/tpm/stations',         label: '── TPM stacje',     icon: Icons.targets },
]

const NAV_VIEWER = [
  { to: '/demo',                 label: 'Demo systemu',     icon: Icons.dashboard, end: true },
  { to: '/password',             label: 'Zmien haslo',      icon: Icons.password }
]


const NAV_EXECUTIVE = [
  { to: '/executive',            label: 'Podsumowanie',     icon: Icons.dashboard, end: true },
  { to: '/executive/charts',     label: 'Wykresy',          icon: Icons.live },
  { to: '/executive/machines',   label: 'Automaty',         icon: Icons.machines },
  { to: '/executive/details',    label: 'Szczegoly',        icon: Icons.report },
  { to: '/executive/report',    label: 'Raport dnia',      icon: Icons.live },
  { to: '/tpm/board',           label: 'TPM/PM IS PRO',    icon: Icons.machines },
  { to: '/password',             label: 'Zmien haslo',      icon: Icons.password }
]
const NAV_SYRINGE_OPERATOR = [
  { to: '/syringe',            label: 'Pulpit',           icon: Icons.dashboard, end: true },
  { to: '/syringe/start',      label: 'Rozpocznij zmianę',icon: Icons.shift },
  { to: '/syringe/entry',      label: 'Wpisz produkcję',  icon: Icons.report },
  { to: '/syringe/downtime',   label: 'Przestój',         icon: Icons.failure },
  { to: '/syringe/failure',    label: 'Zgłoś awarię',     icon: Icons.failure },
  { to: '/syringe/quality',    label: 'Problem jakości',  icon: Icons.targets },
  { to: '/syringe/components', label: 'Komponenty',       icon: Icons.machines },
  { to: '/syringe/changeover', label: 'Przezbrojenie',    icon: Icons.reset },
  { to: '/syringe/handover',   label: 'Przekaż zmianę',   icon: Icons.tasks },
  { to: '/syringe/history',    label: 'Historia',         icon: Icons.history },
  { to: '/password',           label: 'Zmień hasło',      icon: Icons.password },
]

const NAV_SPECIALIST = [
  { to: '/specialist', label: 'Zgłoszenia awarii', icon: Icons.failure, end: true },
  { to: '/tpm/issues', label: 'TPM — Zgłoszenia',  icon: Icons.machines },
  { to: '/tpm/pm',     label: 'TPM — Karty PM',     icon: Icons.tasks },
  { to: '/tpm/parameters', label: 'TPM — Parametry', icon: Icons.targets },
  { to: '/tpm/parts',  label: 'TPM — Części',       icon: Icons.machines },
  { to: '/tpm/checklist', label: 'TPM — Checklista AM', icon: Icons.tasks },
  { to: '/password',   label: 'Zmien haslo',        icon: Icons.password },
]

const NAV_ADMIN = [
  { to: '/admin',              label: 'Panel admina',     icon: Icons.admin,    end: true },
  { to: '/admin/users',        label: 'Użytkownicy',      icon: Icons.users },
  { to: '/admin/machines',     label: 'Maszyny',          icon: Icons.machines },
  { to: '/admin/targets',      label: 'Targety',          icon: Icons.targets },
  { to: '/admin/schedules',    label: 'Harmonogram',      icon: Icons.schedule },
  { to: '/admin/audit',        label: 'Audit live',       icon: Icons.audit },
  { to: '/admin/reset',        label: 'Reset danych',     icon: Icons.reset },
  { to: '/admin/syringe',      label: 'Strzykawki — konfig.', icon: Icons.machines },
  { to: '/tpm/manager',        label: 'TPM/PM nadzór',    icon: Icons.machines },
  { to: '/tpm/pm',             label: 'TPM karty PM',     icon: Icons.tasks },
  { to: '/tpm/parameters',     label: 'TPM parametry',    icon: Icons.targets },
  { to: '/tpm/parts',          label: 'TPM części',       icon: Icons.machines },
  { to: '/tpm/stations',       label: 'TPM stacje/checklisty', icon: Icons.targets },
  { to: '/password',           label: 'Zmien haslo',      icon: Icons.password },
  { to: '/manager',             label: '── Live produkcja',   icon: Icons.live },
  { to: '/manager/day-report',  label: '── Raport dnia',      icon: Icons.report },
  { to: '/manager/export',      label: '── Eksport',          icon: Icons.export },
  { to: '/specialist',          label: '── Awarie (spec.)',   icon: Icons.failure },
  { to: '/syringe/supervisor',  label: '── Strzykawki SA',    icon: Icons.machines },
  { to: '/syringe/history',     label: '── Historia SA',      icon: Icons.history },
]

export default function AppLayout() {
  const { profile, signOut, isLoading } = useAuthStore()
  const { activeShift, activeMachine, isLoading: shiftLoading, loadActiveShift } = useShiftStore()
  const testMode = useTestMode()
  const { time, date } = useClock()
  usePresence()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [lightTheme, setLightTheme] = useState(() => localStorage.getItem('margoline_theme') === 'light')
  const [activeSyringeSession, setActiveSyringeSession] = useState<SaSession | null>(null)

  useEffect(() => {
    // Show loading animation only on first mount
    const shown = sessionStorage.getItem('ml_loaded')
    if (!shown) {
      sessionStorage.setItem('ml_loaded', '1')
    }
  }, [])

  useEffect(() => {
    loadActiveShift()
  }, [profile?.id, profile?.role, loadActiveShift])

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', lightTheme)
    localStorage.setItem('margoline_theme', lightTheme ? 'light' : 'dark')
  }, [lightTheme])

  useEffect(() => {
    if (profile?.role !== 'operator') return

    const refreshIfOwnShiftChanged = (record: Partial<Shift> | null) => {
      if (!record) {
        loadActiveShift()
        return
      }

      const isOwnShift =
        record.operator_1_id === profile.id ||
        record.operator_2_id === profile.id ||
        record.id === activeShift?.id

      if (isOwnShift) loadActiveShift()
    }

    const channel = supabase
      .channel(`operator-shifts-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, payload => {
        refreshIfOwnShiftChanged((payload.new ?? payload.old ?? null) as Partial<Shift> | null)
      })
      .subscribe()

    const fallback = window.setInterval(loadActiveShift, 60000)

    return () => {
      window.clearInterval(fallback)
      supabase.removeChannel(channel)
    }
  }, [profile?.id, profile?.role, activeShift?.id, loadActiveShift])

  useEffect(() => {
    if (profile?.role !== 'syringe_operator') {
      setActiveSyringeSession(null)
      return
    }

    const loadActiveSyringeSession = async () => {
      const { data } = await supabase
        .from('sa_sessions')
        .select('*, machine:sa_machines(*), assortment:sa_assortments(*)')
        .eq('operator_id', profile.id)
        .is('ended_at', null)
        .maybeSingle()
      setActiveSyringeSession((data as SaSession | null) ?? null)
    }

    void loadActiveSyringeSession()

    const channel = supabase
      .channel(`syringe-session-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sa_sessions', filter: `operator_id=eq.${profile.id}` },
        () => void loadActiveSyringeSession())
      .subscribe()
    const fallback = window.setInterval(loadActiveSyringeSession, 60000)

    return () => {
      window.clearInterval(fallback)
      supabase.removeChannel(channel)
    }
  }, [profile?.id, profile?.role])

  const navItems = profile?.role === 'admin'            ? NAV_ADMIN
    : profile?.role === 'specialist'      ? NAV_SPECIALIST
    : profile?.role === 'manager'         ? NAV_MANAGER
    : profile?.role === 'executive'       ? NAV_EXECUTIVE
    : profile?.role === 'viewer'          ? NAV_VIEWER
    : profile?.role === 'syringe_operator' ? NAV_SYRINGE_OPERATOR
    : NAV_OPERATOR
  const visibleActiveShift = profile?.role === 'operator' &&
    !shiftLoading &&
    activeShift &&
    !activeShift.ended_at &&
    (activeShift.operator_1_id === profile.id || activeShift.operator_2_id === profile.id)
      ? activeShift
      : null
  const visibleWorkSession = visibleActiveShift || activeSyringeSession
  const visibleActiveMachine = visibleActiveShift ? activeMachine : null
  const visibleWorkMachineName = activeSyringeSession?.machine?.name ?? visibleActiveMachine?.name
  const visibleWorkShiftType = activeSyringeSession?.shift_type ?? visibleActiveShift?.shift_type
  const visibleShiftOperators = visibleActiveShift
    ? [visibleActiveShift.operator_1?.full_name, visibleActiveShift.operator_2?.full_name].filter(Boolean).join(' / ')
    : ''

  const handleSignOut = async () => {
    if (profile?.role === 'viewer') sessionStorage.removeItem('margoline_viewer_demo_state')
    if (visibleWorkSession && (profile?.role === 'operator' || profile?.role === 'syringe_operator')) {
      setShowLogoutModal(true)
      return
    }
    await signOut()
    navigate('/login')
  }

  const confirmSignOut = async () => {
    setShowLogoutModal(false)
    if (profile?.role === 'viewer') sessionStorage.removeItem('margoline_viewer_demo_state')
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
        sidebarOpen ? 'w-[min(18rem,86vw)] md:w-64 translate-x-0' : 'w-0 md:w-16 -translate-x-full md:translate-x-0'
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
        {sidebarOpen && visibleWorkSession && (
          <div className="px-4 py-3 border-b border-navy-700 bg-brand/5 flex-shrink-0">
            <div className="text-xs font-bold text-brand uppercase tracking-wider mb-1">{visibleWorkMachineName}</div>
            <div className="text-xs text-navy-300">Zmiana {visibleWorkShiftType} · {visibleShiftOperators || profile?.full_name}</div>
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
              {profile?.role === 'admin' ? 'Administracja' : profile?.role === 'manager' ? 'Kierownik' : profile?.role === 'executive' ? 'Zarząd' : profile?.role === 'specialist' ? 'Specjalista' : profile?.role === 'viewer' ? 'Gość' : profile?.role === 'syringe_operator' ? 'Op. Strzykawek' : 'Operator'}
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
              visibleWorkSession
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
              <span>{visibleWorkSession ? 'Wyloguj (zmiana aktywna)' : 'Wyloguj się'}</span>
            )}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <div className="bg-navy-800/80 backdrop-blur border-b border-navy-700 px-3 py-3 sm:px-4 md:px-6 flex items-center gap-3 sm:gap-4 sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(v => !v)} className="rounded-lg p-2 -ml-2 text-navy-400 hover:bg-navy-700 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
              <line x1="3" y1="6" x2="19" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="3" y1="11" x2="19" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="3" y1="16" x2="19" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setLightTheme(v => !v)}
            className="theme-toggle"
            aria-label={lightTheme ? 'Przelacz na ciemne tlo' : 'Przelacz na jasne tlo'}
            title={lightTheme ? 'Ciemne tlo' : 'Jasne tlo'}
          >
            <span className="theme-toggle__thumb">
              {lightTheme ? (
                <svg width="16" height="16" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="4" fill="currentColor" />
                  <path d="M11 1.8v2.1M11 18.1v2.1M20.2 11h-2.1M3.9 11H1.8M17.5 4.5 16 6M6 16l-1.5 1.5M17.5 17.5 16 16M6 6 4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                  <path d="M17.8 14.3A7.6 7.6 0 0 1 7.7 4.2 8.4 8.4 0 1 0 17.8 14.3Z" fill="currentColor" />
                </svg>
              )}
            </span>
          </button>
          <button
            onClick={() => setTestModeEnabled(!testMode)}
            className={cn(
              'rounded-lg border px-3 py-2 text-xs font-bold transition-all',
              testMode
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                : 'border-navy-600 bg-navy-900 text-navy-400 hover:text-white'
            )}
          >
            {testMode ? 'TEST' : 'PROD'}
          </button>
          <div className="text-xs text-navy-400 font-mono">{time}</div>
        </div>
        <AlertProvider>
          <div className="flex-1 p-3 sm:p-4 md:p-6">
            <Outlet />
          </div>
        </AlertProvider>
      </main>
      <RobotAssistant />

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
                <div className="text-xs text-amber-400">{visibleWorkMachineName} · Zmiana {visibleWorkShiftType}</div>
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
