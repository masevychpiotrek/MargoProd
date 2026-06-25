-- ============================================================
-- Manual repair: TPM/PM stage 2 + API grants
-- Use in Supabase SQL Editor only when 039 grants fail because
-- tpm_pm_templates / PM tables do not exist on the target database.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.tpm_stations') IS NULL OR to_regclass('public.tpm_machines') IS NULL THEN
    RAISE EXCEPTION 'TPM stage 1 tables are missing. Apply migration 036_tpm_pm_module_stage1.sql first.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tpm_pm_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id  UUID NOT NULL REFERENCES public.tpm_stations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tpm_pmt_station ON public.tpm_pm_templates(station_id);

CREATE TABLE IF NOT EXISTS public.tpm_pm_cards (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_number   TEXT UNIQUE,
  machine_id    UUID NOT NULL REFERENCES public.tpm_machines(id),
  station_id    UUID NOT NULL REFERENCES public.tpm_stations(id),
  planned_date  DATE NOT NULL,
  actual_date   DATE,
  performer_id  UUID REFERENCES public.profiles(id),
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
  approved_by   UUID REFERENCES public.profiles(id),
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tpm_pm_machine ON public.tpm_pm_cards(machine_id);
CREATE INDEX IF NOT EXISTS idx_tpm_pm_station ON public.tpm_pm_cards(station_id);
CREATE INDEX IF NOT EXISTS idx_tpm_pm_status  ON public.tpm_pm_cards(status);
CREATE INDEX IF NOT EXISTS idx_tpm_pm_planned ON public.tpm_pm_cards(planned_date);

CREATE TABLE IF NOT EXISTS public.tpm_pm_results (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id     UUID NOT NULL REFERENCES public.tpm_pm_cards(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.tpm_pm_templates(id),
  name        TEXT NOT NULL,
  result      TEXT NOT NULL DEFAULT 'ok' CHECK (result IN ('ok','nok','na')),
  measurement TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tpm_pmr_card ON public.tpm_pm_results(card_id);

CREATE OR REPLACE FUNCTION public.tpm_generate_pm_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_mcode TEXT; v_snum TEXT; v_year TEXT; v_seq INT;
BEGIN
  IF NEW.card_number IS NOT NULL THEN RETURN NEW; END IF;
  SELECT regexp_replace(code, '[^A-Za-z0-9]', '', 'g') INTO v_mcode FROM public.tpm_machines WHERE id = NEW.machine_id;
  SELECT regexp_replace(station_number, '[^A-Za-z0-9]', '', 'g') INTO v_snum FROM public.tpm_stations WHERE id = NEW.station_id;
  v_year := to_char(COALESCE(NEW.planned_date, CURRENT_DATE), 'YYYY');
  SELECT COUNT(*) + 1 INTO v_seq FROM public.tpm_pm_cards
    WHERE machine_id = NEW.machine_id AND station_id = NEW.station_id
      AND to_char(planned_date, 'YYYY') = v_year;
  NEW.card_number := 'PM-' || v_mcode || '-' || v_snum || '-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tpm_pm_number') THEN
    CREATE TRIGGER trg_tpm_pm_number BEFORE INSERT ON public.tpm_pm_cards
      FOR EACH ROW EXECUTE FUNCTION public.tpm_generate_pm_number();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tpm_parameters (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id      UUID NOT NULL REFERENCES public.tpm_machines(id),
  station_id      UUID NOT NULL REFERENCES public.tpm_stations(id),
  issue_id        UUID REFERENCES public.tpm_issues(id) ON DELETE SET NULL,
  user_id         UUID NOT NULL REFERENCES public.profiles(id),
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
  approved_by     UUID REFERENCES public.profiles(id),
  approved_at     TIMESTAMPTZ,
  is_last_good    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tpm_param_station ON public.tpm_parameters(station_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tpm_param_issue   ON public.tpm_parameters(issue_id);

CREATE TABLE IF NOT EXISTS public.tpm_parts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id    UUID REFERENCES public.tpm_machines(id),
  station_id    UUID REFERENCES public.tpm_stations(id),
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
CREATE INDEX IF NOT EXISTS idx_tpm_parts_station ON public.tpm_parts(station_id);
CREATE INDEX IF NOT EXISTS idx_tpm_parts_status  ON public.tpm_parts(status);

CREATE TABLE IF NOT EXISTS public.tpm_part_usages (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_id   UUID NOT NULL REFERENCES public.tpm_parts(id) ON DELETE CASCADE,
  issue_id  UUID REFERENCES public.tpm_issues(id) ON DELETE SET NULL,
  pm_card_id UUID REFERENCES public.tpm_pm_cards(id) ON DELETE SET NULL,
  user_id   UUID NOT NULL REFERENCES public.profiles(id),
  qty       NUMERIC(10,2) NOT NULL DEFAULT 1,
  used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tpm_pu_part  ON public.tpm_part_usages(part_id);
CREATE INDEX IF NOT EXISTS idx_tpm_pu_issue ON public.tpm_part_usages(issue_id);

ALTER TABLE public.tpm_pm_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tpm_pm_cards     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tpm_pm_results   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tpm_parameters   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tpm_parts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tpm_part_usages  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_pm_templates' AND policyname = 'tpm_pmt_read') THEN
    CREATE POLICY tpm_pmt_read ON public.tpm_pm_templates FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_pm_templates' AND policyname = 'tpm_pmt_manage') THEN
    CREATE POLICY tpm_pmt_manage ON public.tpm_pm_templates FOR ALL
      USING (public.tpm_role() IN ('specialist','manager','admin')) WITH CHECK (public.tpm_role() IN ('specialist','manager','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_pm_cards' AND policyname = 'tpm_pm_read') THEN
    CREATE POLICY tpm_pm_read ON public.tpm_pm_cards FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_pm_cards' AND policyname = 'tpm_pm_insert') THEN
    CREATE POLICY tpm_pm_insert ON public.tpm_pm_cards FOR INSERT
      WITH CHECK (public.tpm_role() IN ('specialist','manager','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_pm_cards' AND policyname = 'tpm_pm_update') THEN
    CREATE POLICY tpm_pm_update ON public.tpm_pm_cards FOR UPDATE
      USING (public.tpm_role() IN ('specialist','manager','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_pm_results' AND policyname = 'tpm_pmr_read') THEN
    CREATE POLICY tpm_pmr_read ON public.tpm_pm_results FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_pm_results' AND policyname = 'tpm_pmr_write') THEN
    CREATE POLICY tpm_pmr_write ON public.tpm_pm_results FOR ALL
      USING (public.tpm_role() IN ('specialist','manager','admin')) WITH CHECK (public.tpm_role() IN ('specialist','manager','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_parameters' AND policyname = 'tpm_param_read') THEN
    CREATE POLICY tpm_param_read ON public.tpm_parameters FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_parameters' AND policyname = 'tpm_param_insert') THEN
    CREATE POLICY tpm_param_insert ON public.tpm_parameters FOR INSERT
      WITH CHECK (user_id = auth.uid() AND public.tpm_role() IN ('specialist','manager','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_parameters' AND policyname = 'tpm_param_update') THEN
    CREATE POLICY tpm_param_update ON public.tpm_parameters FOR UPDATE
      USING (public.tpm_role() IN ('manager','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_parts' AND policyname = 'tpm_parts_read') THEN
    CREATE POLICY tpm_parts_read ON public.tpm_parts FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_parts' AND policyname = 'tpm_parts_manage') THEN
    CREATE POLICY tpm_parts_manage ON public.tpm_parts FOR ALL
      USING (public.tpm_role() IN ('specialist','manager','admin')) WITH CHECK (public.tpm_role() IN ('specialist','manager','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_part_usages' AND policyname = 'tpm_pu_read') THEN
    CREATE POLICY tpm_pu_read ON public.tpm_part_usages FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tpm_part_usages' AND policyname = 'tpm_pu_insert') THEN
    CREATE POLICY tpm_pu_insert ON public.tpm_part_usages FOR INSERT
      WITH CHECK (user_id = auth.uid() AND public.tpm_role() IN ('specialist','manager','admin'));
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tpm_pm_cards;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tpm_parts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

INSERT INTO public.tpm_pm_templates (station_id, name, sort_order)
SELECT st.id, t.nm, t.ord
FROM public.tpm_stations st
CROSS JOIN (VALUES
  ('Kontrola i czyszczenie stacji', 1),
  ('Sprawdzenie i regulacja czujnikow', 2),
  ('Sprawdzenie stanu chwytakow', 3),
  ('Sprawdzenie stanu gniazd', 4),
  ('Sprawdzenie silownikow i pneumatyki', 5),
  ('Pomiar parametrow pracy', 6),
  ('Kontrola luzow i mocowan', 7),
  ('Test pracy po przegladzie', 8)
) AS t(nm, ord)
WHERE st.station_number = 'ST24'
  AND NOT EXISTS (
    SELECT 1 FROM public.tpm_pm_templates x WHERE x.station_id = st.id AND x.name = t.nm
  );

INSERT INTO public.tpm_pm_templates (station_id, name, sort_order)
SELECT st.id, t.nm, t.ord
FROM public.tpm_stations st
CROSS JOIN (VALUES
  ('Kontrola i czyszczenie stacji', 1),
  ('Sprawdzenie i regulacja czujnikow', 2),
  ('Sprawdzenie elementow mechanicznych', 3),
  ('Sprawdzenie silownikow i pneumatyki', 4),
  ('Pomiar parametrow pracy', 5),
  ('Test pracy po przegladzie', 6)
) AS t(nm, ord)
WHERE st.station_number <> 'ST24'
  AND NOT EXISTS (
    SELECT 1 FROM public.tpm_pm_templates x WHERE x.station_id = st.id AND x.name = t.nm
  );

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.tpm_machines TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_stations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_checkpoints TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_am_checklists TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_am_results TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_issues TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_issue_history TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_media TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_pm_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_pm_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tpm_pm_results TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_parameters TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_parts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_part_usages TO authenticated;
GRANT EXECUTE ON FUNCTION public.tpm_role() TO authenticated;
