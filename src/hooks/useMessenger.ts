import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { CHAT_ROLES, chatInbox } from '@/lib/messenger'

export function useChatInbox() {
  const profile = useAuthStore(s => s.profile)
  return useQuery({
    queryKey: ['chat', profile?.id, 'inbox'], queryFn: chatInbox,
    enabled: !!profile && CHAT_ROLES.includes(profile.role),
    refetchInterval: 20000, retry: 1, staleTime: 10000,
  })
}

// Mounted once in the application header, including outside the messenger page.
export function useMessengerUpdates() {
  const profile = useAuthStore(s => s.profile)
  const qc = useQueryClient()
  const enabled = !!profile && CHAT_ROLES.includes(profile.role)
  useEffect(() => {
    if (!enabled || !profile) return
    const userId = profile.id
    const refresh = () => { void qc.invalidateQueries({ queryKey: ['chat', userId] }) }
    const channel = supabase.channel(`chat-inbox-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations', filter: `user_low=eq.${userId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations', filter: `user_high=eq.${userId}` }, refresh)
      .subscribe(status => { if (status === 'SUBSCRIBED') refresh() })
    return () => {
      void supabase.removeChannel(channel)
      void qc.cancelQueries({ queryKey: ['chat', userId] })
      qc.removeQueries({ queryKey: ['chat', userId] })
    }
  }, [enabled, profile?.id, qc])
}
