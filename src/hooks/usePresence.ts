import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

// ── Page labels ───────────────────────────────────────────────────────────────

const PAGE_LABELS: Record<string, string> = {
  '/operator':           'Panel operatora',
  '/operator/shift':     'Zarządzanie zmianą',
  '/operator/report':    'Wprowadzanie raportu',
  '/operator/history':   'Historia raportów',
  '/operator/failure':   'Zgłoszenie awarii',
  '/operator/tasks':     'Zadania',
  '/manager':            'Panel kierownika',
  '/manager/day-report': 'Raport dnia',
  '/manager/export':     'Eksport danych',
  '/manager/orders':     'Zlecenia',
  '/manager/plan':       'Plan produkcji',
  '/executive':          'Panel zarządu',
  '/executive/charts':   'Wykresy zarządcze',
  '/executive/machines': 'Automaty',
  '/executive/details':  'Szczegóły',
  '/executive/report':   'Raport dnia (zarząd)',
  '/admin':              'Panel admina',
  '/admin/users':        'Użytkownicy',
  '/admin/machines':     'Maszyny',
  '/admin/audit':        'Audit Log',
  '/admin/targets':      'Targety',
  '/admin/schedules':    'Harmonogramy',
  '/admin/orders':       'Zlecenia',
  '/admin/reset':        'Reset danych',
  '/specialist':         'Panel serwisu',
  '/login':              'Strona logowania',
}

function getPageLabel(pathname: string): string {
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname]
  const match = Object.keys(PAGE_LABELS)
    .filter(k => pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return match ? PAGE_LABELS[match] : pathname
}

// ── Singleton channel ─────────────────────────────────────────────────────────
// One channel instance for the entire app. Both usePresence (broadcaster)
// and usePresenceList (consumer) share it to avoid the
// "cannot add presence callbacks after subscribe()" error.

export type PresenceUser = {
  user_id:   string
  full_name: string
  role:      string
  page:      string
  path:      string
  online_at: string
}

type PresenceListener = (users: PresenceUser[]) => void

const CHANNEL_NAME = 'margoline-presence-v1'
const HEARTBEAT_MS = 25_000

let _ch: ReturnType<typeof supabase.channel> | null = null
let _ready = false
let _listeners: Set<PresenceListener> = new Set()

function getUsers(): PresenceUser[] {
  if (!_ch) return []
  return Object.values(_ch.presenceState<PresenceUser>())
    .flat()
    .filter(u => u.user_id && u.full_name)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

function notifyListeners() {
  const users = getUsers()
  _listeners.forEach(fn => fn(users))
}

function ensureChannel() {
  if (_ch) return _ch
  _ch = supabase
    .channel(CHANNEL_NAME, { config: { presence: { key: 'shared' } } })
    .on('presence', { event: 'sync'  }, notifyListeners)
    .on('presence', { event: 'join'  }, notifyListeners)
    .on('presence', { event: 'leave' }, notifyListeners)

  _ch.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      _ready = true
      notifyListeners()
    }
  })
  return _ch
}

function trackState(state: PresenceUser) {
  const ch = ensureChannel()
  if (_ready) {
    ch.track(state).catch(() => undefined)
  } else {
    // Wait until subscribed
    const poll = setInterval(() => {
      if (_ready) { clearInterval(poll); ch.track(state).catch(() => undefined) }
    }, 200)
  }
}

// ── usePresence — call once in AppLayout ─────────────────────────────────────

export function usePresence() {
  const { profile } = useAuthStore()
  const location = useLocation()

  useEffect(() => {
    if (!profile) return

    const state: PresenceUser = {
      user_id:   profile.id,
      full_name: profile.full_name,
      role:      profile.role,
      page:      getPageLabel(location.pathname),
      path:      location.pathname,
      online_at: new Date().toISOString(),
    }

    trackState(state)

    const interval = setInterval(() => {
      trackState({ ...state, online_at: new Date().toISOString() })
    }, HEARTBEAT_MS)

    return () => clearInterval(interval)
  }, [profile?.id, location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps
}

// ── usePresenceList — call in admin/manager panels ───────────────────────────

export function usePresenceList(onChange: PresenceListener) {
  useEffect(() => {
    ensureChannel()
    _listeners.add(onChange)
    // Deliver current state immediately if already synced
    if (_ready) onChange(getUsers())
    return () => { _listeners.delete(onChange) }
  }, [onChange])
}
