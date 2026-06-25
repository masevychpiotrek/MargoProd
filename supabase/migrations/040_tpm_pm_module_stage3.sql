-- ============================================================
-- Margoline MES — Moduł TPM/PM — IS PRO — Etap 3
-- Ustawienia, rejestr A1TEC, wykrywanie powtarzalności
-- Migration 040
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. USTAWIENIA MODUŁU (konfigurowalne progi)
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tpm_settings (key, value) VALUES
  ('recurrence_threshold', '3'),
  ('recurrence_window_days', '30')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. REJESTR KONTAKTÓW Z A1TEC
-- ────────────────────────────────────────────────────────────
CREATE TABLE tpm_a1tec_contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id        UUID REFERENCES tpm_issues(id) ON DELETE SET NULL,
  internal_number TEXT,
  a1tec_number    TEXT,
  sent_date       DATE,
  sender_id       UUID REFERENCES profiles(id),
  recipient       TEXT,
  problem_desc    TEXT,
  attachments     TEXT[] NOT NULL DEFAULT '{}',
  requirements    TEXT[] NOT NULL DEFAULT '{}',
  requirement_other TEXT,
  response_date   DATE,
  response_text   TEXT,
  a1tec_person    TEXT,
  planned_action  TEXT,
  planned_date    DATE,
  status          TEXT NOT NULL DEFAULT 'preparation'
                  CHECK (status IN ('preparation','sent','awaiting_response',
                                    'response_received','awaiting_action','remote_support',
                                    'visit_planned','resolved','closed')),
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tpm_a1tec_issue  ON tpm_a1tec_contacts(issue_id);
CREATE INDEX idx_tpm_a1tec_status ON tpm_a1tec_contacts(status);

-- ────────────────────────────────────────────────────────────
-- 3. RPC — wykrywanie problemów powtarzalnych
--    Stacja generująca >= próg zgłoszeń w oknie → oznacz otwarte jako powtarzalne
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tpm_mark_recurring(p_threshold INT DEFAULT NULL, p_window_days INT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_threshold INT;
  v_window    INT;
  v_marked    INT := 0;
BEGIN
  v_threshold := COALESCE(p_threshold, (SELECT value::int FROM tpm_settings WHERE key = 'recurrence_threshold'), 3);
  v_window    := COALESCE(p_window_days, (SELECT value::int FROM tpm_settings WHERE key = 'recurrence_window_days'), 30);

  WITH busy AS (
    SELECT station_id
    FROM tpm_issues
    WHERE report_time >= NOW() - (v_window || ' days')::interval
    GROUP BY station_id
    HAVING COUNT(*) >= v_threshold
  ),
  upd AS (
    UPDATE tpm_issues i
    SET is_recurring = true, updated_at = NOW()
    FROM busy
    WHERE i.station_id = busy.station_id
      AND i.status NOT IN ('closed')
      AND i.is_recurring = false
    RETURNING i.id
  )
  SELECT COUNT(*) INTO v_marked FROM upd;

  RETURN v_marked;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE tpm_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpm_a1tec_contacts  ENABLE ROW LEVEL SECURITY;

CREATE POLICY tpm_settings_read   ON tpm_settings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY tpm_settings_manage ON tpm_settings FOR ALL
  USING (tpm_role() IN ('manager','admin')) WITH CHECK (tpm_role() IN ('manager','admin'));

CREATE POLICY tpm_a1tec_read ON tpm_a1tec_contacts FOR SELECT
  USING (tpm_role() IN ('specialist','manager','executive','admin'));
CREATE POLICY tpm_a1tec_insert ON tpm_a1tec_contacts FOR INSERT
  WITH CHECK (tpm_role() IN ('manager','admin'));
CREATE POLICY tpm_a1tec_update ON tpm_a1tec_contacts FOR UPDATE
  USING (tpm_role() IN ('manager','admin'));

-- ────────────────────────────────────────────────────────────
-- 5. GRANTY
-- ────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.tpm_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_a1tec_contacts TO authenticated;
GRANT EXECUTE ON FUNCTION public.tpm_mark_recurring(INT, INT) TO authenticated;

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE tpm_a1tec_contacts;
