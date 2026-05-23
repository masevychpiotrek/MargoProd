import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      session: null,
      profile: null,
      isLoading: false,
      isInitialized: false,

      initialize: async () => {
        set({ isLoading: true })
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (session?.user) {
            const { data: profile } = await supabase
              .from('profiles').select('*').eq('id', session.user.id).single()
            set({ user: session.user, session, profile: profile ?? null })
          } else {
            set({ user: null, session: null, profile: null })
          }
        } catch {
          set({ user: null, session: null, profile: null })
        } finally {
          set({ isLoading: false, isInitialized: true })
        }

        // Listen for auth changes — set isLoading during transition
        supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN' && session?.user) {
            // Don't re-fetch if we already have the profile for this user
            const current = get()
            if (current.profile?.id === session.user.id) return
            set({ isLoading: true })
            try {
              const { data: profile } = await supabase
                .from('profiles').select('*').eq('id', session.user.id).single()
              set({ user: session.user, session, profile: profile ?? null })
            } finally {
              set({ isLoading: false })
            }
          } else if (event === 'SIGNED_OUT') {
            set({ user: null, session: null, profile: null })
          }
        })
      },

      signIn: async (email, password) => {
        set({ isLoading: true })
        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password })
          if (error) return { error: error.message }
          if (!data.session) return { error: 'Brak sesji' }

          const { data: profile } = await supabase
            .from('profiles').select('*').eq('id', data.user.id).single()

          if (!profile?.is_active) {
            await supabase.auth.signOut()
            return { error: 'Konto jest nieaktywne. Skontaktuj się z administratorem.' }
          }

          set({ user: data.user, session: data.session, profile })
          await logAudit('login')
          return { error: null }
        } finally {
          set({ isLoading: false })
        }
      },

      signOut: async () => {
        await logAudit('logout')
        await supabase.auth.signOut()
        set({ user: null, session: null, profile: null })
      },

      refreshProfile: async () => {
        const { user } = get()
        if (!user) return
        const { data } = await supabase
          .from('profiles').select('*').eq('id', user.id).single()
        if (data) set({ profile: data })
      },

      hasRole: (role) => {
        const { profile } = get()
        if (!profile) return false
        if (Array.isArray(role)) return role.includes(profile.role)
        return profile.role === role
      }
    }),
    {
      name: 'margoline-auth',
      partialize: (state) => ({ user: state.user, session: state.session, profile: state.profile })
    }
  )
)
