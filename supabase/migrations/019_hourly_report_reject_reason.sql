-- Separate explanation for high reject rate from explanation for low output.
ALTER TABLE public.hourly_reports
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;
