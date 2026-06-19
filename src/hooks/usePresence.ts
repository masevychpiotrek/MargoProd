import { useEffect, useRef } from 'react'
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

// ── Types ─────────────────────────────────────────────────────────────────────

export type PresenceUser = {
  user_id:   string
  full_name: string
  role:      string
  page:      string
  path:      string
  online_at: string
}

type PresenceListener = (users: PresenceUser[]) => void

// ── Module-level singleton ────────────────────────────────────────────────────
// ONE channel per app. key = logged-in user's ID so Supabase deduplicates
// correctly. Multiple tabs of the same user appear as an array under their key;
// we always show the most recent one.

const CHANNEL_NAME = 'margoline-presence-v2'
const HEARTBEAT_MS = 30_000

let _ch:       ReturnType<typeof supabase.channel> | null = null
let _userId:   string | null = null
let _ready     = false
const _listeners = new Set<PresenceListener>()

function getDeduplicatedUsers(): PresenceUser[] {
  if (!_ch) return []
  const state = _ch.presenceState<PresenceUser>()
  // Each key = one user_id. The value is an array (multiple tabs).
  // Pick the entry with the latest online_at per user.
  const byUser: Record<string, PresenceUser> = {}
  for (const entries of Object.values(state)) {
    for (const entry of entries) {
      if (!entry.user_id || !entry.full_name) continue
      const existing = byUser[entry.user_id]
      if (!existing || entry.online_at > existing.online_at) {
        byUser[entry.user_id] = entry
      }
    }
  }
  return Object.values(byUser).sort((a, b) => a.full_name.localeCompare(b.full_name))
}

function notifyListeners() {
  const users = getDeduplicatedUsers()
  _listeners.forEach(fn => fn(users))
}

function initChannel(userId: string) {
  // Already set up for this user — nothing to do
  if (_ch && _userId === userId) return

  // Different user (re-login) or first call — tear down old channel
  if (_ch) {
    _ch.untrack().catch(() => undefined)
    _ch.unsubscribe()
    _ch = null
    _ready = false
  }

  _userId = userId
  _ch = supabase
    .channel(CHANNEL_NAME, { config: { presence: { key: userId } } })
    .on('presence', { event: 'sync'  }, notifyListeners)
    .on('presence', { event: 'join'  }, notifyListeners)
    .on('presence', { event: 'leave' }, notifyListeners)

  _ch.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      _ready = true
      notifyListeners()
    }
  })
}

function track(state: PresenceUser) {
  if (!_ch) return
  if (_ready) {
    _ch.track(state).catch(() => undefined)
  } else {
    // Retry until subscribed
    const t = setInterval(() => {
      if (_ready && _ch) { clearInterval(t); _ch.track(state).catch(() => undefined) }
    }, 300)
  }
}

// ── usePresence — mounted once in AppLayout ───────────────────────────────────

export function usePresence() {
  const { profile } = useAuthStore()
  const location    = useLocation()
  const heartbeat   = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!profile) return

    initChannel(profile.id)

    const state: PresenceUser = {
      user_id:   profile.id,
      full_name: profile.full_name,
      role:      profile.role,
      page:      getPageLabel(location.pathname),
      path:      location.pathname,
      online_at: new Date().toISOString(),
    }

    track(state)

    if (heartbeat.current) clearInterval(heartbeat.current)
    heartbeat.current = setInterval(() => {
      track({ ...state, online_at: new Date().toISOString() })
    }, HEARTBEAT_MS)

    return () => {
      if (heartbeat.current) clearInterval(heartbeat.current)
    }
  }, [profile?.id, location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Untrack on logout / unmount
  useEffect(() => {
    return () => {
      if (heartbeat.current) clearInterval(heartbeat.current)
      _ch?.untrack().catch(() => undefined)
    }
  }, [])
}

// ── usePresenceList — admin/manager panels ────────────────────────────────────
// Just registers a listener on the shared singleton; no new channel created.

export function usePresenceList(onChange: PresenceListener) {
  useEffect(() => {
    _listeners.add(onChange)
    // If channel already ready, push current state immediately
    if (_ready) onChange(getDeduplicatedUsers())
    return () => { _listeners.delete(onChange) }
  }, [onChange])
}
