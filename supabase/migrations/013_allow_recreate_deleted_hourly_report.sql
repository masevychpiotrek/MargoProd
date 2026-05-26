-- Soft-deleted hourly reports must not reserve an hour block forever.
-- This lets a manager delete a bad report and the operator enter that hour again.

ALTER TABLE public.hourly_reports
  DROP CONSTRAINT IF EXISTS hourly_reports_shift_id_hour_start_key;

DROP INDEX IF EXISTS public.hourly_reports_active_shift_hour_key;

CREATE UNIQUE INDEX hourly_reports_active_shift_hour_key
  ON public.hourly_reports (shift_id, hour_start)
  WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
