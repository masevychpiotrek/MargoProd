import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Shift, ShiftType, Machine } from '@/types/database'
import { supabase, logAudit } from '@/lib/supabase'
import { useAuthStore } from './authStore'
import { getShiftAutoCloseAt, getShiftDateForStart, isShiftPastAutoClose } from '@/lib/utils'

function sameShiftState(
  currentShift: Shift | null,
  nextShift: Shift | null,
  currentMachine: Machine | null,
  nextMachine: Machine | null
) {
  return currentShift?.id === nextShift?.id &&
    currentShift?.ended_at === nextShift?.ended_at &&
    currentShift?.operator_1_id === nextShift?.operator_1_id &&
    currentShift?.operator_2_id === nextShift?.operator_2_id &&
    currentMachine?.id === nextMachine?.id
}

interface ShiftState {
  activeShift: Shift | null
  activeMachine: Machine | null
  isLoading: boolean

  startShift: (machineId: string, shiftType: ShiftType, operator2Id?: string) => Promise<{ error: string | null }>
  endShift: () => Promise<{ error: string | null }>
  reopenShift: (shiftId: string) => Promise<{ error: string | null }>
  loadActiveShift: () => Promise<void>
}

async function autoCloseShiftIfExpired(shift: Shift): Promise<boolean> {
  if (shift.ended_at || !isShiftPastAutoClose(shift.shift_date, shift.shift_type)) return false

  const endedAt = getShiftAutoCloseAt(shift.shift_date, shift.shift_type).toISOString()
  const note = shift.notes ? `${shift.notes}\nAutozamkniecie po buforze 60 min` : 'Autozamkniecie po buforze 60 min'
  const { error } = await supabase
    .from('shifts')
    .update({ ended_at: endedAt, notes: note })
    .eq('id', shift.id)

  if (error) return false

  logAudit('shift_end', 'shifts', shift.id, undefined, { ended_at: endedAt, auto_closed: true }).catch(() => undefined)
  return true
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
          const shiftDate = getShiftDateForStart(shiftType)

          // Sprawdź czy zmiana już istnieje
          const { data: existing } = await supabase
            .from('shifts')
            .select('id')
            .eq('machine_id', machineId)
            .eq('shift_date', shiftDate)
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
              shift_date: shiftDate
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

        const { data: savedShift, error: verifyError } = await supabase
          .from('shifts')
          .select('id, ended_at')
          .eq('id', activeShift.id)
          .single()

        if (verifyError || !savedShift?.ended_at) {
          set({ isLoading: false })
          return {
            error: verifyError?.message ??
              'Baza nie zapisała zakończenia zmiany. Sprawdź politykę UPDATE dla tabeli shifts.'
          }
        }

        logAudit('shift_end', 'shifts', activeShift.id, undefined, { ended_at: endedAt }).catch(() => undefined)
        set({ activeShift: null, activeMachine: null, isLoading: false })
        return { error: null }
      },

      reopenShift: async (shiftId) => {
        set({ isLoading: true })
        const { data: shift, error } = await supabase
          .from('shifts')
          .update({ ended_at: null })
          .eq('id', shiftId)
          .select('*, machine:machines(*)')
          .single()

        if (error || !shift) {
          set({ isLoading: false })
          return { error: error?.message ?? 'Nie udalo sie przywrocic zmiany.' }
        }

        const machine = shift.machine as Machine
        logAudit('shift_start', 'shifts', shift.id, undefined, { reopened: true }).catch(() => undefined)
        set({ activeShift: shift, activeMachine: machine, isLoading: false })
        return { error: null }
      },

      loadActiveShift: async () => {
        const profile = useAuthStore.getState().profile
        if (!profile || profile.role !== 'operator') {
          const state = get()
          if (state.activeShift || state.activeMachine || state.isLoading) {
            set({ activeShift: null, activeMachine: null, isLoading: false })
          }
          return
        }

        const initialState = get()
        if (initialState.isLoading && !initialState.activeShift) set({ isLoading: true })
        try {
          // Szukaj jako operator_1
          const { data: asOp1 } = await supabase
            .from('shifts')
            .select('*, machine:machines(*), operator_1:profiles!operator_1_id(*), operator_2:profiles!operator_2_id(*)')
            .eq('operator_1_id', profile.id)
            .is('ended_at', null)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (asOp1) {
            if (await autoCloseShiftIfExpired(asOp1 as Shift)) {
              set({ activeShift: null, activeMachine: null, isLoading: false })
              return
            }
            const machine = asOp1.machine as Machine
            const state = get()
            if (!sameShiftState(state.activeShift, asOp1, state.activeMachine, machine) || state.isLoading) {
              set({ activeShift: asOp1, activeMachine: machine, isLoading: false })
            }
            return
          }

          // Szukaj jako operator_2
          const { data: asOp2 } = await supabase
            .from('shifts')
            .select('*, machine:machines(*), operator_1:profiles!operator_1_id(*), operator_2:profiles!operator_2_id(*)')
            .eq('operator_2_id', profile.id)
            .is('ended_at', null)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (asOp2) {
            if (await autoCloseShiftIfExpired(asOp2 as Shift)) {
              set({ activeShift: null, activeMachine: null, isLoading: false })
              return
            }
            const machine = asOp2.machine as Machine
            const state = get()
            if (!sameShiftState(state.activeShift, asOp2, state.activeMachine, machine) || state.isLoading) {
              set({ activeShift: asOp2, activeMachine: machine, isLoading: false })
            }
            return
          }

          // Brak aktywnej zmiany w bazie: wyczyść stan zapamiętany w przeglądarce.
          const state = get()
          if (state.activeShift || state.activeMachine || state.isLoading) {
            set({ activeShift: null, activeMachine: null, isLoading: false })
          }
        } finally {
          if (get().isLoading) set({ isLoading: false })
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
