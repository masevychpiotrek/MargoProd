-- ============================================================
-- MargoProd MES — Seed data
-- Uruchom PO migracji 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- MASZYNY
-- ============================================================
INSERT INTO machines (name, code, department, target_per_hour) VALUES
  ('Automat 3', 'A3', 'Montaż Automatyczny', 3200),
  ('Automat 4', 'A4', 'Montaż Automatyczny', 3200)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- HARMONOGRAM DOMYŚLNY
-- ============================================================
INSERT INTO schedules (name, work_start, work_end, active_shifts, off_weekdays) VALUES
  ('Standardowy', '06:00', '22:00', ARRAY['I','II','III']::shift_type[], ARRAY[0,6])
ON CONFLICT DO NOTHING;

-- ============================================================
-- KONTA UŻYTKOWNIKÓW
-- Wklej ten blok w Supabase SQL Editor
-- Domyślne hasło: Margomed123
-- ============================================================

-- ADMIN
SELECT create_user_with_profile(
  'admin@margomed.pl', 'Margomed123',
  'Administrator Systemu', 'admin'
);

-- KIEROWNIK
SELECT create_user_with_profile(
  'kierownik@margomed.pl', 'Margomed123',
  'Kierownik Zmiany', 'manager'
);

-- OPERATORZY
SELECT create_user_with_profile('marcel.pelczynski@margomed.pl',   'Margomed123', 'Marcel Pełczyński',    'operator');
SELECT create_user_with_profile('milosz.pelczynski@margomed.pl',   'Margomed123', 'Miłosz Pełczyński',    'operator');
SELECT create_user_with_profile('patryk.grelak@margomed.pl',       'Margomed123', 'Patryk Grelak',        'operator');
SELECT create_user_with_profile('damian.wiacek@margomed.pl',       'Margomed123', 'Damian Wiącek',        'operator');
SELECT create_user_with_profile('agnieszka.kowalik@margomed.pl',   'Margomed123', 'Agnieszka Kowalik',    'operator');
SELECT create_user_with_profile('kacper.wojciechowski@margomed.pl','Margomed123', 'Kacper Wojciechowski', 'operator');
SELECT create_user_with_profile('michal.broniek@margomed.pl',      'Margomed123', 'Michał Broniek',       'operator');
SELECT create_user_with_profile('szymon.jaslikowski@margomed.pl',  'Margomed123', 'Szymon Jaślikowski',   'operator');
SELECT create_user_with_profile('iwona.cichosz@margomed.pl',       'Margomed123', 'Iwona Cichosz',        'operator');
SELECT create_user_with_profile('fabian.szlendak@margomed.pl',     'Margomed123', 'Fabian Szlendak',      'operator');
SELECT create_user_with_profile('jakub.chodun@margomed.pl',        'Margomed123', 'Jakub Chodun',         'operator');
SELECT create_user_with_profile('mateusz.hulak@margomed.pl',       'Margomed123', 'Mateusz Hulak',        'operator');
SELECT create_user_with_profile('konrad.wabik@margomed.pl',        'Margomed123', 'Konrad Wabik',         'operator');
SELECT create_user_with_profile('michal.caban@margomed.pl',        'Margomed123', 'Michał Caban',         'operator');
SELECT create_user_with_profile('jakub.wadowski@margomed.pl',      'Margomed123', 'Jakub Wadowski',       'operator');
