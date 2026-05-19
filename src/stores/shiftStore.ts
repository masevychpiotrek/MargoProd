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
  endShift: () => Promise<void>
  loadActiveShift: () => Promise<void>
}

export const useShiftStore = create<ShiftState>()(
  persist(
    (set, get) => ({
      activeShift: null,
      activeMachine: null,
      isLoading: false,

      startShift: async (machineId, shiftType, operator2Id) => {
        const profile = useAuthStore.getState().profile
        if (!profile) return { error: 'Brak zalogowanego użytkownika' }

        set({ isLoading: true })
        try {
          const today = new Date().toISOString().split('T')[0]

          // Sprawdź czy zmiana już istnieje
          const { data: existing } = await supabase
            .from('shifts')
            .select('*')
            .eq('machine_id', machineId)
            .eq('shift_date', today)
            .eq('shift_type', shiftType)
            .is('ended_at', null)
            .maybeSingle()

          if (existing) {
            // Wznów istniejącą zmianę
            const { data: machine } = await supabase
              .from('machines').select('*').eq('id', machineId).single()
            set({ activeShift: existing, activeMachine: machine })
            return { error: null }
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
        if (!activeShift) return

        await supabase
          .from('shifts')
          .update({ ended_at: new Date().toISOString() })
          .eq('id', activeShift.id)

        await logAudit('shift_end', 'shifts', activeShift.id)
        set({ activeShift: null, activeMachine: null })
      },

      loadActiveShift: async () => {
        const profile = useAuthStore.getState().profile
        if (!profile) return

        const today = new Date().toISOString().split('T')[0]

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

        // Żadna aktywna zmiana nie znaleziona w bazie —
        // jeśli store trzymał zmianę (np. zamkniętą automatycznie przez system),
        // wyczyść go żeby UI pokazało poprawny stan
        const { activeShift } = get()
        if (activeShift) {
          set({ activeShift: null, activeMachine: null })
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
