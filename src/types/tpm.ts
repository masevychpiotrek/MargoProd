// ─────────────────────────────────────────────────────────────
// MODUŁ TPM/PM — IS PRO
// ─────────────────────────────────────────────────────────────

export type TpmRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type AmResult = 'ok' | 'nok' | 'na'
export type AmChecklistStatus = 'in_progress' | 'completed' | 'completed_late'

export type IssuePriority = 'low' | 'normal' | 'high' | 'critical'
export type IssueStatus =
  | 'new' | 'awaiting_ack' | 'accepted' | 'diagnosing'
  | 'immediate_done' | 'repairing' | 'awaiting_part'
  | 'awaiting_manager' | 'observation' | 'testing'
  | 'escalated_a1tec' | 'resolved' | 'awaiting_approval'
  | 'closed' | 'reopened'

export type MediaCategory =
  | 'base_state' | 'before' | 'failure' | 'during' | 'after'
  | 'setting' | 'param_screen' | 'damaged_part' | 'test' | 'other'

export const ISSUE_CATEGORIES = [
  'mechanika','elektryka','pneumatyka','czujnik','robot','software','transport',
  'pas_transportowy','podawanie','obrot','pozycjonowanie','chwytak','silownik',
  'wibrator','gniazdo','jakosc_komponentu','zabrudzenie','blad_obslugi',
  'brak_czesci','nieustalony','inne'
] as const
export type IssueCategory = typeof ISSUE_CATEGORIES[number]

export const ISSUE_CATEGORY_LABELS: Record<string, string> = {
  mechanika: 'Mechanika', elektryka: 'Elektryka', pneumatyka: 'Pneumatyka',
  czujnik: 'Czujnik', robot: 'Robot', software: 'Software', transport: 'Transport',
  pas_transportowy: 'Pas transportowy', podawanie: 'Podawanie komponentu',
  obrot: 'Obrót komponentu', pozycjonowanie: 'Pozycjonowanie komponentu',
  chwytak: 'Chwytak', silownik: 'Siłownik', wibrator: 'Wibrator', gniazdo: 'Gniazdo',
  jakosc_komponentu: 'Jakość komponentu', zabrudzenie: 'Zabrudzenie',
  blad_obslugi: 'Błąd obsługi', brak_czesci: 'Brak części',
  nieustalony: 'Problem nieustalony', inne: 'Inne', unknown: 'Nieokreślona'
}

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  new: 'Nowe',
  awaiting_ack: 'Oczekuje na przyjęcie',
  accepted: 'Przyjęte przez Specialist',
  diagnosing: 'W trakcie diagnozy',
  immediate_done: 'Działanie doraźne wykonane',
  repairing: 'W trakcie naprawy',
  awaiting_part: 'Oczekuje na część',
  awaiting_manager: 'Oczekuje na decyzję Kierownika',
  observation: 'Obserwacja',
  testing: 'Test po naprawie',
  escalated_a1tec: 'Przekazane do A1TEC',
  resolved: 'Rozwiązane',
  awaiting_approval: 'Oczekuje na zatwierdzenie',
  closed: 'Zamknięte',
  reopened: 'Ponownie otwarte'
}

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  low: 'Niski', normal: 'Normalny', high: 'Wysoki', critical: 'Krytyczny'
}

