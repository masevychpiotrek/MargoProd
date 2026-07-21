-- Zdjecia statystyk zmianowych automatu (ekran PLC "Shift Statistics") + odczyt AI.
-- Bucket PRYWATNY (nie jak failure-photos) - dane z hali produkcyjnej sa bardziej
-- wrazliwe, dostep tylko przez podpisane URL-e generowane dla zalogowanych uzytkownikow.
INSERT INTO storage.buckets (id, name, public)
VALUES ('shift-stats-photos', 'shift-stats-photos', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

CREATE POLICY "shift_stats_photos_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'shift-stats-photos'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('operator', 'syringe_operator', 'manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );

CREATE POLICY "shift_stats_photos_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'shift-stats-photos'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('operator', 'syringe_operator', 'manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );

CREATE TABLE shift_stat_photos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shift_id      UUID REFERENCES shifts(id),
  machine_id    UUID NOT NULL REFERENCES machines(id),
  operator_id   UUID NOT NULL REFERENCES profiles(id),
  shift_type    TEXT,
  shift_date    TEXT,
  photo_path    TEXT NOT NULL,   -- sciezka w Storage (bucket prywatny - nie publiczny URL)
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ocr_status    TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'done' | 'failed'
  ocr_error     TEXT,
  ocr_attempts  INT NOT NULL DEFAULT 0,
  raw_response  TEXT,            -- surowa odpowiedz AI, do debugowania czesciowych bledow OCR
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ssp_machine ON shift_stat_photos(machine_id);
CREATE INDEX idx_ssp_shift   ON shift_stat_photos(shift_id);
CREATE INDEX idx_ssp_date    ON shift_stat_photos(shift_date);

CREATE TABLE shift_stat_readings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  photo_id         UUID NOT NULL REFERENCES shift_stat_photos(id) ON DELETE CASCADE,
  metric_label     TEXT NOT NULL,   -- np. "ST 15 DRIP CHAMBER RIGHT", "GOOD", "TIME IN RUN"
  metric_value     TEXT NOT NULL,   -- surowa wartosc odczytana przez AI
  numeric_value    NUMERIC,         -- wypelniane tylko gdy metric_value to czysta liczba
  station_key      TEXT,            -- nullable - kanoniczny klucz stacji do przyszlego trendowania (mapowanie recznie/pozniej)
  confirmed        BOOLEAN NOT NULL DEFAULT false,
  corrected_value  TEXT,
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ssr_photo ON shift_stat_readings(photo_id);
CREATE INDEX idx_ssr_label ON shift_stat_readings(metric_label);

-- RLS
ALTER TABLE shift_stat_photos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_stat_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_stat_photos_read" ON shift_stat_photos FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "shift_stat_photos_insert" ON shift_stat_photos FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('operator', 'syringe_operator', 'manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );
-- Brak polityki UPDATE dla klienta - ocr_status/ocr_attempts/raw_response
-- aktualizuje wylacznie edge function przez service role (omija RLS).

-- Brak polityki INSERT dla shift_stat_readings - wiersze wstawia wylacznie
-- edge function (service role), zeby operator nie mogl sfabrykowac "potwierdzonego"
-- odczytu bezposrednio przez klienta.
CREATE POLICY "shift_stat_readings_read" ON shift_stat_readings FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "shift_stat_readings_update" ON shift_stat_readings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('operator', 'syringe_operator', 'manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );

GRANT SELECT, INSERT ON public.shift_stat_photos TO authenticated;
GRANT SELECT, UPDATE ON public.shift_stat_readings TO authenticated;
