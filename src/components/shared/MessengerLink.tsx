import { MessageCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { CHAT_ROLES } from '@/lib/messenger'
import { useChatInbox, useMessengerUpdates } from '@/hooks/useMessenger'

export default function MessengerLink() {
  const profile = useAuthStore(s => s.profile)
  const inbox = useChatInbox()
  useMessengerUpdates()
  if (!profile || !CHAT_ROLES.includes(profile.role)) return null
  const unread = (inbox.data ?? []).reduce((sum, item) => sum + Number(item.unread_count), 0)
  return (
    <Link to="/messages" className="relative flex items-center gap-2 rounded-xl border border-navy-600 px-3 py-2 text-navy-200 hover:text-brand"
      aria-label={`Wiadomości${unread ? `, ${unread} nieprzeczytanych` : ''}`} title="Wiadomości">
      <MessageCircle size={20} /><span className="hidden sm:inline text-sm">Wiadomości</span>
      {unread > 0 && <span className="rounded-full bg-brand px-1.5 text-xs font-bold text-navy-950" aria-live="polite">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  )
}
