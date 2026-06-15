-- Automatic production alerts generated from hourly results.

ALTER TABLE public.failure_reports
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hourly_report_id UUID REFERENCES public.hourly_reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_alert_type TEXT,
  ADD COLUMN IF NOT EXISTS auto_metrics JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_failure_reports_auto_hourly_type
  ON public.failure_reports(hourly_report_id, auto_alert_type)
  WHERE auto_generated = true
    AND hourly_report_id IS NOT NULL
    AND auto_alert_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_failure_reports_auto_generated
  ON public.failure_reports(auto_generated, status, created_at DESC);
