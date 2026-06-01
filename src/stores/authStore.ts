import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import { supabase, logAudit } from '@/lib/supabase'
import type { Profile, UserRole } from '@/types/database'

interface AuthState {
  user: User | null
  session: Session | null
  profile: Profile | null
  isLoading: boolean
  isInitialized: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  hasRole: (role: UserRole | UserRole[]) => boolean
}

let authListenerSet = false
let initInFlight: Promise<void> | null = null
const AUTH_TIMEOUT_MS = 10000

function withTimeout<T>(promise: PromiseLike<T>, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), AUTH_TIMEOUT_MS)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timeoutId))
}

async function loadProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data as Profile | null
}

function isUsableProfile(profile: Profile | null) {
  return !!profile && profile.is_active && !profile.deleted_at
}

function mapAuthError(message: string) {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('invalid login credentials') ||
    normalized.includes('invalid_grant') ||
    normalized.includes('email not confirmed') ||
    normalized.includes('invalid credentials')
  ) {
    return 'Nieprawidlowy e-mail lub haslo.'
  }

  return message || 'Blad logowania.'
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  session: null,
  profile: null,
  isLoading: false,
  isInitialized: false,

  initialize: async () => {
    if (get().isInitialized) return
    if (initInFlight) return initInFlight

    initInFlight = (async () => {
      set({ isLoading: true })

      try {
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          'Sprawdzanie sesji trwa zbyt dlugo.'
        )
        if (session?.user) {
          const profile = await withTimeout(
            loadProfile(session.user.id),
            'Ladowanie profilu trwa zbyt dlugo.'
          )
          if (isUsableProfile(profile)) {
            set({ user: session.user, session, profile })
          } else {
            await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
            set({ user: null, session: null, profile: null })
          }
        } else {
          set({ user: null, session: null, profile: null })
        }
      } catch {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
        set({ user: null, session: null, profile: null })
      } finally {
        set({ isLoading: false, isInitialized: true })
        initInFlight = null
      }
    })()

    await initInFlight

    if (!authListenerSet) {
      authListenerSet = true
      supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          set({ user: null, session: null, profile: null, isInitialized: true })
          return
        }

        if (session?.user && ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
          const currentProfile = get().profile
          set({
            user: session.user,
            session,
            profile: currentProfile?.id === session.user.id ? currentProfile : null,
            isInitialized: true
          })

          window.setTimeout(() => {
            loadProfile(session.user.id)
              .then(profile => {
                set({
                  user: session.user,
                  session,
                  profile: isUsableProfile(profile) ? profile : null,
                  isInitialized: true
                })
              })
              .catch(() => {
                set({ user: session.user, session, profile: currentProfile?.id === session.user.id ? currentProfile : null, isInitialized: true })
              })
          }, 0)
        }
      })
    }
  },

  signIn: async (email, password) => {
    set({
      isLoading: true,
      user: null,
      session: null,
      profile: null,
      isInitialized: true
    })

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      })
      if (error) return { error: mapAuthError(error.message) }
      if (!data.session) return { error: 'Brak sesji po zalogowaniu.' }

      const profile = await loadProfile(data.user.id)
      if (!profile) {
        await supabase.auth.signOut({ scope: 'local' })
        return { error: 'Konto istnieje, ale nie ma profilu w systemie. Sprawdz panel admina.' }
      }

      if (!isUsableProfile(profile)) {
        await supabase.auth.signOut({ scope: 'local' })
        return { error: 'Konto jest nieaktywne. Skontaktuj sie z administratorem.' }
      }

      set({
        user: data.user,
        session: data.session,
        profile,
        isLoading: false,
        isInitialized: true
      })

      await logAudit('login')
      return { error: null }
    } catch (e: unknown) {
      return { error: e instanceof Error ? mapAuthError(e.message) : 'Blad logowania.' }
    } finally {
      set({ isLoading: false })
    }
  },

  signOut: async () => {
    await logAudit('logout')
    await supabase.auth.signOut({ scope: 'local' })
    set({ user: null, session: null, profile: null, isInitialized: true })
  },

  refreshProfile: async () => {
    const { user } = get()
    if (!user) return
    const profile = await loadProfile(user.id)
    if (profile) set({ profile })
  },

  hasRole: (role) => {
    const { profile } = get()
    if (!profile) return false
    if (Array.isArray(role)) return role.includes(profile.role)
    return profile.role === role
  }
}))
