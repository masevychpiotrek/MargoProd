// Stałe i etykiety dla modułu "Transparentność Zmian i Problemów"
// (change_log / issue_log) - wzorem src/lib/issueReports.ts i konwencji
// SEV_CFG/STATUS_CFG z src/pages/Specialist/Dashboard.tsx.

import type { ChangeLogType, IssueLogPriority, IssueLogStatus } from '@/types/database'

// ─── Typ zmiany (change_log.change_type) ────────────────────────────────────

export const CHANGE_TYPES: { value: ChangeLogType; label: string }[] = [
  { value: 'parameter', label: 'Parametr' },
  { value: 'part', label: 'Część' },
  { value: 'software', label: 'Oprogramowanie' },
  { value: 'procedure', label: 'Procedura' },
]

export function changeTypeLabel(value: ChangeLogType | null | undefined): string {
  if (!value) return '—'
  return CHANGE_TYPES.find(o => o.value === value)?.label ?? value
}

// ─── Status problemu (issue_log.status) ─────────────────────────────────────

export const ISSUE_LOG_STATUS_CFG: Record<IssueLogStatus, { label: string; cls: string }> = {
  new: { label: 'Nowy', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  in_progress: { label: 'W trakcie', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  waiting_part: { label: 'Oczekuje na część', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  closed: { label: 'Zamknięty', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
}

export const ISSUE_LOG_STATUSES: { value: IssueLogStatus; label: string }[] =
  (Object.keys(ISSUE_LOG_STATUS_CFG) as IssueLogStatus[]).map(value => ({ value, label: ISSUE_LOG_STATUS_CFG[value].label }))

export function issueLogStatusLabel(value: IssueLogStatus | null | undefined): string {
  if (!value) return '—'
  return ISSUE_LOG_STATUS_CFG[value]?.label ?? value
}

// ─── Priorytet problemu (issue_log.priority) ────────────────────────────────

export const ISSUE_LOG_PRIORITY_CFG: Record<IssueLogPriority, { label: string; cls: string; dot: string; rank: number }> = {
  low: { label: 'Niski', cls: 'bg-green-500/15 text-green-400 border-green-500/30', dot: 'bg-green-400', rank: 1 },
  medium: { label: 'Średni', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', dot: 'bg-amber-400', rank: 2 },
  critical: { label: 'Krytyczny', cls: 'bg-red-500/15 text-red-400 border-red-500/30', dot: 'bg-red-400 animate-pulse', rank: 3 },
}

export const ISSUE_LOG_PRIORITIES: { value: IssueLogPriority; label: string }[] =
  (Object.keys(ISSUE_LOG_PRIORITY_CFG) as IssueLogPriority[]).map(value => ({ value, label: ISSUE_LOG_PRIORITY_CFG[value].label }))

export function issueLogPriorityLabel(value: IssueLogPriority | null | undefined): string {
  if (!value) return '—'
  return ISSUE_LOG_PRIORITY_CFG[value]?.label ?? value
}
