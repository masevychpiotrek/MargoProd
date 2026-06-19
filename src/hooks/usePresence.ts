import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

const PAGE_LABELS: Record<string, string> = {
  '/operator':          'Panel operatora',
  '/operator/shift':    'Zarządzanie zmianą',
  '/operator/report':   'Wprowadzanie raportu',
  '/operator/history':  'Historia raportów',
  '/operator/failure':  'Zgłoszenie awarii',
  '/operator/tasks':    'Zadania',
  '/manager':           'Panel kierownika',
  '/manager/day-report':'Raport dnia',
  '/manager/export':    'Eksport danych',
  '/manager/orders':    'Zlecenia',
  '/manager/plan':      'Plan produkcji',
  '/executive':         'Panel zarządu',
  '/executive/charts':  'Wykresy zarządcze',
  '/executive/machines':'Automaty',
  '/executive/details': 'Szczegóły',
  '/executive/report':  'Raport dnia (zarząd)',
  '/admin':             'Panel admina',
  '/admin/users':       'Użytkownicy',
  '/admin/machines':    'Maszyny',
  '/admin/audit':       'Audit Log',
  '/admin/targets':     'Targety',
  '/admin/schedules':   'Harmonogramy',
  '/admin/orders':      'Zlecenia',
  '/admin/reset':       'Reset danych',
  '/specialist':        'Panel serwisu',
  '/login':             'Strona logowania',
}

function getPageLabel(pathname: string): string {
  // exact match first, then prefix match (longest wins)
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname]
  const match = Object.keys(PAGE_LABELS)
    .filter(k => pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return match ? PAGE_LABELS[match] : pathname
}

const CHANNEL_NAME = 'margoline:presence'
const HEARTBEAT_MS = 25000

export function usePresence() {
  const { profile } = useAuthStore()
  const location = useLocation()
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!profile) return

    const state = {
      user_id:    profile.id,
      full_name:  profile.full_name,
      role:       profile.role,
      page:       getPageLabel(location.pathname),
      path:       location.pathname,
      online_at:  new Date().toISOString(),
    }

    if (!channelRef.current) {
      channelRef.current = supabase.channel(CHANNEL_NAME, {
        config: { presence: { key: profile.id } }
      })
      channelRef.current.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channelRef.current!.track(state)
        }
      })
    } else {
      channelRef.current.track({ ...state, online_at: new Date().toISOString() }).catch(() => undefined)
    }

    // Heartbeat so `online_at` stays fresh
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      channelRef.current?.track({ ...state, path: location.pathname, page: getPageLabel(location.pathname), online_at: new Date().toISOString() }).catch(() => undefined)
    }, HEARTBEAT_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [profile, location.pathname])

  // Untrack on unmount (logout / tab close handled by Supabase automatically)
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      channelRef.current?.untrack().catch(() => undefined)
      channelRef.current?.unsubscribe()
      channelRef.current = null
    }
  }, [])
}

// ── Consumer hook for admin/manager panels ────────────────────────────────────

export type PresenceUser = {
  user_id: string
  full_name: string
  role: string
  page: string
  path: string
  online_at: string
}

export function usePresenceList() {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const subscribe = (onChange: (users: PresenceUser[]) => void) => {
    channelRef.current?.unsubscribe()
    const ch = supabase.channel(CHANNEL_NAME, {
      config: { presence: { key: 'observer' } }
    })
    channelRef.current = ch

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<PresenceUser>()
      const users = Object.values(state)
        .flat()
        .filter(u => u.user_id && u.full_name)
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
      onChange(users)
    })

    ch.subscribe()
    return () => { ch.unsubscribe(); channelRef.current = null }
  }

  return { subscribe }
}
