// Auto-generated types — odzwierciedlają schemat bazy
// Można aktualizować przez: npx supabase gen types typescript --project-id TWOJ_ID

export type UserRole = 'operator' | 'manager' | 'admin' | 'specialist'
export type ShiftType = 'I' | 'II' | 'III'
export type ReportStatus = 'pending' | 'submitted' | 'approved' | 'rejected'
export type DowntimeCategory =
  | 'mechanical_failure' | 'electrical_failure' | 'material_shortage'
  | 'quality_control' | 'changeover' | 'no_operator' | 'cleaning'
  | 'process_issue' | 'logistics_issue' | 'other'
export type NotificationType = 'report_due' | 'alarm' | 'system' | 'info' | 'failure_report'
export type AuditAction =
  | 'login' | 'logout' | 'report_create' | 'report_update' | 'report_delete'
  | 'user_create' | 'user_update' | 'user_delete' | 'password_change'
  | 'shift_start' | 'shift_end' | 'config_change'
  | 'failure_report_create' | 'failure_report_update'

export type FailureSeverity = 'low' | 'medium' | 'high' | 'critical'
export type FailureStatus   = 'new' | 'acknowledged' | 'in_progress' | 'resolved'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  is_active: boolean
  must_change_password?: boolean
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
