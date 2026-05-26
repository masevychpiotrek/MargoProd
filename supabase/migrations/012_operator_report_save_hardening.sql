-- Harden operator report saving after introducing runtime/ready/alarm counters.
-- Keeps older databases compatible with the current app form.

ALTER TABLE public.hourly_reports
  ADD COLUMN IF NOT EXISTS counter_good INT,
  ADD COLUMN IF NOT EXISTS counter_reject INT,
  ADD COLUMN IF NOT EXISTS counter_runtime INT,
  ADD COLUMN IF NOT EXISTS counter_ready INT,
  ADD COLUMN IF NOT EXISTS counter_alarm INT,
  ADD COLUMN IF NOT EXISTS ready_min INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alarm_min INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.production_orders(id),
  ADD COLUMN IF NOT EXISTS order_qty INT DEFAULT 0;

ALTER TABLE public.hourly_reports
  ALTER COLUMN ready_min SET DEFAULT 0,
  ALTER COLUMN alarm_min SET DEFAULT 0,
  ALTER COLUMN order_qty SET DEFAULT 0;

ALTER TABLE public.hourly_reports
  DROP CONSTRAINT IF EXISTS times_sum_60,
  DROP CONSTRAINT IF EXISTS reason_required;

CREATE INDEX IF NOT EXISTS idx_reports_order ON public.hourly_reports(order_id);
