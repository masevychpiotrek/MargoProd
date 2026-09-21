import { useRef } from 'react'
import { syringeCommand } from '@/lib/syringeApi'

export function useSyringeCommand() {
  const pending = useRef(new Map<string, { key: string; id: string }>())
  return async (action: string, payload: Record<string, unknown>) => {
    const key = JSON.stringify(payload)
    let request = pending.current.get(action)
    if (request?.key !== key) {
      request = { key, id: crypto.randomUUID() }
      pending.current.set(action, request)
    }
    const result = await syringeCommand(action, { ...payload, request_id: request!.id })
    pending.current.delete(action)
    return result
  }
}
