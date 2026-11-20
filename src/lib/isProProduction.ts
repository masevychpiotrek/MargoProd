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
  if (firstReportedAt === undefined) return shiftStart
  // A reading in the registration hour does not turn a partial hour into a full one.
  return firstReportedAt + 3600000 > segmentStart ? segmentStart : Math.max(shiftStart, firstReportedAt)
}

export function isProPlannedHours(
  blocks: { hour: number; start: number; end: number }[],
  segments: { id: string; started_at: string; ended_at: string | null }[],
  changeovers: { started_at: string; ended_at: string | null }[],
  reports: { segment_id?: string | null; hour_start: number; is_segment_close?: boolean }[]
): number[] {
  if (!blocks.length) return []
  const windows = segments.map(segment => {
    const firstReport = blocks.find(block => reports.some(report =>
      !report.is_segment_close && report.segment_id === segment.id && report.hour_start === block.hour
    ))
    return {
      start: isProReportStart(blocks[0].start, segment, segments, changeovers, firstReport?.start),
      end: segment.ended_at ? new Date(segment.ended_at).getTime() : blocks[blocks.length - 1].end
    }
  })
  return blocks.filter(block => windows.some(window =>
    overlapMilliseconds(window.start, window.end, block.start, block.end) > 0
  )).map(block => block.hour)
}

// Postgres integer counters; never silently truncate decimals or invalid input.
export function parseShiftEndCount(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count <= 2147483647 ? count : null
}
