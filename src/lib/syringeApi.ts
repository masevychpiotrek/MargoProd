import { supabase } from './supabase'
import type { QueryClient } from '@tanstack/react-query'
import type { SaSession } from '@/types/database'

export const SYRINGE_RESET_EVENT = 'margoline:syringe-reset'
export const SYRINGE_RESET_STORAGE_KEY = 'margoline_syringe_reset_at'

export async function closeExpiredSyringeSessions(machineId?: string) {
  const { error } = await supabase.rpc('sa_close_expired_sessions', { p_machine: machineId ?? null })
  // Keep older installations usable until migration 075 is installed.
  if (error && error.code !== 'PGRST202') throw error
}

export async function fetchMySyringeSession(operatorId: string) {
  await closeExpiredSyringeSessions()
  const { data, error } = await supabase.from('sa_sessions')
    .select('*, machine:sa_machines(*), assortment:sa_assortments(*), order:sa_orders(*)')
    .eq('operator_id', operatorId).is('ended_at', null).order('started_at', { ascending: false })
  if (error) throw error
  if (data && data.length > 1) throw new Error('Masz więcej niż jedną otwartą zmianę. Kierownik musi zamknąć nadmiarową zmianę.')
  return (data?.[0] ?? null) as SaSession | null
}

export async function syringeCommand(action: string, payload: Record<string, unknown>) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20000)
  let response
  try {
    response = await supabase.rpc('sa_session_command', { p_action: action, p_payload: payload }).abortSignal(controller.signal)
  } finally {
    window.clearTimeout(timeout)
  }
  if (controller.signal.aborted) throw new Error('Nie otrzymano potwierdzenia w ciągu 20 sekund. Ponów zapis bez zmiany formularza; operacja nie zostanie naliczona ponownie.')
  const { data, error } = response
  if (error) {
    if (error.code === 'PGRST202') throw new Error('Moduł wymaga aktualizacji bazy: migracja 060_syringe_workflow_hardening.sql.')
    throw new Error(error.message)
  }
  if (!data) throw new Error('Nie otrzymano potwierdzenia zapisu. Odśwież dane przed ponowną próbą.')
  return data
}

export function invalidateSyringe(qc: QueryClient) {
  return qc.invalidateQueries({ predicate: query => /^(sa_|admin_sa_)/.test(String(query.queryKey[0])) })
}

export function clearSyringeQueries(qc: QueryClient) {
  qc.removeQueries({ predicate: query => /^(sa_|admin_sa_)/.test(String(query.queryKey[0])) })
  return invalidateSyringe(qc)
}

export function notifySyringeReset() {
  const stamp = String(Date.now())
  localStorage.setItem(SYRINGE_RESET_STORAGE_KEY, stamp)
  window.dispatchEvent(new CustomEvent(SYRINGE_RESET_EVENT, { detail: { stamp } }))
}
