import { supabase } from '@/lib/supabase'
import type { UserRole } from '@/types/database'

export const CHAT_ROLES: UserRole[] = ['operator', 'syringe_operator', 'manager', 'specialist', 'executive', 'admin']
export type ChatContact = { id: string; full_name: string; role: UserRole }
export type ChatConversation = {
  id: string; other_id: string; full_name: string; role: UserRole; can_send: boolean
  last_body: string; last_sender_id: string; last_message_at: string
  unread_count: number; other_read_seq: number
}
export type ChatMessage = {
  id: string; seq: number; conversation_id: string; sender_id: string
  request_id: string; body: string; created_at: string
}

function chatError(error: { code?: string; message: string }): Error {
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code ?? '')) {
    return new Error('Komunikator nie został jeszcze uruchomiony. Poproś administratora o jego aktywację.')
  }
  if (/fetch|network|load failed/i.test(error.message)) return new Error('Brak połączenia. Spróbuj ponownie — treść wiadomości została zachowana.')
  return new Error(error.message)
}

export async function chatContacts(): Promise<ChatContact[]> {
  const { data, error } = await supabase.rpc('chat_contacts')
  if (error) throw chatError(error)
  return data ?? []
}
export async function chatInbox(): Promise<ChatConversation[]> {
  const { data, error } = await supabase.rpc('chat_inbox')
  if (error) throw chatError(error)
  return data ?? []
}
export async function chatMessages(conversation: string, before?: number): Promise<ChatMessage[]> {
  let query = supabase.from('chat_messages').select('*').eq('conversation_id', conversation)
    .order('seq', { ascending: false }).limit(50)
  if (before != null) query = query.lt('seq', before)
  const { data, error } = await query
  if (error) throw chatError(error)
  return data ?? []
}
export async function chatSend(recipient: string, body: string, requestId: string): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc('chat_send', { p_recipient: recipient, p_body: body, p_request_id: requestId })
  if (error) throw chatError(error)
  const message = Array.isArray(data) ? data[0] : data
  if (!message?.id || !message?.conversation_id) throw new Error('Nie otrzymano potwierdzenia zapisu. Ponów wysyłkę.')
  return message as ChatMessage
}
export async function chatMarkRead(conversation: string, seq: number) {
  const { error } = await supabase.rpc('chat_mark_read', { p_conversation: conversation, p_through_seq: seq })
  if (error) throw chatError(error)
}
