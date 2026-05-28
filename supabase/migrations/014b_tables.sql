-- Failure reports table, realtime indexes, policies and photo bucket.

CREATE TABLE IF NOT EXISTS failure_reports (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id       UUID NOT NULL REFERENCES machines(id),
  shift_id         UUID REFERENCES shifts(id) ON DELETE SET NULL,
  reporter_id      UUID NOT NULL REFERENCES profiles(id),
  category         downtime_category NOT NULL DEFAULT 'mechanical_failure',
  severity         failure_severity NOT NULL DEFAULT 'medium',
  status           failure_status NOT NULL DEFAULT 'new',
  station          TEXT,
  description      TEXT NOT NULL,
  photo_urls       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  resolution_notes TEXT,
  assigned_to      UUID REFERENCES profiles(id),
  acknowledged_at  TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_failure_reports_status
  ON failure_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_failure_reports_machine
  ON failure_reports(machine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_failure_reports_reporter
  ON failure_reports(reporter_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_failure_reports_updated ON failure_reports;
CREATE TRIGGER trg_failure_reports_updated
  BEFORE UPDATE ON failure_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE failure_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "failure_reports_read" ON failure_reports;
CREATE POLICY "failure_reports_read" ON failure_reports
  FOR SELECT USING (
    auth.uid() = reporter_id OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('specialist', 'manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "failure_reports_insert" ON failure_reports;
CREATE POLICY "failure_reports_insert" ON failure_reports
  FOR INSERT WITH CHECK (
    auth.uid() = reporter_id
  );

DROP POLICY IF EXISTS "failure_reports_update_specialist" ON failure_reports;
CREATE POLICY "failure_reports_update_specialist" ON failure_reports
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('specialist', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('specialist', 'manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "notif_insert_authenticated" ON notifications;
CREATE POLICY "notif_insert_authenticated" ON notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

INSERT INTO storage.buckets (id, name, public)
VALUES ('failure-photos', 'failure-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "failure_photos_read" ON storage.objects;
CREATE POLICY "failure_photos_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'failure-photos');

DROP POLICY IF EXISTS "failure_photos_insert" ON storage.objects;
CREATE POLICY "failure_photos_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'failure-photos'
    AND auth.uid() IS NOT NULL
  );
