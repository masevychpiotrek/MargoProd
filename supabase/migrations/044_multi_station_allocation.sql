-- Kilka stacji na jedno zgloszenie z orientacyjnym procentowym udzialem kazdej z nich.
-- Istniejace kolumny downtime_station / reject_station zostaja jako "stacja glowna"
-- (ta o najwyzszym udziale %), wypelniana automatycznie przez klienta - bez zmian
-- wstecznej zgodnosci dla miejsc, ktore jeszcze ich nie odczytuja jako tablicy.
ALTER TABLE hourly_reports
  ADD COLUMN IF NOT EXISTS downtime_stations jsonb,
  ADD COLUMN IF NOT EXISTS reject_stations jsonb;
