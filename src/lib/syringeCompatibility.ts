import type { SaAssortment, SaMachine } from '@/types/database'

export function isSyringeCompatible(machine: SaMachine | null | undefined, assortment: SaAssortment | null | undefined) {
  // The original 50/60 ml catalogue product uses 60 ml; its physical line is 50 ml.
  const assortmentVolume = Number(assortment?.volume_ml) === 60
    && ['SYR_50ML', 'SYR_50ML_STANDARD'].includes(assortment?.code ?? '')
    ? 50 : Number(assortment?.volume_ml)
  return !!machine?.is_active && !machine.deleted_at && !!assortment?.is_active
    && Number(machine.volume_ml) > 0 && Number(machine.volume_ml) === assortmentVolume
}
