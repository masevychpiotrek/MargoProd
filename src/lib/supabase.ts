import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Brak zmiennych środowiskowych VITE_SUPABASE_URL lub VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage
  },
  realtime: {
    params: { eventsPerSecond: 10 }
  }
})

// ---- Query helpers ----

export const getActiveShift = async (machineId: string, shiftDate: string, shiftType: string) => {
  return supabase
    .from('shifts')
    .select('*, machine:machines(*), operator_1:profiles!operator_1_id(*), operator_2:profiles!operator_2_id(*)')
    .eq('machine_id', machineId)
    .eq('shift_date', shiftDate)
    .eq('shift_type', shiftType)
    .is('ended_at', null)
    .maybeSingle()
}

export const getTodayReports = async (shiftId: string) => {
  return supabase
    .from('hourly_reports')
    .select('*, downtime_events(*)')
    .eq('shift_id', shiftId)
    .is('deleted_at', null)
    .order('hour_start', { ascending: true })
}

export const getMachines = async () => {
  return supabase
    .from('machines')
    .select('*')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('code')
}

export const getProfiles = async () => {
  return supabase
    .from('profiles')
    .select('*')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('full_name')
}

// Log audit event
export const logAudit = async (
  action: string,
  tableName?: string,
  recordId?: string,
  oldValues?: Record<string, unknown>,
  newValues?: Record<string, unknown>
) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  await supabase.from('audit_logs').insert({
    user_id: session.user.id,
    action: action as never,
    table_name: tableName,
    record_id: recordId,
    old_values: oldValues ?? null,
    new_values: newValues ?? null,
    user_agent: navigator.userAgent
  })
}

// Placeholder for generated types — uncomment after running supabase gen types
// import type { Database } from './database.types'
export type { Database }