export interface TpmMachine {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface TpmStation {
  id: string
  machine_id: string
  station_number: string
  name: string
  description: string | null
  function_desc: string | null
  base_photo_url: string | null
  standard_settings: string | null
  standard_params: string | null
  param_ranges: string | null
  control_instruction: string | null
  tech_instruction: string | null
  is_critical: boolean
  pm_frequency_days: number
  risk_level: TpmRiskLevel
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
  // joined
  machine?: TpmMachine
  checkpoints?: TpmCheckpoint[]
}

export interface TpmCheckpoint {
  id: string
  station_id: string
  name: string
  description: string | null
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface AmChecklist {
  id: string
  machine_id: string
  operator_id: string
  shift_type: 'I' | 'II' | 'III'
  checklist_date: string
  started_at: string
  completed_at: string | null
  status: AmChecklistStatus
  nok_count: number
  na_count: number
  ok_count: number
  notes: string | null
  created_at: string
  updated_at: string
  // joined
  machine?: TpmMachine
  operator?: { id: string; full_name: string }
  results?: AmResultRow[]
}

export interface AmResultRow {
  id: string
  checklist_id: string
  station_id: string
  checkpoint_id: string
  result: AmResult
  comment: string | null
  photo_url: string | null
  issue_id: string | null
  created_at: string
}

export interface TpmIssue {
  id: string
  issue_number: string | null
  machine_id: string
  station_id: string
  component: string | null
  reporter_id: string
  shift_type: 'I' | 'II' | 'III' | null
  category: string
  category_other: string | null
  priority: IssuePriority
  status: IssueStatus
  symptom: string
  problem_time: string | null
  report_time: string
  stop_time: string | null
  ack_time: string | null
  intervention_start: string | null
  intervention_end: string | null
  resume_time: string | null
  machine_stopped: boolean
  production_resumed: boolean
  post_resume_check: boolean
  operator_action: string | null
  immediate_action: string | null
  diagnosis: string | null
  probable_cause: string | null
  confirmed_cause: string | null
  root_cause_action: string | null
  test_cycles: number | null
  test_ok: number | null
  test_nok: number | null
  test_result: string | null
  downtime_min: number | null
  nok_count: number | null
  reject_pct: number | null
  production_impact: string | null
  assigned_to: string | null
  due_date: string | null
  verification_due: string | null
  verification_done: string | null
  verification_result: 'effective' | 'ineffective' | null
  verification_notes: string | null
  is_recurring: boolean
  a1tec_escalated: boolean
  needs_part: boolean
  proposed_close: boolean
  proposed_close_by: string | null
  approved_by: string | null
  approved_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  // joined
  machine?: TpmMachine
  station?: TpmStation
  reporter?: { id: string; full_name: string }
  assignee?: { id: string; full_name: string } | null
}

export interface TpmIssueHistory {
  id: string
  issue_id: string
  user_id: string | null
  action: string
  old_status: string | null
  new_status: string | null
  old_value: string | null
  new_value: string | null
  comment: string | null
  created_at: string
  // joined
  user?: { id: string; full_name: string }
}

// ── Etap 2 ──

export type PmCardStatus =
  | 'planned' | 'todo' | 'in_progress' | 'done' | 'done_late'
  | 'not_done' | 'needs_action' | 'awaiting_approval' | 'approved'

export const PM_STATUS_LABELS: Record<PmCardStatus, string> = {
  planned: 'Zaplanowana', todo: 'Do wykonania', in_progress: 'W trakcie',
  done: 'Wykonana', done_late: 'Wykonana po terminie', not_done: 'Niewykonana',
  needs_action: 'Wymaga działania', awaiting_approval: 'Oczekuje na zatwierdzenie',
  approved: 'Zatwierdzona'
}

export type PartStatus =
  | 'available' | 'low' | 'minimum' | 'none' | 'ordered'
  | 'awaiting_delivery' | 'delivered' | 'withdrawn'

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  available: 'Dostępna', low: 'Niski stan', minimum: 'Stan minimalny', none: 'Brak',
  ordered: 'Zamówiona', awaiting_delivery: 'Oczekuje na dostawę',
  delivered: 'Dostarczona', withdrawn: 'Wycofana'
}

export interface TpmPmTemplate {
  id: string
  station_id: string
  name: string
  description: string | null
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface TpmPmCard {
  id: string
  card_number: string | null
  machine_id: string
  station_id: string
  planned_date: string
  actual_date: string | null
  performer_id: string | null
  start_time: string | null
  end_time: string | null
  status: PmCardStatus
  findings: string | null
  actions: string | null
  parts_used: string | null
  recommendations: string | null
  next_due_date: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
  // joined
  machine?: TpmMachine
  station?: TpmStation
  performer?: { id: string; full_name: string }
  results?: TpmPmResult[]
}

export interface TpmPmResult {
  id: string
  card_id: string
  template_id: string | null
  name: string
  result: AmResult
  measurement: string | null
  notes: string | null
  created_at: string
}

export interface TpmParameter {
  id: string
  machine_id: string
  station_id: string
  issue_id: string | null
  user_id: string
  param_name: string
  value_before: string | null
  value_after: string
  unit: string | null
  approved_range: string | null
  reason: string | null
  expected_effect: string | null
  result_after: string | null
  test_cycles: number | null
  test_ok: number | null
  test_nok: number | null
  screen_photo_url: string | null
  setting_photo_url: string | null
  comment: string | null
  out_of_range: boolean
  requires_approval: boolean
  approved_by: string | null
  approved_at: string | null
  is_last_good: boolean
  created_at: string
  // joined
  station?: TpmStation
  user?: { id: string; full_name: string }
}

export interface TpmPart {
  id: string
  machine_id: string | null
  station_id: string | null
  name: string
  part_number: string | null
  manufacturer_number: string | null
  manufacturer: string | null
  usage_desc: string | null
  min_stock: number
  current_stock: number
  unit: string
  location: string | null
  lead_time_days: number | null
  last_used_at: string | null
  used_count: number
  photo_url: string | null
  status: PartStatus
  is_active: boolean
  created_at: string
  updated_at: string
  // joined
  station?: TpmStation
  machine?: TpmMachine
}

export interface TpmPartUsage {
  id: string
  part_id: string
  issue_id: string | null
  pm_card_id: string | null
  user_id: string
  qty: number
  used_at: string
  notes: string | null
  created_at: string
}

export interface TpmMedia {
  id: string
  machine_id: string | null
  station_id: string | null
  issue_id: string | null
  checklist_id: string | null
  url: string
  media_type: 'photo' | 'video'
  category: MediaCategory
  description: string | null
  author_id: string | null
  created_at: string
  deleted_at: string | null
  deleted_by: string | null
  deleted_reason: string | null
}
