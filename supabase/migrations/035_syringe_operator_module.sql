-- ============================================================
-- Margoline MES — Moduł Operator Automatów Strzykawkowych
-- Migration 035
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. NOWA ROLA
-- ────────────────────────────────────────────────────────────
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'syringe_operator';

-- ────────────────────────────────────────────────────────────
-- 2. ASORTYMENTY STRZYKAWKOWE
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_assortments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  volume_ml       NUMERIC(6,2),
  nominal_per_hour INT NOT NULL DEFAULT 1000,
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sa_assortments_active ON sa_assortments(is_active);

-- ────────────────────────────────────────────────────────────
-- 3. AUTOMATY STRZYKAWKOWE
--    Osobna tabela — niezależna od machines (IS PRO)
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_machines (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  code                TEXT NOT NULL UNIQUE,
  description         TEXT,
  location            TEXT,
  nominal_per_hour    INT NOT NULL DEFAULT 1000,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  sort_order          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_sa_machines_active ON sa_machines(is_active) WHERE deleted_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 4. ZLECENIA PRODUKCYJNE STRZYKAWKOWE
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number    TEXT NOT NULL UNIQUE,
  machine_id      UUID REFERENCES sa_machines(id),
  assortment_id   UUID NOT NULL REFERENCES sa_assortments(id),
  target_qty      INT NOT NULL,
  produced_qty    INT NOT NULL DEFAULT 0,
  good_qty        INT NOT NULL DEFAULT 0,
  reject_qty      INT NOT NULL DEFAULT 0,
  planned_date    DATE,
  status          TEXT NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','in_progress','completed','cancelled','on_hold')),
  notes           TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sa_orders_machine ON sa_orders(machine_id);
CREATE INDEX idx_sa_orders_status  ON sa_orders(status);

-- ────────────────────────────────────────────────────────────
-- 5. SESJE OPERATORA (odpowiednik shift)
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id      UUID NOT NULL REFERENCES sa_machines(id),
  operator_id     UUID NOT NULL REFERENCES profiles(id),
  assortment_id   UUID NOT NULL REFERENCES sa_assortments(id),
  order_id        UUID REFERENCES sa_orders(id),
  shift_type      TEXT NOT NULL CHECK (shift_type IN ('I','II','III')),
  session_date    DATE NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  plan_qty        INT,
  -- status automatu
  machine_status  TEXT NOT NULL DEFAULT 'production'
                  CHECK (machine_status IN (
                    'production','changeover','failure','adjustment',
                    'no_components','quality_control','planned_stop',
                    'waiting','cleaning','end_of_production'
                  )),
  -- sumaryczne pola wypełniane przy zakończeniu zmiany
  total_produced  INT,
  total_good      INT,
  total_reject    INT,
  total_tech_reject INT,
  total_qual_reject INT,
  total_runtime_min INT,
  total_downtime_min INT,
  plan_pct        NUMERIC(6,2),
  avg_per_hour    NUMERIC(8,2),
  summary_notes   TEXT,
  -- flagi zakończenia
  handover_confirmed_by UUID REFERENCES profiles(id),
  handover_confirmed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sa_sessions_machine  ON sa_sessions(machine_id);
CREATE INDEX idx_sa_sessions_operator ON sa_sessions(operator_id);
CREATE INDEX idx_sa_sessions_date     ON sa_sessions(session_date);
CREATE INDEX idx_sa_sessions_active   ON sa_sessions(machine_id) WHERE ended_at IS NULL;

-- zakaz 2 aktywnych sesji na tym samym automacie jednocześnie
CREATE UNIQUE INDEX idx_sa_sessions_one_active
  ON sa_sessions(machine_id) WHERE ended_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 6. KATEGORIE BRAKÓW (konfigurowalne przez admina)
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_defect_categories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  defect_type     TEXT NOT NULL DEFAULT 'quality'
                  CHECK (defect_type IN ('quality','tech','other')),
  requires_comment BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 7. KATEGORIE PRZESTOJÓW (konfigurowalne przez admina)
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_downtime_categories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  category_type   TEXT NOT NULL DEFAULT 'unplanned'
                  CHECK (category_type IN ('planned','unplanned','quality','logistics')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 8. WPISY PRODUKCYJNE (rejestracja licznika)
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_production_entries (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id          UUID NOT NULL REFERENCES sa_sessions(id) ON DELETE CASCADE,
  machine_id          UUID NOT NULL REFERENCES sa_machines(id),
  operator_id         UUID NOT NULL REFERENCES profiles(id),
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  counter_value       BIGINT NOT NULL,
  counter_reset       BOOLEAN NOT NULL DEFAULT false,
  counter_reset_reason TEXT,
  produced_qty        INT NOT NULL DEFAULT 0,
  good_qty            INT NOT NULL DEFAULT 0,
  reject_qty          INT NOT NULL DEFAULT 0,
  tech_reject_qty     INT NOT NULL DEFAULT 0,
  qual_reject_qty     INT NOT NULL DEFAULT 0,
  -- obliczane przez system
  qty_since_last      INT,
  per_hour            NUMERIC(8,2),
  reject_pct          NUMERIC(6,2),
  plan_pct            NUMERIC(6,2),
  remaining_qty       INT,
  eta_minutes         INT,
  notes               TEXT,
  is_cancelled        BOOLEAN NOT NULL DEFAULT false,
  cancel_reason       TEXT,
  cancelled_by        UUID REFERENCES profiles(id),
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sa_pe_session    ON sa_production_entries(session_id);
CREATE INDEX idx_sa_pe_recorded   ON sa_production_entries(recorded_at DESC);

-- ────────────────────────────────────────────────────────────
-- 9. BRAKI (przypisane do wpisu produkcyjnego)
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_defect_entries (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id            UUID NOT NULL REFERENCES sa_production_entries(id) ON DELETE CASCADE,
  session_id          UUID NOT NULL REFERENCES sa_sessions(id),
  category_id         UUID NOT NULL REFERENCES sa_defect_categories(id),
  qty                 INT NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sa_de_entry   ON sa_defect_entries(entry_id);
CREATE INDEX idx_sa_de_session ON sa_defect_entries(session_id);

-- ────────────────────────────────────────────────────────────
-- 10. PRZESTOJE
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_downtime_events (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id          UUID NOT NULL REFERENCES sa_sessions(id) ON DELETE CASCADE,
  machine_id          UUID NOT NULL REFERENCES sa_machines(id),
  operator_id         UUID NOT NULL REFERENCES profiles(id),
  category_id         UUID NOT NULL REFERENCES sa_downtime_categories(id),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at            TIMESTAMPTZ,
  duration_min        INT,
  description         TEXT,
  actions_taken       TEXT,
  maintenance_needed  BOOLEAN NOT NULL DEFAULT false,
  fully_resolved      BOOLEAN,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sa_dt_session ON sa_downtime_events(session_id);
CREATE INDEX idx_sa_dt_active  ON sa_downtime_events(session_id) WHERE ended_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 11. ZGŁOSZENIA AWARII
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_failure_reports (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id          UUID REFERENCES sa_sessions(id),
  machine_id          UUID NOT NULL REFERENCES sa_machines(id),
  reporter_id         UUID NOT NULL REFERENCES profiles(id),
  reported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  component_name      TEXT,
  symptoms            TEXT NOT NULL,
  error_code          TEXT,
  photo_urls          TEXT[] NOT NULL DEFAULT '{}',
  priority            TEXT NOT NULL DEFAULT 'medium'
                      CHECK (priority IN ('low','medium','high','critical')),
  production_stopped  BOOLEAN NOT NULL DEFAULT false,
  can_continue        BOOLEAN NOT NULL DEFAULT true,
  status              TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN (
                        'new','acknowledged','in_progress',
                        'waiting_for_part','resolved','closed'
                      )),
  assigned_to         UUID REFERENCES profiles(id),
  resolution_notes    TEXT,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sa_fr_machine  ON sa_failure_reports(machine_id);
CREATE INDEX idx_sa_fr_status   ON sa_failure_reports(status);
CREATE INDEX idx_sa_fr_reporter ON sa_failure_reports(reporter_id);

-- ────────────────────────────────────────────────────────────
-- 12. PROBLEMY JAKOŚCIOWE
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_quality_issues (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id              UUID REFERENCES sa_sessions(id),
  machine_id              UUID NOT NULL REFERENCES sa_machines(id),
  assortment_id           UUID REFERENCES sa_assortments(id),
  order_id                UUID REFERENCES sa_orders(id),
  reporter_id             UUID NOT NULL REFERENCES profiles(id),
  detected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  batch_number            TEXT,
  description             TEXT NOT NULL,
  affected_qty            INT,
  photo_urls              TEXT[] NOT NULL DEFAULT '{}',
  operator_actions        TEXT,
  production_stopped      BOOLEAN NOT NULL DEFAULT false,
  product_separated       BOOLEAN NOT NULL DEFAULT false,
  separation_location     TEXT,
  status                  TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','under_review','resolved','closed')),
  resolution_notes        TEXT,
  resolved_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sa_qi_machine ON sa_quality_issues(machine_id);
CREATE INDEX idx_sa_qi_status  ON sa_quality_issues(status);

-- ────────────────────────────────────────────────────────────
-- 13. KOMPONENTY (zużycie podczas sesji)
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_component_usages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID NOT NULL REFERENCES sa_sessions(id) ON DELETE CASCADE,
  operator_id     UUID NOT NULL REFERENCES profiles(id),
  component_type  TEXT NOT NULL,  -- 'body','piston','seal','packaging','label','print_material','other'
  component_name  TEXT NOT NULL,
  batch_number    TEXT,
  qty_used        NUMERIC(10,3),
  unit            TEXT DEFAULT 'szt',
  used_from       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_to         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sa_cu_session ON sa_component_usages(session_id);

-- ────────────────────────────────────────────────────────────
-- 14. PRZEZBROJENIE
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_changeovers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id          UUID NOT NULL REFERENCES sa_sessions(id) ON DELETE CASCADE,
  machine_id          UUID NOT NULL REFERENCES sa_machines(id),
  operator_id         UUID NOT NULL REFERENCES profiles(id),
  from_assortment_id  UUID REFERENCES sa_assortments(id),
  to_assortment_id    UUID NOT NULL REFERENCES sa_assortments(id),
  counter_before      BIGINT,
  reason              TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at            TIMESTAMPTZ,
  duration_min        INT,
  approved_by         UUID REFERENCES profiles(id),
  approved_at         TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 15. CHECKLISTY PRZEZBROJENIA (konfigurowalne przez admina)
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_checklist_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  description     TEXT,
  is_required     BOOLEAN NOT NULL DEFAULT true,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sa_checklist_completions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  changeover_id   UUID NOT NULL REFERENCES sa_changeovers(id) ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES sa_checklist_items(id),
  completed       BOOLEAN NOT NULL DEFAULT false,
  completed_by    UUID REFERENCES profiles(id),
  completed_at    TIMESTAMPTZ,
  notes           TEXT,
  UNIQUE(changeover_id, item_id)
);

-- ────────────────────────────────────────────────────────────
-- 16. PRZEKAZANIE ZMIANY
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_handovers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id          UUID NOT NULL REFERENCES sa_sessions(id),
  from_operator_id    UUID NOT NULL REFERENCES profiles(id),
  to_operator_id      UUID REFERENCES profiles(id),
  machine_status      TEXT NOT NULL,
  current_assortment_id UUID REFERENCES sa_assortments(id),
  produced_qty        INT,
  remaining_qty       INT,
  active_issues       TEXT,
  adjustments_made    TEXT,
  unresolved_failures TEXT,
  quality_info        TEXT,
  component_status    TEXT,
  recommendations     TEXT,
  comment             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_by        UUID REFERENCES profiles(id),
  confirmed_at        TIMESTAMPTZ
);

CREATE INDEX idx_sa_handovers_session ON sa_handovers(session_id);

-- ────────────────────────────────────────────────────────────
-- 17. HISTORIA ZMIAN (audit dla modułu strzykawkowego)
-- ────────────────────────────────────────────────────────────
CREATE TABLE sa_audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES profiles(id),
  action          TEXT NOT NULL,
  table_name      TEXT,
  record_id       UUID,
  old_values      JSONB,
  new_values      JSONB,
  correction_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sa_audit_user    ON sa_audit_log(user_id);
CREATE INDEX idx_sa_audit_table   ON sa_audit_log(table_name, record_id);
CREATE INDEX idx_sa_audit_created ON sa_audit_log(created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 18. RLS POLICIES
-- ────────────────────────────────────────────────────────────

-- Helper: sprawdź rolę bieżącego użytkownika
CREATE OR REPLACE FUNCTION sa_get_my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role::text FROM profiles WHERE id = auth.uid() AND is_active = true AND deleted_at IS NULL;
$$;

-- Włącz RLS na wszystkich tabelach SA
ALTER TABLE sa_assortments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_machines             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_defect_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_downtime_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_production_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_defect_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_downtime_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_failure_reports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_quality_issues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_component_usages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_changeovers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_checklist_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_checklist_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_handovers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_audit_log            ENABLE ROW LEVEL SECURITY;

-- sa_assortments: wszyscy zalogowani mogą czytać; admin/manager modyfikują
CREATE POLICY sa_assortments_read ON sa_assortments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sa_assortments_manage ON sa_assortments FOR ALL
  USING (sa_get_my_role() IN ('admin','manager'))
  WITH CHECK (sa_get_my_role() IN ('admin','manager'));

-- sa_machines
CREATE POLICY sa_machines_read ON sa_machines FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sa_machines_manage ON sa_machines FOR ALL
  USING (sa_get_my_role() IN ('admin','manager'))
  WITH CHECK (sa_get_my_role() IN ('admin','manager'));

-- sa_orders
CREATE POLICY sa_orders_read ON sa_orders FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sa_orders_manage ON sa_orders FOR ALL
  USING (sa_get_my_role() IN ('admin','manager'))
  WITH CHECK (sa_get_my_role() IN ('admin','manager'));

-- sa_sessions: operator widzi swoje; manager/admin widzi wszystkie
CREATE POLICY sa_sessions_read ON sa_sessions FOR SELECT
  USING (
    sa_get_my_role() IN ('admin','manager','specialist','executive','viewer')
    OR operator_id = auth.uid()
  );
CREATE POLICY sa_sessions_insert ON sa_sessions FOR INSERT
  WITH CHECK (
    sa_get_my_role() IN ('syringe_operator','admin','manager')
    AND operator_id = auth.uid()
  );
CREATE POLICY sa_sessions_update ON sa_sessions FOR UPDATE
  USING (
    sa_get_my_role() IN ('admin','manager')
    OR (operator_id = auth.uid() AND ended_at IS NULL)
  );

-- sa_defect_categories / sa_downtime_categories: read dla wszystkich, manage dla admin
CREATE POLICY sa_dc_read  ON sa_defect_categories   FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sa_dc_manage ON sa_defect_categories  FOR ALL
  USING (sa_get_my_role() IN ('admin','manager'))
  WITH CHECK (sa_get_my_role() IN ('admin','manager'));

CREATE POLICY sa_dtc_read   ON sa_downtime_categories FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sa_dtc_manage ON sa_downtime_categories FOR ALL
  USING (sa_get_my_role() IN ('admin','manager'))
  WITH CHECK (sa_get_my_role() IN ('admin','manager'));

-- sa_production_entries
CREATE POLICY sa_pe_read ON sa_production_entries FOR SELECT
  USING (
    sa_get_my_role() IN ('admin','manager','specialist','executive','viewer')
    OR operator_id = auth.uid()
  );
CREATE POLICY sa_pe_insert ON sa_production_entries FOR INSERT
  WITH CHECK (
    sa_get_my_role() IN ('syringe_operator','admin','manager')
    AND operator_id = auth.uid()
  );
CREATE POLICY sa_pe_update ON sa_production_entries FOR UPDATE
  USING (sa_get_my_role() IN ('admin','manager'));

-- sa_defect_entries
CREATE POLICY sa_de_read ON sa_defect_entries FOR SELECT
  USING (
    sa_get_my_role() IN ('admin','manager','specialist','executive','viewer')
    OR EXISTS (
      SELECT 1 FROM sa_production_entries pe
      WHERE pe.id = entry_id AND pe.operator_id = auth.uid()
    )
  );
CREATE POLICY sa_de_insert ON sa_defect_entries FOR INSERT
  WITH CHECK (sa_get_my_role() IN ('syringe_operator','admin','manager'));

-- sa_downtime_events
CREATE POLICY sa_dt_read ON sa_downtime_events FOR SELECT
  USING (
    sa_get_my_role() IN ('admin','manager','specialist','executive','viewer')
    OR operator_id = auth.uid()
  );
CREATE POLICY sa_dt_insert ON sa_downtime_events FOR INSERT
  WITH CHECK (
    sa_get_my_role() IN ('syringe_operator','admin','manager')
    AND operator_id = auth.uid()
  );
CREATE POLICY sa_dt_update ON sa_downtime_events FOR UPDATE
  USING (
    sa_get_my_role() IN ('admin','manager')
    OR operator_id = auth.uid()
  );

-- sa_failure_reports
CREATE POLICY sa_fr_read ON sa_failure_reports FOR SELECT
  USING (
    sa_get_my_role() IN ('admin','manager','specialist','executive')
    OR reporter_id = auth.uid()
    OR assigned_to = auth.uid()
  );
CREATE POLICY sa_fr_insert ON sa_failure_reports FOR INSERT
  WITH CHECK (
    sa_get_my_role() IN ('syringe_operator','admin','manager','specialist')
    AND reporter_id = auth.uid()
  );
CREATE POLICY sa_fr_update ON sa_failure_reports FOR UPDATE
  USING (
    sa_get_my_role() IN ('admin','manager','specialist')
    OR reporter_id = auth.uid()
  );

-- sa_quality_issues
CREATE POLICY sa_qi_read ON sa_quality_issues FOR SELECT
  USING (
    sa_get_my_role() IN ('admin','manager','specialist','executive')
    OR reporter_id = auth.uid()
  );
CREATE POLICY sa_qi_insert ON sa_quality_issues FOR INSERT
  WITH CHECK (
    sa_get_my_role() IN ('syringe_operator','admin','manager')
    AND reporter_id = auth.uid()
  );
CREATE POLICY sa_qi_update ON sa_quality_issues FOR UPDATE
  USING (sa_get_my_role() IN ('admin','manager','specialist'));

-- sa_component_usages
CREATE POLICY sa_cu_read ON sa_component_usages FOR SELECT
  USING (
    sa_get_my_role() IN ('admin','manager','specialist','executive')
    OR operator_id = auth.uid()
  );
CREATE POLICY sa_cu_insert ON sa_component_usages FOR INSERT
  WITH CHECK (
    sa_get_my_role() IN ('syringe_operator','admin','manager')
    AND operator_id = auth.uid()
  );
CREATE POLICY sa_cu_update ON sa_component_usages FOR UPDATE
  USING (
    sa_get_my_role() IN ('admin','manager')
    OR operator_id = auth.uid()
  );

-- sa_changeovers
CREATE POLICY sa_ch_read ON sa_changeovers FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sa_ch_insert ON sa_changeovers FOR INSERT
  WITH CHECK (
    sa_get_my_role() IN ('syringe_operator','admin','manager')
    AND operator_id = auth.uid()
  );
CREATE POLICY sa_ch_update ON sa_changeovers FOR UPDATE
  USING (
    sa_get_my_role() IN ('admin','manager')
    OR operator_id = auth.uid()
  );

-- sa_checklist_items
CREATE POLICY sa_ci_read   ON sa_checklist_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sa_ci_manage ON sa_checklist_items FOR ALL
  USING (sa_get_my_role() IN ('admin','manager'))
  WITH CHECK (sa_get_my_role() IN ('admin','manager'));

-- sa_checklist_completions
CREATE POLICY sa_cc_read ON sa_checklist_completions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sa_cc_insert ON sa_checklist_completions FOR INSERT
  WITH CHECK (sa_get_my_role() IN ('syringe_operator','admin','manager'));
CREATE POLICY sa_cc_update ON sa_checklist_completions FOR UPDATE
  USING (
    sa_get_my_role() IN ('admin','manager')
    OR completed_by = auth.uid()
  );

-- sa_handovers
CREATE POLICY sa_ho_read ON sa_handovers FOR SELECT
  USING (
    sa_get_my_role() IN ('admin','manager','specialist','executive')
    OR from_operator_id = auth.uid()
    OR to_operator_id = auth.uid()
  );
CREATE POLICY sa_ho_insert ON sa_handovers FOR INSERT
  WITH CHECK (
    sa_get_my_role() IN ('syringe_operator','admin','manager')
    AND from_operator_id = auth.uid()
  );
CREATE POLICY sa_ho_update ON sa_handovers FOR UPDATE
  USING (
    sa_get_my_role() IN ('admin','manager')
    OR to_operator_id = auth.uid()
  );

-- sa_audit_log: wszyscy mogą wstawiać, tylko admin czyta
CREATE POLICY sa_al_insert ON sa_audit_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());
CREATE POLICY sa_al_read ON sa_audit_log FOR SELECT
  USING (sa_get_my_role() IN ('admin','manager'));

-- ────────────────────────────────────────────────────────────
-- 19. DANE STARTOWE — asortymenty
-- ────────────────────────────────────────────────────────────
INSERT INTO sa_assortments (name, code, volume_ml, nominal_per_hour, sort_order) VALUES
  ('Strzykawka 2 ml',     'SYR_2ML',    2,   2400, 1),
  ('Strzykawka 5 ml',     'SYR_5ML',    5,   2000, 2),
  ('Strzykawka 10 ml',    'SYR_10ML',  10,   1600, 3),
  ('Strzykawka 20 ml',    'SYR_20ML',  20,   1200, 4),
  ('Strzykawka 50/60 ml', 'SYR_50ML',  60,    800, 5)
ON CONFLICT (code) DO NOTHING;

-- dane startowe — kategorie braków
INSERT INTO sa_defect_categories (name, code, defect_type, requires_comment, sort_order) VALUES
  ('Nieprawidłowy nadruk',             'PRINT_BAD',        'quality', false, 1),
  ('Brak nadruku',                     'PRINT_MISSING',    'quality', false, 2),
  ('Rozmazany nadruk',                 'PRINT_SMEARED',    'quality', false, 3),
  ('Nieprawidłowy montaż tłoczyska',   'PISTON_BAD_MOUNT', 'quality', false, 4),
  ('Brak tłoczyska',                   'PISTON_MISSING',   'quality', false, 5),
  ('Uszkodzony korpus',                'BODY_DAMAGED',     'quality', false, 6),
  ('Uszkodzony kołnierz',              'FLANGE_DAMAGED',   'quality', false, 7),
  ('Nieszczelność',                    'LEAK',             'quality', false, 8),
  ('Deformacja elementu',              'DEFORMATION',      'quality', false, 9),
  ('Zabrudzenie',                      'CONTAMINATION',    'quality', false, 10),
  ('Problem z podawaniem komponentu',  'FEED_ISSUE',       'tech',    false, 11),
  ('Odrzut automatyczny',              'AUTO_REJECT',      'tech',    false, 12),
  ('Brak technologiczny (uruchomienie)','TECH_STARTUP',    'tech',    false, 13),
  ('Brak podczas regulacji',           'TECH_ADJUSTMENT',  'tech',    false, 14),
  ('Inny',                             'OTHER',            'other',   true,  99)
ON CONFLICT (code) DO NOTHING;

-- dane startowe — kategorie przestojów
INSERT INTO sa_downtime_categories (name, code, category_type, sort_order) VALUES
  ('Awaria mechaniczna',           'MECH_FAILURE',    'unplanned', 1),
  ('Awaria elektryczna',           'ELEC_FAILURE',    'unplanned', 2),
  ('Problem z automatyką',         'AUTO_ISSUE',      'unplanned', 3),
  ('Problem z nadrukiem',          'PRINT_ISSUE',     'unplanned', 4),
  ('Brak korpusów',                'NO_BODIES',       'logistics', 5),
  ('Brak tłoczysk',               'NO_PISTONS',      'logistics', 6),
  ('Brak opakowań',               'NO_PACKAGING',    'logistics', 7),
  ('Niezgodność komponentów',     'COMP_MISMATCH',   'quality',   8),
  ('Przezbrojenie',               'CHANGEOVER',      'planned',   9),
  ('Regulacja',                   'ADJUSTMENT',      'planned',   10),
  ('Czyszczenie',                 'CLEANING',        'planned',   11),
  ('Kontrola jakości',            'QUALITY_CTRL',    'quality',   12),
  ('Oczekiwanie na UR',           'WAIT_MAINT',      'unplanned', 13),
  ('Oczekiwanie na materiał',     'WAIT_MATERIAL',   'logistics', 14),
  ('Oczekiwanie na decyzję',      'WAIT_DECISION',   'unplanned', 15),
  ('Planowany postój',            'PLANNED_STOP',    'planned',   16),
  ('Inna przyczyna',              'OTHER',           'unplanned', 99)
ON CONFLICT (code) DO NOTHING;

-- dane startowe — pozycje checklisty przezbrojenia
INSERT INTO sa_checklist_items (name, is_required, sort_order) VALUES
  ('Usunięto poprzednie komponenty',         true,  1),
  ('Przygotowano właściwe komponenty',       true,  2),
  ('Potwierdzono zgodność korpusu',          true,  3),
  ('Potwierdzono zgodność tłoczyska',        true,  4),
  ('Ustawiono odpowiedni nadruk',            true,  5),
  ('Sprawdzono pierwsze sztuki',             true,  6),
  ('Zaakceptowano wyrób po przezbrojeniu',   true,  7),
  ('Uprzątnięto stanowisko',                true,  8)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 20. REALTIME — włącz dla kluczowych tabel
-- ────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE sa_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE sa_production_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE sa_downtime_events;
ALTER PUBLICATION supabase_realtime ADD TABLE sa_failure_reports;
ALTER PUBLICATION supabase_realtime ADD TABLE sa_quality_issues;
