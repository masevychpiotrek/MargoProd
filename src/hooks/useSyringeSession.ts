import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  clearSyringeQueries,
  fetchMySyringeSession,
  SYRINGE_RESET_EVENT,
  SYRINGE_RESET_STORAGE_KEY
} from '@/lib/syringeApi'
import { useAuthStore } from '@/stores/authStore'

export function useSyringeSession() {
  const id = useAuthStore(s => s.profile?.id)
  const qc = useQueryClient()

  useEffect(() => {
    const refreshAfterReset = () => void clearSyringeQueries(qc)
    const refreshAfterStorageReset = (event: StorageEvent) => {
      if (event.key === SYRINGE_RESET_STORAGE_KEY) void clearSyringeQueries(qc)
    }

    window.addEventListener(SYRINGE_RESET_EVENT, refreshAfterReset)
    window.addEventListener('storage', refreshAfterStorageReset)
    return () => {
      window.removeEventListener(SYRINGE_RESET_EVENT, refreshAfterReset)
      window.removeEventListener('storage', refreshAfterStorageReset)
    }
  }, [qc])

  return useQuery({ queryKey: ['sa_my_session', id], queryFn: () => fetchMySyringeSession(id!), enabled: !!id, refetchInterval: 10000 })
}
