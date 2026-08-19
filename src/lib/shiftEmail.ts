// Automatyczne maile zmianowe do techników - pomocnicze funkcje strony klienta
// (etykiety, pobieranie/agregacja do UI raportu zmiany, wywołania Edge Function).
// Sama generacja/wysyłka i parsowanie odpowiedzi żyją w Edge Functions
// (supabase/functions/send-shift-email, receive-shift-email-reply) - Deno nie
// importuje z src/, więc logika tam jest celowo zduplikowana, nie importowana stąd.
import { supabase } from '@/lib/supabase'
import type {
  ShiftType,
  ShiftEmailThread,
  ShiftNotificationRecipient,
  TechnicianShiftReport,
  TechnicianActionItem,
  TechnicianMatchedBy
} from '@/types/database'

export const MATCHED_BY_LABELS: Record<Exclude<TechnicianMatchedBy, null>, string> = {
  number: 'Po numerze',
  ai: 'Dopasowanie AI (do potwierdzenia)'
}

export const MATCHED_VIA_LABELS: Record<'reply' | 'subject_fallback', string> = {
  reply: 'Odpowiedź w wątku',
  subject_fallback: 'Dopasowano po temacie (forward/brak nagłówków)'
}

// ─── Lista odbiorców (stała, zarządzana ręcznie przez Kierownika/Mistrza) ──

export async function fetchRecipients(): Promise<ShiftNotificationRecipient[]> {
  const { data } = await supabase
    .from('shift_notification_recipients')
    .select('*')
    .order('created_at')
  return (data ?? []) as ShiftNotificationRecipient[]
}

export async function addRecipient(email: string, fullName: string, createdBy: string) {
  const { error } = await supabase
    .from('shift_notification_recipients')
    .insert({ email: email.trim().toLowerCase(), full_name: fullName.trim() || null, created_by: createdBy })
  return error ? error.message : null
}

export async function setRecipientActive(id: string, isActive: boolean) {
  const { error } = await supabase
    .from('shift_notification_recipients')
    .update({ is_active: isActive })
    .eq('id', id)
  return error ? error.message : null
}

export async function deleteRecipient(id: string) {
  const { error } = await supabase.from('shift_notification_recipients').delete().eq('id', id)
  return error ? error.message : null
}

// ─── Wątek + odpowiedzi + działania dla danej zmiany (widok raportu dnia) ──

export interface ShiftEmailData {
  thread: ShiftEmailThread | null
  reports: TechnicianShiftReport[]
  items: TechnicianActionItem[]
}

export async function fetchShiftEmailData(shiftDate: string, shiftType: ShiftType): Promise<ShiftEmailData> {
  const { data: thread } = await supabase
    .from('shift_email_threads')
    .select('*')
    .eq('shift_date', shiftDate)
    .eq('shift_type', shiftType)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!thread) return { thread: null, reports: [], items: [] }

  const { data: reports } = await supabase
    .from('technician_shift_reports')
    .select('*')
    .eq('thread_id', thread.id)
    .order('received_at')

  const reportIds = (reports ?? []).map(r => r.id)
  let items: TechnicianActionItem[] = []
  if (reportIds.length) {
    const { data } = await supabase
      .from('technician_action_items')
      .select('*')
      .in('report_id', reportIds)
      .order('item_number')
    items = (data ?? []) as TechnicianActionItem[]
  }

  return { thread: thread as ShiftEmailThread, reports: (reports ?? []) as TechnicianShiftReport[], items }
}

// Pokrycie: ile ponumerowanych pozycji z maila ma choć jedno dopasowane
// (nie wymagające dalszej weryfikacji) działanie technika.
export function coverageStats(thread: ShiftEmailThread | null, items: TechnicianActionItem[]) {
  const total = thread?.numbered_items.length ?? 0
  if (!total) return { total: 0, covered: 0 }
  const coveredNumbers = new Set(
    items.filter(i => i.item_number !== null && !i.needs_review).map(i => i.item_number)
  )
  return { total, covered: coveredNumbers.size }
}

// ─── Ręczne dopasowanie/potwierdzenie (Kierownik/Mistrz) ───────────────────

export async function confirmActionItem(itemId: string, itemNumber: number | null, confirmedBy: string) {
  const { error } = await supabase
    .from('technician_action_items')
    .update({ item_number: itemNumber, needs_review: false, confirmed_by: confirmedBy, confirmed_at: new Date().toISOString() })
    .eq('id', itemId)
  return error ? error.message : null
}

// ─── Podgląd / wysyłka (ten sam Edge Function, dwa tryby) ──────────────────

export interface SendShiftEmailResult {
  html?: string
  sent?: boolean
  error?: string
}

// WAŻNE: edge function (jak reszta funkcji w tym repo) zwraca błędy jako
// {error: "..."} z HTTP 200 - `error` z invoke() tego NIE złapie. Trzeba
// jawnie sprawdzić data?.error (ta sama pułapka co w translate-shift-summaries
// wcześniej w tej sesji - nie powtarzać).
export async function previewShiftEmail(shiftDate: string, shiftType: ShiftType): Promise<SendShiftEmailResult> {
  const { data, error } = await supabase.functions.invoke('send-shift-email', {
    body: { shiftDate, shiftType, preview: true }
  })
  if (error) return { error: error.message || 'Błąd wywołania funkcji.' }
  if (data?.error) return { error: String(data.error) }
  return { html: data?.html as string | undefined }
}

export async function sendShiftEmailNow(shiftDate: string, shiftType: ShiftType): Promise<SendShiftEmailResult> {
  const { data, error } = await supabase.functions.invoke('send-shift-email', {
    body: { shiftDate, shiftType, preview: false }
  })
  if (error) return { error: error.message || 'Błąd wywołania funkcji.' }
  if (data?.error) return { error: String(data.error) }
  return { sent: true }
}
