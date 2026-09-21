-- ============================================================
-- Margoline MES — Dwa liczniki (druk/montaż) + cele zmianowe na linię
-- Migration 042
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. CELE ZMIANOWE NA ASORTYMENT (ilość + % odrzutu)
-- ────────────────────────────────────────────────────────────
ALTER TABLE sa_assortments
  ADD COLUMN IF NOT EXISTS shift_target_qty   INT,
  ADD COLUMN IF NOT EXISTS reject_target_pct  NUMERIC(5,2) NOT NULL DEFAULT 5.0;

UPDATE sa_assortments SET shift_target_qty = 90000, reject_target_pct = 5.0 WHERE code = 'SYR_2ML';
UPDATE sa_assortments SET shift_target_qty = 80000, reject_target_pct = 5.0 WHERE code = 'SYR_5ML';
UPDATE sa_assortments SET shift_target_qty = 80000, reject_target_pct = 5.0 WHERE code = 'SYR_10ML';
UPDATE sa_assortments SET shift_target_qty = 70000, reject_target_pct = 5.0 WHERE code = 'SYR_20ML';
UPDATE sa_assortments SET shift_target_qty = 25000, reject_target_pct = 5.0 WHERE code = 'SYR_50ML';
UPDATE sa_assortments SET shift_target_qty = 18000, reject_target_pct = 5.0 WHERE code = 'SYR_100ML';

-- ────────────────────────────────────────────────────────────
-- 2. DWA LICZNIKI NA WPISIE PRODUKCYJNYM
--    Automat drukujący (nadruk) i automat montujący (montaż).
--    Różnica (druk - montaż) = braki powstałe między etapami.
--    counter_value/counter_reset zostają jako pole zbiorcze
--    (zawsze lustro licznika montażu) — dla wstecznej zgodności
--    z ekranami, które jeszcze go czytają (pulpit, przekazanie zmiany).
-- ────────────────────────────────────────────────────────────
ALTER TABLE sa_production_entries
  ADD COLUMN IF NOT EXISTS counter_print_value         BIGINT,
  ADD COLUMN IF NOT EXISTS counter_print_reset         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS counter_print_reset_reason  TEXT,
  ADD COLUMN IF NOT EXISTS counter_assembly_value        BIGINT,
  ADD COLUMN IF NOT EXISTS counter_assembly_reset        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS counter_assembly_reset_reason TEXT;

COMMENT ON COLUMN sa_production_entries.counter_print_value IS 'Stan licznika automatu drukującego (nadruk)';
COMMENT ON COLUMN sa_production_entries.counter_assembly_value IS 'Stan licznika automatu montującego — różnica względem druku to braki';
