-- Reklamacje wewnetrzne wad jakosciowych polfabrykatow. Operator wykrywa wade
-- (np. wyplywka na elemencie), zapisuje numer serii, date produkcji, typ
-- polfabrykatu, typ niezgodnosci i zdjecie wady. Kierownik zarzadza statusem.
CREATE TABLE internal_complaints (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id      UUID NOT NULL REFERENCES profiles(id),
  shift_id         UUID REFERENCES shifts(id),
  machine_id       UUID REFERENCES machines(id),
  batch_number     TEXT NOT NULL,        -- numer serii / partii
  production_date  DATE,                 -- data produkcji polfabrykatu
  semi_product     TEXT NOT NULL,        -- typ polfabrykatu (wariant IS PRO)
  defect_type      TEXT NOT NULL,        -- typ niezgodnosci
  description      TEXT,                 -- opcjonalny opis
  photo_url        TEXT,                 -- zdjecie wady (bucket failure-photos)
  status           TEXT NOT NULL DEFAULT 'new',  -- new | in_review | resolved | rejected
  resolution_note  TEXT,                 -- notatka kierownika przy zmianie statusu
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_complaints_status  ON internal_complaints(status);
CREATE INDEX idx_complaints_created ON internal_complaints(created_at);
CREATE INDEX idx_complaints_batch   ON internal_complaints(batch_number);

ALTER TABLE internal_complaints ENABLE ROW LEVEL SECURITY;

-- Odczyt dla wszystkich zalogowanych (operator widzi swoje na liscie, kierownik wszystkie).
CREATE POLICY "internal_complaints_read" ON internal_complaints FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Zgloszenie: operator/manager/admin (aktywny).
CREATE POLICY "internal_complaints_insert" ON internal_complaints FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('operator', 'syringe_operator', 'manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );

-- Aktualizacja (zmiana statusu, notatka): manager/admin, lub wlasciciel zgloszenia.
CREATE POLICY "internal_complaints_update" ON internal_complaints FOR UPDATE
  USING (
    reporter_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.internal_complaints TO authenticated;
GRANT ALL ON public.internal_complaints TO service_role;
