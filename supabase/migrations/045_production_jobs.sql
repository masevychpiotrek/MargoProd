-- Zlecenie produkcyjne — identyfikowalnosc polfabrykatow (modul operator IS PRO)
-- Nowa, samodzielna funkcja - NIE mylic z istniejaca tabela production_orders (migracja 005),
-- ktora sledzi target_qty/produced_qty i jest dzis wylaczona (ORDERS_ENABLED = false).

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'production_job_start';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'production_job_component_update';

CREATE SEQUENCE IF NOT EXISTS production_job_seq START 1;

CREATE TABLE production_jobs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number          TEXT NOT NULL UNIQUE,
  series_number         TEXT,
  assortment_name       TEXT NOT NULL,
  assortment_length_cm  INT NOT NULL,
  label_count           INT NOT NULL,
  multiplier            INT NOT NULL,
  calculated_qty        INT NOT NULL,
  machine_id            UUID NOT NULL REFERENCES machines(id),
  shift_id              UUID REFERENCES shifts(id),
  operator_id           UUID NOT NULL REFERENCES profiles(id),
  shift_type            TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                TEXT NOT NULL DEFAULT 'active', -- 'active' | 'confirmed'
  confirmed_at          TIMESTAMPTZ,
  confirmed_by          UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_production_jobs_machine ON production_jobs(machine_id);
CREATE INDEX idx_production_jobs_status  ON production_jobs(status);

-- Jedno aktywne (niepotwierdzone) zlecenie na automat - zapobiega podwojnemu
-- startowi (dwie karty przegladarki, double-submit) na poziomie bazy.
CREATE UNIQUE INDEX idx_production_jobs_one_active_per_machine
  ON production_jobs(machine_id) WHERE status = 'active';

CREATE TABLE production_job_components (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  component_key   TEXT NOT NULL,
  component_label TEXT NOT NULL,
  is_dren         BOOLEAN NOT NULL DEFAULT false,
  batch_number    TEXT,
  status          TEXT NOT NULL DEFAULT 'oczekuje', -- 'oczekuje' | 'aktywny'
  entered_at      TIMESTAMPTZ,
  entered_by      UUID REFERENCES profiles(id),
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, component_key)
);

CREATE INDEX idx_pjc_job ON production_job_components(job_id);

CREATE TABLE production_job_component_history (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  component_id          UUID NOT NULL REFERENCES production_job_components(id) ON DELETE CASCADE,
  job_id                UUID NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  previous_batch_number TEXT,
  new_batch_number      TEXT NOT NULL,
  changed_by            UUID REFERENCES profiles(id),
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pjch_job       ON production_job_component_history(job_id);
CREATE INDEX idx_pjch_component ON production_job_component_history(component_id);

-- ────────────────────────────────────────────────────────────
-- Numeracja zlecenia (SEQUENCE - atomowa, bez wyscigu) i serii produkcyjnej
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION production_job_set_numbers()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    NEW.order_number := 'ZP/' || LPAD(nextval('production_job_seq')::text, 6, '0') || '/' || TO_CHAR(NOW(), 'MM/YY');
  END IF;
  IF NEW.series_number IS NULL OR NEW.series_number = '' THEN
    NEW.series_number := 'SER-' || COALESCE((SELECT code FROM machines WHERE id = NEW.machine_id), 'X') || '-' ||
      TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
      LPAD((
        SELECT COUNT(*) + 1 FROM production_jobs
        WHERE machine_id = NEW.machine_id AND started_at::date = CURRENT_DATE
      )::text, 2, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_production_job_set_numbers
  BEFORE INSERT ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION production_job_set_numbers();

-- ────────────────────────────────────────────────────────────
-- Auto-tworzenie 20 wierszy komponentow (12 standardowych + 8 pozycji drenu)
-- SECURITY DEFINER - operator nigdy nie wstawia wierszy komponentow bezposrednio,
-- tylko system przez ten trigger; RLS ponizej celowo nie daje INSERT zwyklym rolom.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION production_job_seed_components()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  INSERT INTO production_job_components (job_id, component_key, component_label, is_dren, sort_order) VALUES
    (NEW.id, 'oslonka_igly_biorczej',      'Osłonka igły biorczej',        false, 1),
    (NEW.id, 'zatyczka_odpowietrznika',    'Zatyczka odpowietrznika',      false, 2),
    (NEW.id, 'igla_biorcza',               'Igła biorcza',                 false, 3),
    (NEW.id, 'komora_kroplowa',            'Komora kroplowa',              false, 4),
    (NEW.id, 'oslonka_lacznika_luer_lock', 'Osłonka łącznika luer lock',   false, 5),
    (NEW.id, 'lacznik_luer_lock',          'Łącznik luer lock',            false, 6),
    (NEW.id, 'regulator_przeplywu',        'Regulator przepływu',          false, 7),
    (NEW.id, 'rolka_regulatora_przeplywu', 'Rolka regulatora przepływu',   false, 8),
    (NEW.id, 'tasma_zabezpieczajaca',      'Taśma zabezpieczająca',        false, 9),
    (NEW.id, 'filtr_powietrza',            'Filtr powietrza',              false, 10),
    (NEW.id, 'filtr_plynu',                'Filtr płynu',                  false, 11),
    (NEW.id, 'rozpuszczalnik',             'Rozpuszczalnik',               false, 12),
    (NEW.id, 'dren_st1_lewa',  'Stacja 1 — lewa',  true, 13),
    (NEW.id, 'dren_st1_prawa', 'Stacja 1 — prawa', true, 14),
    (NEW.id, 'dren_st2_lewa',  'Stacja 2 — lewa',  true, 15),
    (NEW.id, 'dren_st2_prawa', 'Stacja 2 — prawa', true, 16),
    (NEW.id, 'dren_st3_lewa',  'Stacja 3 — lewa',  true, 17),
    (NEW.id, 'dren_st3_prawa', 'Stacja 3 — prawa', true, 18),
    (NEW.id, 'dren_st4_lewa',  'Stacja 4 — lewa',  true, 19),
    (NEW.id, 'dren_st4_prawa', 'Stacja 4 — prawa', true, 20);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_production_job_seed_components
  AFTER INSERT ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION production_job_seed_components();

CREATE TRIGGER trg_production_jobs_updated
  BEFORE UPDATE ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_production_job_components_updated
  BEFORE UPDATE ON production_job_components
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE production_jobs                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_job_components           ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_job_component_history     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "production_jobs_read" ON production_jobs FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "production_jobs_insert" ON production_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('operator', 'manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );
CREATE POLICY "production_jobs_update" ON production_jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('operator', 'manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );

-- Brak polityki INSERT dla production_job_components dla zwyklych rol - wiersze
-- powstaja wylacznie przez trigger SECURITY DEFINER powyzej.
CREATE POLICY "production_job_components_read" ON production_job_components FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "production_job_components_update" ON production_job_components FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('operator', 'manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );

CREATE POLICY "production_job_component_history_read" ON production_job_component_history FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "production_job_component_history_insert" ON production_job_component_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('operator', 'manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );
