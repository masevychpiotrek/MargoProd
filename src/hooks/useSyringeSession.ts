import { useQuery } from '@tanstack/react-query'
import { fetchMySyringeSession } from '@/lib/syringeApi'
import { useAuthStore } from '@/stores/authStore'

export function useSyringeSession() {
  const id = useAuthStore(s => s.profile?.id)
  return useQuery({ queryKey: ['sa_my_session', id], queryFn: () => fetchMySyringeSession(id!), enabled: !!id, refetchInterval: 10000 })
}
