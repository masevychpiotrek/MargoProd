export function overlapMilliseconds(start: number, end: number, windowStart: number, windowEnd: number) {
  return Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart))
}

// Postgres integer counters; never silently truncate decimals or invalid input.
export function parseShiftEndCount(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count <= 2147483647 ? count : null
}
