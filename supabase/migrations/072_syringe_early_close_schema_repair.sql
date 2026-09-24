-- Repair databases where sa_mark_early_finish was updated by 071 but the
-- early-close columns from 066/067 were not installed. Safe to run again.
BEGIN;

ALTER TABLE public.sa_sessions
  ADD COLUMN IF NOT EXISTS ended_early boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS early_end_reason text,
  ADD COLUMN IF NOT EXISTS early_missing_blocks integer[] NOT NULL DEFAULT ARRAY[]::integer[];

DROP TRIGGER IF EXISTS trg_sa_mark_early_finish ON public.sa_sessions;
CREATE TRIGGER trg_sa_mark_early_finish
BEFORE UPDATE OF ended_at, summary_notes, early_end_reason, early_missing_blocks ON public.sa_sessions
FOR EACH ROW
EXECUTE FUNCTION public.sa_mark_early_finish();

NOTIFY pgrst, 'reload schema';
COMMIT;
