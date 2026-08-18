-- Modul "Transparentnosc Zmian i Problemow" - rejestr zmian (parametr/czesc/
-- oprogramowanie/procedura) i rejestr problemow, niezalezny od istniejacych
-- failure_reports/hourly_reports (patrz plan: swirling-dreaming-avalanche).
--
-- Role: 'mistrz' NIE istnieje jako osobna rola - uzytkownik potwierdzil, ze
-- "Mistrz" = rola 'manager' (razem z 'admin' dostaja pelny zapis + prawo
-- zatwierdzania - wersja "Mistrza" z pierwotnej specyfikacji wygrala nad
-- wersja "Kierownika", ktora mowila tylko-odczyt).

-- ============================================================
-- ENUMY
-- ============================================================
CREATE TYPE change_log_type AS ENUM ('parameter', 'part', 'software', 'procedure');
CREATE TYPE issue_log_status AS ENUM ('new', 'in_progress', 'waiting_part', 'closed');
CREATE TYPE issue_log_priority AS ENUM ('low', 'medium', 'critical');

-- ============================================================
-- CHANGE_LOG (Rejestr Zmian)
-- ============================================================
CREATE TABLE change_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  machine_id      UUID NOT NULL REFERENCES machines(id),
  station         TEXT,
  user_id         UUID NOT NULL REFERENCES profiles(id),
  change_type     change_log_type NOT NULL,
  value_before    TEXT,
  value_after     TEXT,
  reason          TEXT NOT NULL,
  approved_by     UUID REFERENCES profiles(id),
  attachment_url  TEXT
);

CREATE INDEX idx_change_log_machine_created ON change_log(machine_id, created_at DESC);

-- ============================================================
-- ISSUE_LOG (Rejestr Problemow)
-- ============================================================
CREATE TABLE issue_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  machine_id      UUID NOT NULL REFERENCES machines(id),
  station         TEXT,
  reported_by     UUID NOT NULL REFERENCES profiles(id),
  description     TEXT NOT NULL,
  status          issue_log_status NOT NULL DEFAULT 'new',
  priority        issue_log_priority NOT NULL DEFAULT 'medium',
  assigned_to     UUID REFERENCES profiles(id),
  closed_at       TIMESTAMPTZ,
  resolution      TEXT
);

CREATE INDEX idx_issue_log_machine_created ON issue_log(machine_id, created_at DESC);
CREATE INDEX idx_issue_log_status ON issue_log(status);

-- ============================================================
-- TRIGGER: approved_by (change_log) wolno ustawic/zmienic wylacznie
-- manager/admin - "Mistrz"/"Kierownik" to ta sama rola po decyzji
-- uzytkownika. Reuzywa current_user_role() z 033_fix_profile_role_rls.sql
-- (SECURITY DEFINER, unika rekurencyjnych polityk RLS na profiles).
-- ============================================================
CREATE OR REPLACE FUNCTION public.change_log_guard_approved_by()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
     AND public.current_user_role() NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'Tylko kierownik/mistrz moze zatwierdzic zmiane (approved_by).';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_change_log_guard_approved_by ON change_log;
CREATE TRIGGER trg_change_log_guard_approved_by
  BEFORE UPDATE ON change_log
  FOR EACH ROW EXECUTE FUNCTION public.change_log_guard_approved_by();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_log ENABLE ROW LEVEL SECURITY;

-- change_log: operator widzi wpisy wlasnego autorstwa lub maszyn ze swoich
-- zmian (operator_1_id/operator_2_id na shifts); specialist/manager/admin
-- widza wszystko. Operator NIE ma INSERT/UPDATE na change_log (tylko
-- issue_log) - zgodnie ze specyfikacja.
CREATE POLICY "change_log_read" ON change_log
  FOR SELECT USING (
    public.current_user_role() IN ('specialist', 'manager', 'admin')
    OR (
      public.current_user_role() = 'operator'
      AND (
        auth.uid() = user_id
        OR machine_id IN (
          SELECT machine_id FROM shifts
          WHERE operator_1_id = auth.uid() OR operator_2_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "change_log_insert" ON change_log
  FOR INSERT WITH CHECK (
    public.current_user_role() IN ('specialist', 'manager', 'admin')
    AND auth.uid() = user_id
  );

CREATE POLICY "change_log_update" ON change_log
  FOR UPDATE USING (
    public.current_user_role() IN ('specialist', 'manager', 'admin')
  ) WITH CHECK (
    public.current_user_role() IN ('specialist', 'manager', 'admin')
  );

-- issue_log: operator widzi/zaklada wlasne zgloszenia (lub maszyn ze swoich
-- zmian dla odczytu); specialist/manager/admin widza i edytuja wszystko.
CREATE POLICY "issue_log_read" ON issue_log
  FOR SELECT USING (
    public.current_user_role() IN ('specialist', 'manager', 'admin')
    OR (
      public.current_user_role() = 'operator'
      AND (
        auth.uid() = reported_by
        OR machine_id IN (
          SELECT machine_id FROM shifts
          WHERE operator_1_id = auth.uid() OR operator_2_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "issue_log_insert" ON issue_log
  FOR INSERT WITH CHECK (
    auth.uid() = reported_by
    AND public.current_user_role() IN ('operator', 'specialist', 'manager', 'admin')
  );

CREATE POLICY "issue_log_update" ON issue_log
  FOR UPDATE USING (
    public.current_user_role() IN ('specialist', 'manager', 'admin')
  ) WITH CHECK (
    public.current_user_role() IN ('specialist', 'manager', 'admin')
  );

NOTIFY pgrst, 'reload schema';
