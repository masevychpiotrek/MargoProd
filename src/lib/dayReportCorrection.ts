export function distributeQuantity(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || total > 2147483647) throw new Error('Podaj nieujemną całkowitą ilość sztuk.')
  if (!weights.length) return []
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0)
  const raw = weights.map(weight => total * (sum ? Math.max(0, weight) / sum : 1 / weights.length))
  const result = raw.map(Math.floor)
  const remaining = total - result.reduce((a, b) => a + b, 0)
  const ranked = raw.map((value, index) => ({ index, remainder: value - result[index] })).sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (let i = 0; i < remaining; i++) result[ranked[i].index]++
  return result
}
export function correctedHourlyRate(quantity: number, runtimeMin: number) {
  return runtimeMin > 0 ? Math.round(quantity * 60 / runtimeMin) : null
}
