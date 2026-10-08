type ReportShift = 'I' | 'II' | 'III'
type ProductionSummary = { good: number; reject: number; notes: string[] }

export function includeSyringeEmailShift(shift: ReportShift, summary: ProductionSummary) {
  return shift === 'I' || (shift === 'II' && summary.good + summary.reject > 0)
}

export function requiresSyringeIdleReason(shift: ReportShift, summary: ProductionSummary) {
  return shift === 'I' && summary.good + summary.reject === 0 && !summary.notes.some(note => note.trim())
}
