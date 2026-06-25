-- ============================================================
-- Margoline MES — Moduł TPM/PM — IS PRO — Etap 2
-- Karty PM, rejestr parametrów, rejestr części krytycznych
-- Migration 038
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. SZABLONY CZYNNOŚCI PM (per stacja, edytowalne)
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_pm_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id  UUID NOT NULL REFERENCES tpm_stations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_pmt_station ON tpm_pm_templates(station_id);

-- ────────────────────────────────────────────────────────────
-- 2. KARTY PM (instancja przeglądu)
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_pm_cards (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_number   TEXT UNIQUE,
  machine_id    UUID NOT NULL REFERENCES tpm_machines(id),
  station_id    UUID NOT NULL REFERENCES tpm_stations(id),
  planned_date  DATE NOT NULL,
  actual_date   DATE,
  performer_id  UUID REFERENCES profiles(id),
  start_time    TIMESTAMPTZ,
  end_time      TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned','todo','in_progress','done','done_late',
                                  'not_done','needs_action','awaiting_approval','approved')),
  findings      TEXT,
  actions       TEXT,
  parts_used    TEXT,
  recommendations TEXT,
  next_due_date DATE,
  approved_by   UUID REFERENCES profiles(id),
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_pm_machine ON tpm_pm_cards(machine_id);
CREATE INDEX idx_tpm_pm_station ON tpm_pm_cards(station_id);
CREATE INDEX idx_tpm_pm_status  ON tpm_pm_cards(status);
CREATE INDEX idx_tpm_pm_planned ON tpm_pm_cards(planned_date);

