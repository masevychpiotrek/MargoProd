import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Shift, ShiftType, Machine } from '@/types/database'
import { supabase, logAudit } from '@/lib/supabase'
import { useAuthStore } from './authStore'

interface ShiftState {
  activeShift: Shift | null
  activeMachine: Machine | null
  isLoading: boolean

  startShift: (machineId: string, shiftType: ShiftType, operator2Id?: string) => Promise<{ error: string | null }>
  endShift: () => Promise<{ error: string | null }>
  loadActiveShift: () => Promise<void>
}

export const useShiftStore = create<ShiftState>()(
  persist(
    (set, get) => ({
      activeShift: null,
      activeMachine: null,
      isLoading: true,

      startShift: async (machineId, shiftType, operator2Id) => {
        const profile = useAuthStore.getState().profile
        if (!profile) return { error: 'Brak zalogowanego użytkownika' }

        set({ isLoading: true })
        try {
          const today = new Date().toISOString().split('T')[0]

          // Sprawdź czy zmiana już istnieje
          const { data: existing } = await supabase
            .from('shifts')
            .select('id')
            .eq('machine_id', machineId)
            .eq('shift_date', today)
            .eq('shift_type', shiftType)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (existing) {
            return { error: 'Ta zmiana juz istnieje na tej maszynie. Nie mozna uruchomic jej drugi raz.' }
          }

          // Utwórz nową zmianę
          const { data: shift, error } = await supabase
            .from('shifts')
            .insert({
              machine_id: machineId,
              operator_1_id: profile.id,
              operator_2_id: operator2Id ?? null,
              shift_type: shiftType,
              shift_date: today
            })
            .select('*')
            .single()

          if (error || !shift) return { error: error?.message ?? 'Błąd tworzenia zmiany' }

          const { data: machine } = await supabase
            .from('machines').select('*').eq('id', machineId).single()

          set({ activeShift: shift, activeMachine: machine })
          await logAudit('shift_start', 'shifts', shift.id, undefined, { machine_id: machineId, shift_type: shiftType })
          return { error: null }
        } finally {
          set({ isLoading: false })
        }
      },

      endShift: async () => {
        const { activeShift } = get()
        if (!activeShift) return { error: null }

        set({ isLoading: true })
        const endedAt = new Date().toISOString()
        const { error } = await supabase
          .from('shifts')
          .update({ ended_at: endedAt })
          .eq('id', activeShift.id)

        if (error) {
          set({ isLoading: false })
          return { error: error.message }
        }

        logAudit('shift_end', 'shifts', activeShift.id, undefined, { ended_at: endedAt }).catch(() => undefined)
        set({ activeShift: null, activeMachine: null, isLoading: false })
        return { error: null }
      },

      loadActiveShift: async () => {
        const profile = useAuthStore.getState().profile
        if (!profile || profile.role !== 'operator') {
          set({ activeShift: null, activeMachine: null, isLoading: false })
          return
        }

        set({ isLoading: true })
        const today = new Date().toISOString().split('T')[0]

        try {
          // Szukaj jako operator_1
          const { data: asOp1 } = await supabase
            .from('shifts')
            .select('*, machine:machines(*)')
            .eq('operator_1_id', profile.id)
            .eq('shift_date', today)
            .is('ended_at', null)
            .maybeSingle()

          if (asOp1) {
            set({ activeShift: asOp1, activeMachine: asOp1.machine as Machine })
            return
          }

          // Szukaj jako operator_2
          const { data: asOp2 } = await supabase
            .from('shifts')
            .select('*, machine:machines(*)')
            .eq('operator_2_id', profile.id)
            .eq('shift_date', today)
            .is('ended_at', null)
            .maybeSingle()

          if (asOp2) {
            set({ activeShift: asOp2, activeMachine: asOp2.machine as Machine })
            return
          }

          // Brak aktywnej zmiany w bazie: wyczyść stan zapamiętany w przeglądarce.
          set({ activeShift: null, activeMachine: null })
        } finally {
          set({ isLoading: false })
        }
      }
    }),
    {
      name: 'margoprod-shift',
      partialize: (state) => ({
        activeShift: state.activeShift,
        activeMachine: state.activeMachine
      })
    }
  )
)
