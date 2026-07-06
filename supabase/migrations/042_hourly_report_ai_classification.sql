-- AI-owa klasyfikacja przyczyn niskiej wydajności / nadmiernego odrzutu
-- Rozbudowa hourly_reports o ustandaryzowane pola obok istniejących downtime_reason / reject_reason.
-- Wszystkie kolumny nullable, bez CHECK (zgodnie ze stylem projektu - patrz 008, 019) -
-- zapis musi działać identycznie zanim UI zacznie je wypełniać (deploy migracji i UI nie są atomowe).

ALTER TABLE hourly_reports
  ADD COLUMN IF NOT EXISTS downtime_station text,
  ADD COLUMN IF NOT EXISTS downtime_category text,
  ADD COLUMN IF NOT EXISTS downtime_problem_name text,
  ADD COLUMN IF NOT EXISTS downtime_status text,
  ADD COLUMN IF NOT EXISTS downtime_action_taken text,
  ADD COLUMN IF NOT EXISTS downtime_validated_by text,
  ADD COLUMN IF NOT EXISTS reject_station text,
  ADD COLUMN IF NOT EXISTS reject_category text,
  ADD COLUMN IF NOT EXISTS reject_problem_name text,
  ADD COLUMN IF NOT EXISTS reject_status text,
  ADD COLUMN IF NOT EXISTS reject_action_taken text,
  ADD COLUMN IF NOT EXISTS reject_validated_by text;
