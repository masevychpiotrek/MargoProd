-- Plan produkcyjny (cel miesieczny) przeniesiony z localStorage przegladarki
-- do bazy - zeby byl WSPOLNY dla wszystkich kierownikow, a nie osobny na kazdym
-- komputerze i znikajacy po wyczyszczeniu przegladarki.
-- machine_id NULL = plan zbiorczy dla calego zakladu na dany miesiac.
CREATE TABLE monthly_production_targets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year        INT NOT NULL,
  month       INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  machine_id  UUID REFERENCES machines(id),
  target_qty  NUMERIC NOT NULL DEFAULT 0,
  updated_by  UUID REFERENCES profiles(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Jeden plan na (rok, miesiac, maszyna). COALESCE, bo UNIQUE nie traktuje
-- dwoch NULL jako rownych - a plan zbiorczy (machine_id IS NULL) tez ma byc
-- pojedynczy w miesiacu.
CREATE UNIQUE INDEX uniq_production_plan_period
  ON monthly_production_targets (year, month, COALESCE(machine_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE monthly_production_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "monthly_production_targets_read" ON monthly_production_targets FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "monthly_production_targets_insert" ON monthly_production_targets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );

CREATE POLICY "monthly_production_targets_update" ON monthly_production_targets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.monthly_production_targets TO authenticated;
GRANT ALL ON public.monthly_production_targets TO service_role;