-- ────────────────────────────────────────────────────────────
-- 3. WYNIKI CZYNNOŚCI PM
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_pm_results (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id     UUID NOT NULL REFERENCES tpm_pm_cards(id) ON DELETE CASCADE,
  template_id UUID REFERENCES tpm_pm_templates(id),
  name        TEXT NOT NULL,
  result      TEXT NOT NULL DEFAULT 'ok' CHECK (result IN ('ok','nok','na')),
  measurement TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_pmr_card ON tpm_pm_results(card_id);

-- numer karty PM: PM-IS3-ST24-2026-0001
CREATE OR REPLACE FUNCTION tpm_generate_pm_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_mcode TEXT; v_snum TEXT; v_year TEXT; v_seq INT;
BEGIN
  IF NEW.card_number IS NOT NULL THEN RETURN NEW; END IF;
  SELECT regexp_replace(code, '[^A-Za-z0-9]', '', 'g') INTO v_mcode FROM tpm_machines WHERE id = NEW.machine_id;
  SELECT regexp_replace(station_number, '[^A-Za-z0-9]', '', 'g') INTO v_snum FROM tpm_stations WHERE id = NEW.station_id;
  v_year := to_char(COALESCE(NEW.planned_date, CURRENT_DATE), 'YYYY');
  SELECT COUNT(*) + 1 INTO v_seq FROM tpm_pm_cards
    WHERE machine_id = NEW.machine_id AND station_id = NEW.station_id
      AND to_char(planned_date, 'YYYY') = v_year;
  NEW.card_number := 'PM-' || v_mcode || '-' || v_snum || '-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_tpm_pm_number BEFORE INSERT ON tpm_pm_cards
  FOR EACH ROW EXECUTE FUNCTION tpm_generate_pm_number();

-- ────────────────────────────────────────────────────────────
-- 4. REJESTR ZMIAN PARAMETRÓW
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_parameters (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id      UUID NOT NULL REFERENCES tpm_machines(id),
  station_id      UUID NOT NULL REFERENCES tpm_stations(id),
  issue_id        UUID REFERENCES tpm_issues(id) ON DELETE SET NULL,
  user_id         UUID NOT NULL REFERENCES profiles(id),
  param_name      TEXT NOT NULL,
  value_before    TEXT,
  value_after     TEXT NOT NULL,
  unit            TEXT,
  approved_range  TEXT,
  reason          TEXT,
  expected_effect TEXT,
  result_after    TEXT,
  test_cycles     INT,
  test_ok         INT,
  test_nok        INT,
  screen_photo_url TEXT,
  setting_photo_url TEXT,
  comment         TEXT,
  out_of_range    BOOLEAN NOT NULL DEFAULT false,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  approved_by     UUID REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  is_last_good    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_param_station ON tpm_parameters(station_id, created_at DESC);
CREATE INDEX idx_tpm_param_issue   ON tpm_parameters(issue_id);

-- ────────────────────────────────────────────────────────────
-- 5. REJESTR CZĘŚCI KRYTYCZNYCH
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_parts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id    UUID REFERENCES tpm_machines(id),
  station_id    UUID REFERENCES tpm_stations(id),
  name          TEXT NOT NULL,
  part_number   TEXT,
  manufacturer_number TEXT,
  manufacturer  TEXT,
  usage_desc    TEXT,
  min_stock     NUMERIC(10,2) NOT NULL DEFAULT 0,
  current_stock NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit          TEXT NOT NULL DEFAULT 'szt',
  location      TEXT,
  lead_time_days INT,
  last_used_at  TIMESTAMPTZ,
  used_count    INT NOT NULL DEFAULT 0,
  photo_url     TEXT,
  status        TEXT NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','low','minimum','none','ordered',
                                  'awaiting_delivery','delivered','withdrawn')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_parts_station ON tpm_parts(station_id);
CREATE INDEX idx_tpm_parts_status  ON tpm_parts(status);

-- ────────────────────────────────────────────────────────────
-- 6. ZUŻYCIE CZĘŚCI
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_part_usages (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_id   UUID NOT NULL REFERENCES tpm_parts(id) ON DELETE CASCADE,
  issue_id  UUID REFERENCES tpm_issues(id) ON DELETE SET NULL,
  pm_card_id UUID REFERENCES tpm_pm_cards(id) ON DELETE SET NULL,
  user_id   UUID NOT NULL REFERENCES profiles(id),
  qty       NUMERIC(10,2) NOT NULL DEFAULT 1,
  used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_pu_part  ON tpm_part_usages(part_id);
CREATE INDEX idx_tpm_pu_issue ON tpm_part_usages(issue_id);

-- ────────────────────────────────────────────────────────────
-- 7. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE tpm_pm_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_pm_cards     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_pm_results   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_parameters   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_parts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_part_usages  ENABLE ROW LEVEL SECURITY;

CREATE POLICY tpm_pmt_read   ON tpm_pm_templates FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tpm_pmt_manage ON tpm_pm_templates FOR ALL
  USING (tpm_role() IN ('specialist','manager','admin')) WITH CHECK (tpm_role() IN ('specialist','manager','admin'));

CREATE POLICY tpm_pm_read   ON tpm_pm_cards FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tpm_pm_insert ON tpm_pm_cards FOR INSERT
  WITH CHECK (tpm_role() IN ('specialist','manager','admin'));
CREATE POLICY tpm_pm_update ON tpm_pm_cards FOR UPDATE
  USING (tpm_role() IN ('specialist','manager','admin'));

CREATE POLICY tpm_pmr_read   ON tpm_pm_results FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tpm_pmr_write  ON tpm_pm_results FOR ALL
  USING (tpm_role() IN ('specialist','manager','admin')) WITH CHECK (tpm_role() IN ('specialist','manager','admin'));

CREATE POLICY tpm_param_read   ON tpm_parameters FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tpm_param_insert ON tpm_parameters FOR INSERT
  WITH CHECK (user_id = auth.uid() AND tpm_role() IN ('specialist','manager','admin'));
CREATE POLICY tpm_param_update ON tpm_parameters FOR UPDATE
  USING (tpm_role() IN ('manager','admin'));

CREATE POLICY tpm_parts_read   ON tpm_parts FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tpm_parts_manage ON tpm_parts FOR ALL
  USING (tpm_role() IN ('specialist','manager','admin')) WITH CHECK (tpm_role() IN ('specialist','manager','admin'));

CREATE POLICY tpm_pu_read   ON tpm_part_usages FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tpm_pu_insert ON tpm_part_usages FOR INSERT
  WITH CHECK (user_id = auth.uid() AND tpm_role() IN ('specialist','manager','admin'));

-- ────────────────────────────────────────────────────────────
-- 8. REALTIME
-- ────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE tpm_pm_cards;
ALTER PUBLICATION supabase_realtime ADD TABLE tpm_parts;

-- ────────────────────────────────────────────────────────────
-- 9. DANE STARTOWE — szablony PM dla ST24
-- ────────────────────────────────────────────────────────────
INSERT INTO tpm_pm_templates (station_id, name, sort_order)
SELECT st.id, t.nm, t.ord
FROM tpm_stations st
CROSS JOIN (VALUES
  ('Kontrola i czyszczenie stacji', 1),
  ('Sprawdzenie i regulacja czujników', 2),
  ('Sprawdzenie stanu chwytaków', 3),
  ('Sprawdzenie stanu gniazd', 4),
  ('Sprawdzenie siłowników i pneumatyki', 5),
  ('Pomiar parametrów pracy', 6),
  ('Kontrola luzów i mocowań', 7),
  ('Test pracy po przeglądzie', 8)
) AS t(nm, ord)
WHERE st.station_number = 'ST24';

-- domyślny zestaw PM dla pozostałych stacji
INSERT INTO tpm_pm_templates (station_id, name, sort_order)
SELECT st.id, t.nm, t.ord
FROM tpm_stations st
CROSS JOIN (VALUES
  ('Kontrola i czyszczenie stacji', 1),
  ('Sprawdzenie i regulacja czujników', 2),
  ('Sprawdzenie elementów mechanicznych', 3),
  ('Sprawdzenie siłowników i pneumatyki', 4),
  ('Pomiar parametrów pracy', 5),
  ('Test pracy po przeglądzie', 6)
) AS t(nm, ord)
WHERE st.station_number <> 'ST24';
