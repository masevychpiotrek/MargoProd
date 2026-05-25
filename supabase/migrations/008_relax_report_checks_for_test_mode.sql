-- The app now validates production rules in the UI.
-- Test mode needs to save short sample blocks, so database checks cannot force a full hour.

ALTER TABLE hourly_reports
  DROP CONSTRAINT IF EXISTS times_sum_60,
  DROP CONSTRAINT IF EXISTS reason_required;
