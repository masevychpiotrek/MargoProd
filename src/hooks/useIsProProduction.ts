import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface IsProSegment {
  id: string; shift_id: string; assortment_id: string; started_at: string
  ended_at: string | null; final_good: number | null; final_reject: number | null
  assortment: { name: string } | null
}
export interface IsProChangeover {
  id: string; started_at: string; ended_at: string | null
}
export function useIsProProduction(shiftId?: string, machineId?: string, startedAt?: string) {
  const currentKey = useRef('')
  currentKey.current = `${shiftId}:${machineId}`
  const [segments, setSegments] = useState<IsProSegment[]>([])
  const [changeovers, setChangeovers] = useState<IsProChangeover[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    if (!shiftId || !machineId) { setLoading(false); return }
    const key = `${shiftId}:${machineId}`
    let eventsQuery = supabase.from('is_pro_changeovers').select('*').eq('machine_id', machineId).order('started_at')
    if (startedAt) eventsQuery = eventsQuery.or(`ended_at.is.null,ended_at.gte.${startedAt}`)
    const [s, c] = await Promise.all([
      supabase.from('is_pro_segments').select('*, assortment:assortments(name)').eq('shift_id', shiftId).order('started_at'),
      eventsQuery
    ])
    if (currentKey.current !== key) return
    if (s.error || c.error) setError('Nie można wczytać asortymentów i przezbrojeń. Sprawdź połączenie. Jeśli problem pozostaje, zgłoś go administratorowi.')
    else {
      setSegments((s.data ?? []) as IsProSegment[])
      setChangeovers((c.data ?? []) as IsProChangeover[])
      setError('')
    }
    setLoading(false)
  }, [shiftId, machineId, startedAt])
  useEffect(() => {
    setLoading(true)
    setSegments([]); setChangeovers([])
    void reload()
    const timer = window.setInterval(reload, 15000)
    window.addEventListener('focus', reload)
    window.addEventListener('is-pro-updated', reload)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', reload)
      window.removeEventListener('is-pro-updated', reload)
    }
  }, [reload])
  return { segments, changeovers, active: segments.find(s => !s.ended_at),
    changeover: changeovers.find(c => !c.ended_at), error, loading, reload }
}
