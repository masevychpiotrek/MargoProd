// Auto-generated types — odzwierciedlają schemat bazy
// Można aktualizować przez: npx supabase gen types typescript --project-id TWOJ_ID

export type UserRole = 'operator' | 'manager' | 'admin' | 'specialist' | 'viewer' | 'executive' | 'syringe_operator'
export type ShiftType = 'I' | 'II' | 'III'
export type ReportStatus = 'pending' | 'submitted' | 'approved' | 'rejected'
export type DowntimeCategory =
  | 'mechanical_failure' | 'electrical_failure' | 'material_shortage'
  | 'quality_control' | 'changeover' | 'no_operator' | 'cleaning'
  | 'process_issue' | 'logistics_issue' | 'other'
export type NotificationType = 'report_due' | 'alarm' | 'system' | 'info' | 'failure_report' | 'production_job_update'
export type AuditAction =
  | 'login' | 'logout' | 'report_create' | 'report_update' | 'report_delete'
  | 'user_create' | 'user_update' | 'user_delete' | 'password_change'
  | 'shift_start' | 'shift_end' | 'config_change'
  | 'failure_report_create' | 'failure_report_update'
  | 'shift_manager_correction' | 'manager_report_update' | 'manager_report_delete'
  | 'manager_order_update' | 'manager_order_report_update'
  | 'ai_issue_validation'
  | 'production_job_start' | 'production_job_component_update'

export interface IssueStationAllocation {
  station: string
  pct: number
}

export type IssueValidatedBy = 'ai' | 'heuristic'
export type IssueStatus =
  | 'rozwiazane_operator' | 'rozwiazane_lider' | 'rozwiazane_ur'
  | 'wystepuje_nadal' | 'wymaga_analizy' | 'wymaga_czesci'
  | 'wymaga_serwisu_zewn' | 'wymaga_poprawy_danych'

