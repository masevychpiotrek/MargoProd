import { supabase } from '@/lib/supabase'
import { buildOperatorWork, type WorkShift, type WorkReport, type WorkSession } from './operatorWork'

// Fetch every page: PostgREST's default row cap must not truncate a monthly ranking.
async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const result: T[] = []
  for (let from = 0; ; from += 500) {
    const response = await query(from, from + 499)
    if (response.error) throw new Error(response.error.message)
    const rows = (response.data ?? []) as T[]
    result.push(...rows)
    if (rows.length < 500) return result
  }
}
export async function fetchOperatorWork(from: string, to: string) {
  const [shifts, reports, sessions, machines, syringeMachines] = await Promise.all([
    pages<WorkShift>((a, b) => supabase.from('shifts').select('*, operator_1:profiles!operator_1_id(full_name), operator_2:profiles!operator_2_id(full_name)').gte('shift_date', from).lte('shift_date', to).order('id').range(a, b)),
    pages<WorkReport>((a, b) => supabase.from('hourly_reports').select('*, operator:profiles!operator_id(full_name)').gte('report_date', from).lte('report_date', to).is('deleted_at', null).order('id').range(a, b)),
    pages<WorkSession>((a, b) => supabase.from('sa_sessions').select('*, operator:profiles!operator_id(full_name), assortment:sa_assortments!assortment_id(name)').gte('session_date', from).lte('session_date', to).order('id').range(a, b)),
    pages<{ id: string; name: string }>((a, b) => supabase.from('machines').select('id, name').order('id').range(a, b)),
    pages<{ id: string; name: string }>((a, b) => supabase.from('sa_machines').select('id, name').order('id').range(a, b)),
  ])
  return buildOperatorWork(shifts, reports, sessions, Object.fromEntries(machines.map(m => [m.id, m.name])), Object.fromEntries(syringeMachines.map(m => [m.id, m.name])))
}
