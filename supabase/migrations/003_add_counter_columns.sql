-- Dodaj kolumny: stan licznika i wskaźniki
ALTER TABLE hourly_reports
  ADD COLUMN IF NOT EXISTS counter_good   INT,
  ADD COLUMN IF NOT EXISTS counter_reject INT;

ALTER TABLE hourly_reports
  ADD COLUMN IF NOT EXISTS machine_rate NUMERIC GENERATED ALWAYS AS (
    CASE WHEN runtime_min > 0
    THEN ROUND(good_count::NUMERIC / runtime_min * 60, 1)
    ELSE 0 END
  ) STORED;

ALTER TABLE hourly_reports
  ADD COLUMN IF NOT EXISTS reject_pct NUMERIC GENERATED ALWAYS AS (
    CASE WHEN (good_count + reject_count) > 0
    THEN ROUND(reject_count::NUMERIC / (good_count + reject_count) * 100, 1)
    ELSE 0 END
  ) STORED;
