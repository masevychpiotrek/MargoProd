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

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  session: null,
  profile: null,
  isLoading: false,
  isInitialized: false,

  initialize: async () => {
    if (get().isInitialized) return
    set({ isLoading: true })

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const profile = await loadProfile(session.user.id)
        if (isUsableProfile(profile)) {
          set({ user: session.user, session, profile })
        } else {
          await supabase.auth.signOut({ scope: 'local' })
          set({ user: null, session: null, profile: null })
        }
      } else {
        set({ user: null, session: null, profile: null })
      }
    } catch {
      set({ user: null, session: null, profile: null })
    } finally {
      set({ isLoading: false, isInitialized: true })
    }

    if (!authListenerSet) {
      authListenerSet = true
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_OUT') {
          set({ user: null, session: null, profile: null, isInitialized: true })
          return
        }

        if (session?.user && ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
          try {
            const profile = await loadProfile(session.user.id)
            set({
              user: session.user,
              session,
              profile: isUsableProfile(profile) ? profile : null,
              isInitialized: true
            })
          } catch {
            set({ user: session.user, session, profile: null, isInitialized: true })
          }
        }
      })
    }
  },

  signIn: async (email, password) => {
    set({ isLoading: true })
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      })
      if (error) return { error: error.message }
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
      return { error: e instanceof Error ? e.message : 'Blad logowania' }
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
