-- ============================================================
-- Margoline MES — Moduł TPM/PM — IS PRO
-- Migration 036 — Etap 1
-- Role: Operator(operator), Specialist(specialist), Kierownik(manager), Zarząd(executive)
-- Nie tworzymy nowych ról — używamy istniejących.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Helper: rola bieżącego użytkownika
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tpm_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role::text FROM profiles WHERE id = auth.uid() AND is_active = true AND deleted_at IS NULL;
$$;

-- ────────────────────────────────────────────────────────────
-- 1. AUTOMATY (IS-3, IS-4)
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_machines (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 2. STACJE
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_stations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id        UUID NOT NULL REFERENCES tpm_machines(id) ON DELETE CASCADE,
  station_number    TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  function_desc     TEXT,
  base_photo_url    TEXT,
  standard_settings TEXT,
  standard_params   TEXT,
  param_ranges      TEXT,
  control_instruction TEXT,
  tech_instruction  TEXT,
  is_critical       BOOLEAN NOT NULL DEFAULT true,
  pm_frequency_days INT NOT NULL DEFAULT 7,
  risk_level        TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(machine_id, station_number)
);
CREATE INDEX idx_tpm_stations_machine ON tpm_stations(machine_id);

-- ────────────────────────────────────────────────────────────
-- 3. PUNKTY KONTROLNE AM (edytowalne)
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_checkpoints (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id  UUID NOT NULL REFERENCES tpm_stations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_checkpoints_station ON tpm_checkpoints(station_id);

-- ────────────────────────────────────────────────────────────
-- 4. CHECKLISTY AM (instancja na zmianę/automat)
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_am_checklists (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id    UUID NOT NULL REFERENCES tpm_machines(id),
  operator_id   UUID NOT NULL REFERENCES profiles(id),
  shift_type    TEXT NOT NULL CHECK (shift_type IN ('I','II','III')),
  checklist_date DATE NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'in_progress'
                CHECK (status IN ('in_progress','completed','completed_late')),
  nok_count     INT NOT NULL DEFAULT 0,
  na_count      INT NOT NULL DEFAULT 0,
  ok_count      INT NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_amc_machine ON tpm_am_checklists(machine_id, checklist_date);
CREATE INDEX idx_tpm_amc_operator ON tpm_am_checklists(operator_id);

-- ────────────────────────────────────────────────────────────
-- 5. WYNIKI CHECKLISTY (per punkt)
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_am_results (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id  UUID NOT NULL REFERENCES tpm_am_checklists(id) ON DELETE CASCADE,
  station_id    UUID NOT NULL REFERENCES tpm_stations(id),
  checkpoint_id UUID NOT NULL REFERENCES tpm_checkpoints(id),
  result        TEXT NOT NULL CHECK (result IN ('ok','nok','na')),
  comment       TEXT,
  photo_url     TEXT,
  issue_id      UUID,  -- powiązanie do zgłoszenia (FK dodany niżej)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_amr_checklist ON tpm_am_results(checklist_id);
CREATE INDEX idx_tpm_amr_station   ON tpm_am_results(station_id);

-- ────────────────────────────────────────────────────────────
-- 6. ZGŁOSZENIA / AWARIE / INTERWENCJE
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_issues (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_number       TEXT UNIQUE,
  machine_id         UUID NOT NULL REFERENCES tpm_machines(id),
  station_id         UUID NOT NULL REFERENCES tpm_stations(id),
  component          TEXT,
  reporter_id        UUID NOT NULL REFERENCES profiles(id),
  shift_type         TEXT CHECK (shift_type IN ('I','II','III')),
  category           TEXT NOT NULL DEFAULT 'unknown',
  category_other     TEXT,
  priority           TEXT NOT NULL DEFAULT 'normal'
                     CHECK (priority IN ('low','normal','high','critical')),
  status             TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN (
                       'new','awaiting_ack','accepted','diagnosing',
                       'immediate_done','repairing','awaiting_part',
                       'awaiting_manager','observation','testing',
                       'escalated_a1tec','resolved','awaiting_approval',
                       'closed','reopened'
                     )),
  symptom            TEXT NOT NULL,
  -- czasy
  problem_time       TIMESTAMPTZ,
  report_time        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stop_time          TIMESTAMPTZ,
  ack_time           TIMESTAMPTZ,
  intervention_start TIMESTAMPTZ,
  intervention_end   TIMESTAMPTZ,
  resume_time        TIMESTAMPTZ,
  -- flagi
  machine_stopped    BOOLEAN NOT NULL DEFAULT false,
  production_resumed BOOLEAN NOT NULL DEFAULT false,
  post_resume_check  BOOLEAN NOT NULL DEFAULT false,
  -- treść techniczna
  operator_action    TEXT,
  immediate_action   TEXT,
  diagnosis          TEXT,
  probable_cause     TEXT,
  confirmed_cause    TEXT,
  root_cause_action  TEXT,
  -- test po naprawie
  test_cycles        INT,
  test_ok            INT,
  test_nok           INT,
  test_result        TEXT,
  -- skutki
  downtime_min       INT,
  nok_count          INT,
  reject_pct         NUMERIC(6,2),
  production_impact  TEXT,
  -- przypisanie / nadzór
  assigned_to        UUID REFERENCES profiles(id),
  due_date           DATE,
  -- weryfikacja skuteczności
  verification_due   DATE,
  verification_done  TIMESTAMPTZ,
  verification_result TEXT CHECK (verification_result IN ('effective','ineffective') OR verification_result IS NULL),
  verification_notes TEXT,
  is_recurring       BOOLEAN NOT NULL DEFAULT false,
  -- A1TEC
  a1tec_escalated    BOOLEAN NOT NULL DEFAULT false,
  needs_part         BOOLEAN NOT NULL DEFAULT false,
  -- zamknięcie
  proposed_close     BOOLEAN NOT NULL DEFAULT false,
  proposed_close_by  UUID REFERENCES profiles(id),
  approved_by        UUID REFERENCES profiles(id),
  approved_at        TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_issues_machine ON tpm_issues(machine_id);
CREATE INDEX idx_tpm_issues_station ON tpm_issues(station_id);
CREATE INDEX idx_tpm_issues_status  ON tpm_issues(status);
CREATE INDEX idx_tpm_issues_priority ON tpm_issues(priority);
CREATE INDEX idx_tpm_issues_assigned ON tpm_issues(assigned_to);

-- FK z wyników AM do zgłoszeń
ALTER TABLE tpm_am_results
  ADD CONSTRAINT fk_amr_issue FOREIGN KEY (issue_id) REFERENCES tpm_issues(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────
-- 7. HISTORIA ZGŁOSZENIA (audyt — bez nadpisywania)
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_issue_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id    UUID NOT NULL REFERENCES tpm_issues(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES profiles(id),
  action      TEXT NOT NULL,
  old_status  TEXT,
  new_status  TEXT,
  old_value   TEXT,
  new_value   TEXT,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_ih_issue ON tpm_issue_history(issue_id, created_at);

-- ────────────────────────────────────────────────────────────
-- 8. MEDIA (zdjęcia / filmy) — metadane
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_media (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id   UUID REFERENCES tpm_machines(id),
  station_id   UUID REFERENCES tpm_stations(id),
  issue_id     UUID REFERENCES tpm_issues(id) ON DELETE CASCADE,
  checklist_id UUID REFERENCES tpm_am_checklists(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  media_type   TEXT NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo','video')),
  category     TEXT NOT NULL DEFAULT 'other'
               CHECK (category IN ('base_state','before','failure','during','after',
                                   'setting','param_screen','damaged_part','test','other')),
  description  TEXT,
  author_id    UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID REFERENCES profiles(id),
  deleted_reason TEXT
);
CREATE INDEX idx_tpm_media_issue   ON tpm_media(issue_id);
CREATE INDEX idx_tpm_media_station ON tpm_media(station_id);

-- ────────────────────────────────────────────────────────────
-- 9. TRIGGER — automatyczny numer zgłoszenia
--    Format: IS3-ST24-2026-0001
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tpm_generate_issue_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_mcode TEXT;
  v_snum  TEXT;
  v_year  TEXT;
  v_seq   INT;
BEGIN
  IF NEW.issue_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT regexp_replace(code, '[^A-Za-z0-9]', '', 'g') INTO v_mcode FROM tpm_machines WHERE id = NEW.machine_id;
  SELECT regexp_replace(station_number, '[^A-Za-z0-9]', '', 'g') INTO v_snum FROM tpm_stations WHERE id = NEW.station_id;
  v_year := to_char(COALESCE(NEW.report_time, NOW()), 'YYYY');

  SELECT COUNT(*) + 1 INTO v_seq
  FROM tpm_issues
  WHERE machine_id = NEW.machine_id
    AND station_id = NEW.station_id
    AND to_char(report_time, 'YYYY') = v_year;

  NEW.issue_number := v_mcode || '-' || v_snum || '-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tpm_issue_number
  BEFORE INSERT ON tpm_issues
  FOR EACH ROW EXECUTE FUNCTION tpm_generate_issue_number();

-- ────────────────────────────────────────────────────────────
-- 10. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE tpm_machines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_stations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_checkpoints   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_am_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_am_results    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_issues        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_issue_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_media         ENABLE ROW LEVEL SECURITY;

-- Słowniki: czytają wszyscy zalogowani; zarządza Kierownik/Admin
CREATE POLICY tpm_machines_read   ON tpm_machines    FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tpm_machines_manage ON tpm_machines    FOR ALL
  USING (tpm_role() IN ('manager','admin')) WITH CHECK (tpm_role() IN ('manager','admin'));
CREATE POLICY tpm_stations_read   ON tpm_stations    FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tpm_stations_manage ON tpm_stations    FOR ALL
  USING (tpm_role() IN ('manager','admin')) WITH CHECK (tpm_role() IN ('manager','admin'));
CREATE POLICY tpm_checkpoints_read   ON tpm_checkpoints FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tpm_checkpoints_manage ON tpm_checkpoints FOR ALL
  USING (tpm_role() IN ('manager','admin','specialist')) WITH CHECK (tpm_role() IN ('manager','admin','specialist'));

-- Checklisty AM
CREATE POLICY tpm_amc_read ON tpm_am_checklists FOR SELECT
  USING (tpm_role() IN ('specialist','manager','executive','admin') OR operator_id = auth.uid());
CREATE POLICY tpm_amc_insert ON tpm_am_checklists FOR INSERT
  WITH CHECK (operator_id = auth.uid() AND tpm_role() IN ('operator','specialist','manager','admin'));
CREATE POLICY tpm_amc_update ON tpm_am_checklists FOR UPDATE
  USING (tpm_role() IN ('manager','admin') OR (operator_id = auth.uid() AND status = 'in_progress'));

CREATE POLICY tpm_amr_read ON tpm_am_results FOR SELECT
  USING (tpm_role() IN ('specialist','manager','executive','admin')
         OR EXISTS (SELECT 1 FROM tpm_am_checklists c WHERE c.id = checklist_id AND c.operator_id = auth.uid()));
CREATE POLICY tpm_amr_insert ON tpm_am_results FOR INSERT
  WITH CHECK (tpm_role() IN ('operator','specialist','manager','admin'));

-- Zgłoszenia
CREATE POLICY tpm_issues_read ON tpm_issues FOR SELECT
  USING (tpm_role() IN ('specialist','manager','executive','admin')
         OR reporter_id = auth.uid() OR assigned_to = auth.uid());
CREATE POLICY tpm_issues_insert ON tpm_issues FOR INSERT
  WITH CHECK (reporter_id = auth.uid() AND tpm_role() IN ('operator','specialist','manager','admin'));
CREATE POLICY tpm_issues_update ON tpm_issues FOR UPDATE
  USING (tpm_role() IN ('specialist','manager','admin'));

-- Historia: wszyscy zalogowani wstawiają swoje; czyta technik+
CREATE POLICY tpm_ih_insert ON tpm_issue_history FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY tpm_ih_read ON tpm_issue_history FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Media
CREATE POLICY tpm_media_read ON tpm_media FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tpm_media_insert ON tpm_media FOR INSERT
  WITH CHECK (author_id = auth.uid());
CREATE POLICY tpm_media_update ON tpm_media FOR UPDATE
  USING (tpm_role() IN ('specialist','manager','admin') OR author_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 11. REALTIME
-- ────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE tpm_issues;
ALTER PUBLICATION supabase_realtime ADD TABLE tpm_am_checklists;

-- ────────────────────────────────────────────────────────────
-- 12. DANE STARTOWE
-- ────────────────────────────────────────────────────────────
INSERT INTO tpm_machines (code, name, sort_order) VALUES
  ('IS-3', 'Automat IS PRO 3', 1),
  ('IS-4', 'Automat IS PRO 4', 2)
ON CONFLICT (code) DO NOTHING;

-- Stacje krytyczne dla obu automatów
INSERT INTO tpm_stations (machine_id, station_number, name, is_critical, sort_order)
SELECT m.id, s.num, s.nm, true, s.ord
FROM tpm_machines m
CROSS JOIN (VALUES
  ('ST24','Stacja ST24 — komora',1),
  ('ST17','Stacja ST17',2),
  ('ST18','Stacja ST18',3),
  ('ST19','Stacja ST19',4),
  ('ST7', 'Stacja ST7',5),
  ('ST48','Stacja ST48',6),
  ('ST30','Stacja ST30',7),
  ('ST21','Stacja ST21',8),
  ('ST77','Stacja ST77 — pas transportowy',9)
) AS s(num, nm, ord)
WHERE m.code IN ('IS-3','IS-4')
ON CONFLICT (machine_id, station_number) DO NOTHING;

-- Punkty kontrolne dla ST24 (pełna lista)
INSERT INTO tpm_checkpoints (station_id, name, sort_order)
SELECT st.id, cp.nm, cp.ord
FROM tpm_stations st
CROSS JOIN (VALUES
  ('Prawidłowe podanie komory',1),
  ('Prawidłowy obrót komory',2),
  ('Prawidłowe położenie komory',3),
  ('Stan chwytaków',4),
  ('Stan gniazd',5),
  ('Stan czujników',6),
  ('Stan siłowników',7),
  ('Stan przewodów pneumatycznych',8),
  ('Czystość stacji',9),
  ('Brak widocznych uszkodzeń',10),
  ('Brak luźnych elementów',11),
  ('Brak nieprawidłowych dźwięków',12),
  ('Stabilność pracy po uruchomieniu',13),
  ('Zgodność ze zdjęciem stanu bazowego',14)
) AS cp(nm, ord)
WHERE st.station_number = 'ST24';

-- Domyślny zestaw punktów dla pozostałych stacji (edytowalny później)
INSERT INTO tpm_checkpoints (station_id, name, sort_order)
SELECT st.id, cp.nm, cp.ord
FROM tpm_stations st
CROSS JOIN (VALUES
  ('Czystość stacji',1),
  ('Brak widocznych uszkodzeń',2),
  ('Stan czujników',3),
  ('Stan siłowników',4),
  ('Stan elementów mechanicznych',5),
  ('Stabilność pracy po uruchomieniu',6),
  ('Zgodność ze zdjęciem stanu bazowego',7)
) AS cp(nm, ord)
WHERE st.station_number <> 'ST24';
