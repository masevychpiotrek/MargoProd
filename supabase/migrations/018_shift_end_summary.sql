-- End-of-shift summary entered on the shift closing screen.
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS summary_good_count INT,
  ADD COLUMN IF NOT EXISTS summary_reject_count INT,
  ADD COLUMN IF NOT EXISTS summary_runtime_min INT,
  ADD COLUMN IF NOT EXISTS summary_ready_min INT,
  ADD COLUMN IF NOT EXISTS summary_alarm_min INT,
  ADD COLUMN IF NOT EXISTS summary_downtime_min INT,
  ADD COLUMN IF NOT EXISTS summary_notes TEXT;
