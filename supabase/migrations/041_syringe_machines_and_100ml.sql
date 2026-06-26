-- ============================================================
-- Margoline MES — Automaty linii strzykawkowej + asortyment 100 ml
-- Migration 041
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. BRAKUJĄCY ASORTYMENT — Strzykawka 100 ml
-- ────────────────────────────────────────────────────────────
INSERT INTO sa_assortments (name, code, volume_ml, nominal_per_hour, sort_order) VALUES
  ('Strzykawka 100 ml', 'SYR_100ML', 100, 600, 6)
ON CONFLICT (code) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. AUTOMATY STRZYKAWKOWE (po jednym na pojemność)
-- ────────────────────────────────────────────────────────────
INSERT INTO sa_machines (name, code, nominal_per_hour, sort_order) VALUES
  ('Automat strzykawkowy 2 ml',   'SA-2ML',   2400, 1),
  ('Automat strzykawkowy 5 ml',   'SA-5ML',   2000, 2),
  ('Automat strzykawkowy 10 ml',  'SA-10ML',  1600, 3),
  ('Automat strzykawkowy 20 ml',  'SA-20ML',  1200, 4),
  ('Automat strzykawkowy 50 ml',  'SA-50ML',   800, 5),
  ('Automat strzykawkowy 100 ml', 'SA-100ML',  600, 6)
ON CONFLICT (code) DO NOTHING;
