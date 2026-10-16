export function overlapMilliseconds(start: number, end: number, windowStart: number, windowEnd: number) {
  return Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart))
}
