export function overlapMilliseconds(start: number, end: number, windowStart: number, windowEnd: number) {
  return Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart))
}

// Opening the app late must not hide earlier hours of the first assortment.
// A later assortment or a carried-over changeover still limits its own window.
export function isProReportStart(
  shiftStart: number,
  active: { id: string; started_at: string } | undefined,
  segments: { id: string }[],
  changeovers: { started_at: string; ended_at: string | null }[],
  firstReportedAt?: number
): number {
  if (!active) return shiftStart
  const segmentStart = new Date(active.started_at).getTime()
  const followsChangeover = changeovers.some(event => overlapMilliseconds(
    new Date(event.started_at).getTime(),
    event.ended_at ? new Date(event.ended_at).getTime() : segmentStart,
    shiftStart, segmentStart
  ) > 0)
  if (segments[0]?.id !== active.id || followsChangeover) return segmentStart
  // Keep previously recorded counters in order; opening earlier hours after a
  // later reading was saved would require redistributing that reading first.
  return firstReportedAt === undefined ? shiftStart : Math.max(shiftStart, Math.min(segmentStart, firstReportedAt))
}

// Postgres integer counters; never silently truncate decimals or invalid input.
export function parseShiftEndCount(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count <= 2147483647 ? count : null
}
