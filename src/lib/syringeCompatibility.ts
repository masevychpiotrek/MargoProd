import type { SaAssortment, SaMachine } from '@/types/database'

export function isSyringeCompatible(machine: SaMachine | null | undefined, assortment: SaAssortment | null | undefined) {
  return !!machine?.is_active && !machine.deleted_at && !!assortment?.is_active
    && Number(machine.volume_ml) > 0 && Number(machine.volume_ml) === Number(assortment.volume_ml)
}
