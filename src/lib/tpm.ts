import { supabase } from '@/lib/supabase'
import type { IssueStatus } from '@/types/tpm'

/** Zmiana produkcyjna na podstawie aktualnej godziny */
export function currentShift(): 'I' | 'II' | 'III' {
  const h = new Date().getHours()
  if (h >= 6 && h < 14) return 'I'
  if (h >= 14 && h < 22) return 'II'
  return 'III'
}

/** Zapis wpisu w historii zgłoszenia (audyt — nie nadpisuje) */
export async function logIssueHistory(params: {
  issueId: string
  userId: string
  action: string
  oldStatus?: string | null
  newStatus?: string | null
  oldValue?: string | null
  newValue?: string | null
  comment?: string | null
}) {
  await supabase.from('tpm_issue_history').insert({
    issue_id: params.issueId,
    user_id: params.userId,
    action: params.action,
    old_status: params.oldStatus ?? null,
    new_status: params.newStatus ?? null,
    old_value: params.oldValue ?? null,
    new_value: params.newValue ?? null,
    comment: params.comment ?? null
  })
}

/** Upload pliku do bucketu i zwrot publicznego URL */
export async function uploadTpmMedia(file: File, folder = 'tpm'): Promise<string | null> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('failure-photos').upload(path, file, {
    cacheControl: '3600',
    upsert: false
  })
  if (error) { console.error('upload error', error); return null }
  return supabase.storage.from('failure-photos').getPublicUrl(path).data.publicUrl
}

/** Powiadomienie w systemie (typ 'alarm' istnieje w enumie notification_type) */
export async function notifyUsers(userIds: string[], title: string, body: string, machineId?: string) {
  if (userIds.length === 0) return
  await supabase.from('notifications').insert(
    userIds.map(uid => ({
      user_id: uid,
      type: 'alarm' as const,
      title,
      body,
      machine_id: machineId ?? null
    }))
  )
}

/** Pobierz id użytkowników o danych rolach (do powiadomień) */
export async function getUserIdsByRole(roles: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .in('role', roles)
    .eq('is_active', true)
    .is('deleted_at', null)
  return (data ?? []).map(r => r.id)
}

/** Czy status oznacza zamknięcie/rozwiązanie */
export function isClosedStatus(s: IssueStatus): boolean {
  return s === 'closed'
}

/** Obliczenie czasu postoju (min) ze stop_time i resume_time */
export function computeDowntime(stop?: string | null, resume?: string | null): number | null {
  if (!stop || !resume) return null
  const diff = new Date(resume).getTime() - new Date(stop).getTime()
  return diff > 0 ? Math.round(diff / 60000) : 0
}