export type FailureSeverity = 'low' | 'medium' | 'high' | 'critical'
export type FailureStatus   = 'new' | 'acknowledged' | 'in_progress' | 'unresolved' | 'resolved'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  is_active: boolean
  must_change_password?: boolean
  rfid_uid?: string | null
  avatar_url: string | null
  phone: string | null
  department: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Machine {
  id: string
  name: string
  code: string
  department: string
  target_per_hour: number
  is_active: boolean
  description: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Shift {
  id: string
  machine_id: string
  operator_1_id: string
  operator_2_id: string | null
  shift_type: ShiftType
  shift_date: string
  started_at: string
  ended_at: string | null
  notes: string | null
  summary_good_count?: number | null
  summary_reject_count?: number | null
  summary_runtime_min?: number | null
  summary_ready_min?: number | null
  summary_alarm_min?: number | null
  summary_downtime_min?: number | null
  summary_notes?: string | null
  ended_early?: boolean
  early_end_reason?: string | null
  created_at: string
  updated_at: string
  // joined
  machine?: Machine
  operator_1?: Profile
  operator_2?: Profile | null
}

export interface HourlyReport {
  id: string
  shift_id: string
  machine_id: string
  operator_id: string
  hour_block: string
  report_date: string
  hour_start: number
  status: ReportStatus
  good_count: number
  reject_count: number
  total_count: number | null
  target: number
  efficiency_pct: number
  runtime_min: number
  downtime_min: number
  micro_stoppage_min: number
  changeover_min: number
  failure_min: number
  downtime_reason: string | null
  reject_reason?: string | null
  notes: string | null
  submitted_at: string
  updated_at: string
  deleted_at: string | null
  downtime_station?: string | null
  downtime_stations?: IssueStationAllocation[] | null
  downtime_category?: string | null
  downtime_problem_name?: string | null
  downtime_status?: IssueStatus | null
  downtime_action_taken?: string | null
  downtime_validated_by?: IssueValidatedBy | null
  reject_station?: string | null
  reject_stations?: IssueStationAllocation[] | null
  reject_category?: string | null
  reject_problem_name?: string | null
  reject_status?: IssueStatus | null
  reject_action_taken?: string | null
  reject_validated_by?: IssueValidatedBy | null
  // joined
  machine?: Machine
  operator?: Profile
  downtime_events?: DowntimeEvent[]
}

export interface DowntimeEvent {
  id: string
  report_id: string
  shift_id: string
  machine_id: string
  category: DowntimeCategory
  duration_min: number
  started_at: string | null
  description: string | null
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string | null
  is_read: boolean
  report_id: string | null
  machine_id: string | null
  created_at: string
  read_at: string | null
}

export interface AuditLog {
  id: string
  user_id: string | null
  action: AuditAction
  table_name: string | null
  record_id: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
  // joined
  user?: Profile
}

export interface Schedule {
  id: string
  name: string
  work_start: string
  work_end: string
  active_shifts: ShiftType[]
  off_weekdays: number[]
  created_at: string
  updated_at: string
}

export interface ProductionTarget {
  id: string
  machine_id: string
  target_per_hour: number
  valid_from: string
  valid_to: string | null
  note: string | null
  created_by: string | null
  created_at: string
}

export interface FailureReport {
  id:               string
  machine_id:       string
  shift_id:         string | null
  reporter_id:      string
  category:         DowntimeCategory
  severity:         FailureSeverity
  status:           FailureStatus
  station:          string | null
  description:      string
  photo_urls:       string[]
  resolution_notes: string | null
  assigned_to:      string | null
  acknowledged_at:  string | null
  resolved_at:      string | null
  auto_generated?:  boolean
  hourly_report_id?: string | null
  auto_alert_type?: string | null
  auto_metrics?:    Record<string, unknown>
  created_at:       string
  updated_at:       string
  // joined
  machine?:         Machine
  reporter?:        Profile
  assignee?:        Profile | null
}

// ---- Form / UI types ----

export interface HourlyReportFormData {
  hour_start: number
  good_count: number
  reject_count: number
  total_count?: number
  runtime_min: number
  downtime_min: number
  micro_stoppage_min: number
  changeover_min: number
  failure_min: number
  downtime_reason?: string
  notes?: string
  downtime_events: DowntimeEventFormData[]
}

export interface DowntimeEventFormData {
  category: DowntimeCategory
  duration_min: number
  description?: string
}

export interface ShiftStartFormData {
  machine_id: string
  shift_type: ShiftType
  operator_2_id?: string
}

// ---- Dashboard / Analytics ----

export interface MachineStats {
  machine_id: string
  machine_name: string
  total_good: number
  total_reject: number
  avg_efficiency: number
  reports_count: number
  last_operator: string | null
  last_shift_type: ShiftType | null
}

export interface HourlyChartPoint {
  hour: string
  good_count: number
  reject_count: number
  target: number
  efficiency_pct: number
}

// ─────────────────────────────────────────────────────────────
// MODUŁ OPERATOR AUTOMATÓW STRZYKAWKOWYCH (SA)
// ─────────────────────────────────────────────────────────────

export type SaMachineStatus =
  | 'production' | 'changeover' | 'failure' | 'adjustment'
  | 'no_components' | 'quality_control' | 'planned_stop'
  | 'waiting' | 'cleaning' | 'end_of_production'

export type SaOrderStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'on_hold'
export type SaFailurePriority = 'low' | 'medium' | 'high' | 'critical'
export type SaFailureStatus = 'new' | 'acknowledged' | 'in_progress' | 'waiting_for_part' | 'resolved' | 'closed'
export type SaQualityIssueStatus = 'open' | 'under_review' | 'resolved' | 'closed'
export type SaDefectType = 'quality' | 'tech' | 'other'
export type SaDowntimeCategoryType = 'planned' | 'unplanned' | 'quality' | 'logistics'

export interface SaAssortment {
  id: string
  name: string
  code: string
  volume_ml: number | null
  nominal_per_hour: number
  description: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface SaMachine {
  id: string
  name: string
  code: string
  description: string | null
  location: string | null
  nominal_per_hour: number
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface SaOrder {
  id: string
  order_number: string
  machine_id: string | null
  assortment_id: string
  target_qty: number
  produced_qty: number
  good_qty: number
  reject_qty: number
  planned_date: string | null
  status: SaOrderStatus
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // joined
  assortment?: SaAssortment
  machine?: SaMachine
}

export interface SaSession {
  id: string
  machine_id: string
  operator_id: string
  assortment_id: string
  order_id: string | null
  shift_type: 'I' | 'II' | 'III'
  session_date: string
  started_at: string
  ended_at: string | null
  plan_qty: number | null
  machine_status: SaMachineStatus
  total_produced: number | null
  total_good: number | null
  total_reject: number | null
  total_tech_reject: number | null
  total_qual_reject: number | null
  total_runtime_min: number | null
  total_downtime_min: number | null
  plan_pct: number | null
  avg_per_hour: number | null
  summary_notes: string | null
  handover_confirmed_by: string | null
  handover_confirmed_at: string | null
  created_at: string
  updated_at: string
  // joined
  machine?: SaMachine
  operator?: { id: string; full_name: string }
  assortment?: SaAssortment
  order?: SaOrder | null
}

export interface SaDefectCategory {
  id: string
  name: string
  code: string
  defect_type: SaDefectType
  requires_comment: boolean
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface SaDowntimeCategory {
  id: string
  name: string
  code: string
  category_type: SaDowntimeCategoryType
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface SaProductionEntry {
  id: string
  session_id: string
  machine_id: string
  operator_id: string
  recorded_at: string
  counter_value: number
  counter_reset: boolean
  counter_reset_reason: string | null
  produced_qty: number
  good_qty: number
  reject_qty: number
  tech_reject_qty: number
  qual_reject_qty: number
  qty_since_last: number | null
  per_hour: number | null
  reject_pct: number | null
  plan_pct: number | null
  remaining_qty: number | null
  eta_minutes: number | null
  notes: string | null
  is_cancelled: boolean
  cancel_reason: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  // joined
  defect_entries?: SaDefectEntry[]
}

export interface SaDefectEntry {
  id: string
  entry_id: string
  session_id: string
  category_id: string
  qty: number
  notes: string | null
  created_at: string
  // joined
  category?: SaDefectCategory
}

export interface SaDowntimeEvent {
  id: string
  session_id: string
  machine_id: string
  operator_id: string
  category_id: string
  started_at: string
  ended_at: string | null
  duration_min: number | null
  description: string | null
  actions_taken: string | null
  maintenance_needed: boolean
  fully_resolved: boolean | null
  created_at: string
  updated_at: string
  // joined
  category?: SaDowntimeCategory
}

export interface SaFailureReport {
  id: string
  session_id: string | null
  machine_id: string
  reporter_id: string
  reported_at: string
  component_name: string | null
  symptoms: string
  error_code: string | null
  photo_urls: string[]
  priority: SaFailurePriority
  production_stopped: boolean
  can_continue: boolean
  status: SaFailureStatus
  assigned_to: string | null
  resolution_notes: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  // joined
  machine?: SaMachine
  reporter?: { id: string; full_name: string }
  assignee?: { id: string; full_name: string } | null
}

export interface SaQualityIssue {
  id: string
  session_id: string | null
  machine_id: string
  assortment_id: string | null
  order_id: string | null
  reporter_id: string
  detected_at: string
  batch_number: string | null
  description: string
  affected_qty: number | null
  photo_urls: string[]
  operator_actions: string | null
  production_stopped: boolean
  product_separated: boolean
  separation_location: string | null
  status: SaQualityIssueStatus
  resolution_notes: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  // joined
  machine?: SaMachine
  assortment?: SaAssortment | null
}

export interface SaComponentUsage {
  id: string
  session_id: string
  operator_id: string
  component_type: string
  component_name: string
  batch_number: string | null
  qty_used: number | null
  unit: string
  used_from: string
  used_to: string | null
  notes: string | null
  created_at: string
}

export interface SaChangeover {
  id: string
  session_id: string
  machine_id: string
  operator_id: string
  from_assortment_id: string | null
  to_assortment_id: string
  counter_before: number | null
  reason: string | null
  started_at: string
  ended_at: string | null
  duration_min: number | null
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  created_at: string
  // joined
  from_assortment?: SaAssortment | null
  to_assortment?: SaAssortment
  checklist_completions?: SaChecklistCompletion[]
}

export interface SaChecklistItem {
  id: string
  name: string
  description: string | null
  is_required: boolean
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface SaChecklistCompletion {
  id: string
  changeover_id: string
  item_id: string
  completed: boolean
  completed_by: string | null
  completed_at: string | null
  notes: string | null
  // joined
  item?: SaChecklistItem
}

export interface SaHandover {
  id: string
  session_id: string
  from_operator_id: string
  to_operator_id: string | null
  machine_status: string
  current_assortment_id: string | null
  produced_qty: number | null
  remaining_qty: number | null
  active_issues: string | null
  adjustments_made: string | null
  unresolved_failures: string | null
  quality_info: string | null
  component_status: string | null
  recommendations: string | null
  comment: string | null
  created_at: string
  confirmed_by: string | null
  confirmed_at: string | null
  // joined
  from_operator?: { id: string; full_name: string }
  to_operator?: { id: string; full_name: string } | null
  assortment?: SaAssortment | null
}

// ─────────────────────────────────────────────────────────────
// ZLECENIE PRODUKCYJNE — identyfikowalność półfabrykatów (moduł operator IS PRO)
// ─────────────────────────────────────────────────────────────

export type ProductionJobStatus = 'active' | 'confirmed'
export type ProductionJobComponentStatus = 'oczekuje' | 'aktywny'

export interface ProductionJob {
  id: string
  order_number: string
  series_number: string | null
  assortment_name: string
  assortment_length_cm: number
  label_count: number
  multiplier: number
  calculated_qty: number
  machine_id: string
  shift_id: string | null
  operator_id: string
  shift_type: string | null
  started_at: string
  status: ProductionJobStatus
  confirmed_at: string | null
  confirmed_by: string | null
  created_at: string
  updated_at: string
  // joined
  machine?: Machine
  operator?: { id: string; full_name: string }
}

export interface ProductionJobComponent {
  id: string
  job_id: string
  component_key: string
  component_label: string
  is_dren: boolean
  batch_number: string | null
  status: ProductionJobComponentStatus
  entered_at: string | null
  entered_by: string | null
  sort_order: number
  created_at: string
  updated_at: string
  // joined
  entered_by_profile?: { id: string; full_name: string }
}

export interface ProductionJobComponentHistory {
  id: string
  component_id: string
  job_id: string
  previous_batch_number: string | null
  new_batch_number: string
  changed_by: string | null
  changed_at: string
  // joined
  changed_by_profile?: { id: string; full_name: string }
}

// ─────────────────────────────────────────────────────────────
// ZDJĘCIA STATYSTYK ZMIANOWYCH AUTOMATU (ekran PLC) + odczyt AI
// ─────────────────────────────────────────────────────────────

export type ShiftStatOcrStatus = 'pending' | 'done' | 'failed'

export interface ShiftStatPhoto {
  id: string
  shift_id: string | null
  machine_id: string
  operator_id: string
  shift_type: string | null
  shift_date: string | null
  photo_path: string
  captured_at: string
  ocr_status: ShiftStatOcrStatus
  ocr_error: string | null
  ocr_attempts: number
  raw_response: string | null
  created_at: string
  // joined
  machine?: Machine
  operator?: { id: string; full_name: string }
}

export interface ShiftStatReading {
  id: string
  photo_id: string
  metric_label: string
  metric_value: string
  numeric_value: number | null
  station_key: string | null
  confirmed: boolean
  corrected_value: string | null
  sort_order: number
  created_at: string
}
