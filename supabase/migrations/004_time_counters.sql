-- Migracja 004: zamiana 5 czasów na 3 liczniki narastające
-- Uruchom w Supabase SQL Editor

-- Dodaj liczniki czasów (stany narastające)
ALTER TABLE hourly_reports
  ADD COLUMN IF NOT EXISTS counter_runtime    INT,  -- licznik: czas pracy
  ADD COLUMN IF NOT EXISTS counter_ready      INT,  -- licznik: czas w gotowości
  ADD COLUMN IF NOT EXISTS counter_alarm      INT;  -- licznik: czas w alarmie

-- Zmień kolumny czasów na przyrosty (obliczone z liczników)
-- runtime_min już istnieje — zostaje jako przyrost czasu pracy
-- Dodaj przyrosty gotowości i alarmu
ALTER TABLE hourly_reports
  ADD COLUMN IF NOT EXISTS ready_min  INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alarm_min  INT DEFAULT 0;

-- Zaktualizuj machine_rate żeby używał runtime_min (przyrost)
-- (kolumna już istnieje z migracji 003)

-- Dodaj wskaźnik dostępności maszyny
ALTER TABLE hourly_reports
  ADD COLUMN IF NOT EXISTS availability_pct NUMERIC GENERATED ALWAYS AS (
    CASE WHEN (runtime_min + COALESCE(ready_min,0) + COALESCE(alarm_min,0)) > 0
    THEN ROUND(runtime_min::NUMERIC / (runtime_min + COALESCE(ready_min,0) + COALESCE(alarm_min,0)) * 100, 1)
    ELSE 0 END
  ) STORED;
