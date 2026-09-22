export const SHIFT_SETTLEMENT_ASSORTMENT_CODES = new Set(['SYR_50ML', 'SYR_100ML'])

export function isShiftSettlementAssortment(code?: string | null) {
  return !!code && SHIFT_SETTLEMENT_ASSORTMENT_CODES.has(code)
}
