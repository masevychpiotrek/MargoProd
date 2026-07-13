import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { Notification } from '@/types/database'

async function fetchUnread(userId: string) {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .eq('type', 'production_job_update')
    .eq('is_read', false)
    .order('created_at', { ascending: false })
  return (data ?? []) as Notification[]
}

// Powiadamia operatora (glownie drugiego na zmianie), gdy ktos zmieni numer serii
// polfabrykatu w zleceniu produkcyjnym. Zostaje widoczne az do klikniecia "Wpisano" -
// wiersz jest tworzony serwerowo (trigger na production_job_components, migracja 048).
export default function ProductionJobNotifications() {
  const { profile } = useAuthStore()
  const [items, setItems] = useState<Notification[]>([])
  const [dismissing, setDismissing] = useState<string | null>(null)

  const enabled = profile?.role === 'operator'

  useEffect(() => {
    if (!enabled || !profile) { setItems([]); return }

    fetchUnread(profile.id).then(setItems)

    const channel = supabase
      .channel(`production-job-notifications-${profile.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${profile.id}`
      }, payload => {
        const row = payload.new as Notification
        if (row.type === 'production_job_update') setItems(prev => [row, ...prev])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [enabled, profile?.id])

  const handleAcknowledge = async (id: string) => {
    setDismissing(id)
    const { error } = await supabase.from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) setItems(prev => prev.filter(n => n.id !== id))
    setDismissing(null)
  }

  if (!enabled || items.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[60] w-full max-w-sm space-y-2">
      {items.map(n => (
        <div key={n.id} className="rounded-xl border-2 border-amber-500/50 bg-navy-800 shadow-lg shadow-black/40 p-4 animate-fade-in">
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse mt-1.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-amber-300">{n.title}</div>
              {n.body && <div className="text-xs text-navy-300 mt-1">{n.body}</div>}
            </div>
          </div>
          <button
            onClick={() => handleAcknowledge(n.id)}
            disabled={dismissing === n.id}
            className="w-full mt-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-navy-900 font-bold text-xs py-2 disabled:opacity-40"
          >
            Wpisano
          </button>
        </div>
      ))}
    </div>
  )
}
