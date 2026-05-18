-- ============================================================
-- MargoProd MES — Schema v1
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUM types
-- ============================================================
CREATE TYPE user_role AS ENUM ('operator', 'manager', 'admin');
CREATE TYPE shift_type AS ENUM ('I', 'II', 'III');
CREATE TYPE report_status AS ENUM ('pending', 'submitted', 'approved', 'rejected');
CREATE TYPE downtime_category AS ENUM (
  'mechanical_failure',
  'electrical_failure',
  'material_shortage',
  'quality_control',
  'changeover',
  'no_operator',
  'cleaning',
  'process_issue',
  'logistics_issue',
  'other'
);
CREATE TYPE notification_type AS ENUM ('report_due', 'alarm', 'system', 'info');
CREATE TYPE audit_action AS ENUM (
  'login', 'logout', 'report_create', 'report_update', 'report_delete',
  'user_create', 'user_update', 'user_delete', 'password_change',
  'shift_start', 'shift_end', 'config_change'
);

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  role            user_role NOT NULL DEFAULT 'operator',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  avatar_url      TEXT,
  phone           TEXT,
  department      TEXT DEFAULT 'Montaż Automatyczny',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- ============================================================
-- MACHINES
-- ============================================================
CREATE TABLE machines (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL UNIQUE,
  code            TEXT NOT NULL UNIQUE,
  department      TEXT NOT NULL DEFAULT 'Montaż Automatyczny',
  target_per_hour INT NOT NULL DEFAULT 2100,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- ============================================================
-- PRODUCTION TARGETS (overrides per date range)
-- ============================================================
CREATE TABLE production_targets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id      UUID NOT NULL REFERENCES machines(id),
  target_per_hour INT NOT NULL DEFAULT 2100,
  valid_from      DATE NOT NULL,
  valid_to        DATE,
  note            TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SCHEDULES (godziny pracy, dni wolne)
-- ============================================================
CREATE TABLE schedules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  work_start      TIME NOT NULL DEFAULT '06:00',
  work_end        TIME NOT NULL DEFAULT '22:00',
  active_shifts   shift_type[] NOT NULL DEFAULT ARRAY['I','II','III']::shift_type[],
  off_weekdays    INT[] DEFAULT ARRAY[]::INT[],  -- 0=Sun, 6=Sat
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE schedule_exceptions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id     UUID REFERENCES schedules(id),
  exception_date  DATE NOT NULL,
  is_working_day  BOOLEAN NOT NULL DEFAULT false,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SHIFTS
-- ============================================================
CREATE TABLE shifts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id      UUID NOT NULL REFERENCES machines(id),
  operator_1_id   UUID NOT NULL REFERENCES profiles(id),
  operator_2_id   UUID REFERENCES profiles(id),
  shift_type      shift_type NOT NULL,
  shift_date      DATE NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(machine_id, shift_date, shift_type)
);

-- ============================================================
-- HOURLY REPORTS
-- ============================================================
CREATE TABLE hourly_reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shift_id        UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  machine_id      UUID NOT NULL REFERENCES machines(id),
  operator_id     UUID NOT NULL REFERENCES profiles(id),
  hour_block      TEXT NOT NULL,      -- "08:00–09:00"
  report_date     DATE NOT NULL,
  hour_start      INT NOT NULL,       -- 8 (godzina 8:00)
  status          report_status NOT NULL DEFAULT 'submitted',

  -- Produkcja
  good_count      INT NOT NULL DEFAULT 0,   -- przyrost dobrych
  reject_count    INT NOT NULL DEFAULT 0,   -- przyrost złych
  total_count     INT,                       -- licznik łączny (opcjonalnie)
  target          INT NOT NULL DEFAULT 2100,
  efficiency_pct  NUMERIC GENERATED ALWAYS AS (
    CASE WHEN target > 0
    THEN ROUND(good_count::NUMERIC / target * 100, 1)
    ELSE 0 END
  ) STORED,

  -- Czasy (MUSZĄ sumować się do 60)
  runtime_min         INT NOT NULL DEFAULT 0,
  downtime_min        INT NOT NULL DEFAULT 0,
  micro_stoppage_min  INT NOT NULL DEFAULT 0,
  changeover_min      INT NOT NULL DEFAULT 0,
  failure_min         INT NOT NULL DEFAULT 0,

  -- Wymagane jeśli good_count < target
  downtime_reason TEXT,
  notes           TEXT,

  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  -- Jeden raport na godzinę na zmianę na maszynę
  UNIQUE(shift_id, hour_start),

  -- Suma czasów = 60 min
  CONSTRAINT times_sum_60 CHECK (
    runtime_min + downtime_min + micro_stoppage_min + changeover_min + failure_min = 60
  ),

  -- Jeśli poniżej targetu — wymagany powód
  CONSTRAINT reason_required CHECK (
    good_count >= target OR (downtime_reason IS NOT NULL AND downtime_reason != '')
  )
);

-- ============================================================
-- DOWNTIME EVENTS (wiele na jeden raport)
-- ============================================================
CREATE TABLE downtime_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id       UUID NOT NULL REFERENCES hourly_reports(id) ON DELETE CASCADE,
  shift_id        UUID NOT NULL REFERENCES shifts(id),
  machine_id      UUID NOT NULL REFERENCES machines(id),
  category        downtime_category NOT NULL,
  duration_min    INT NOT NULL CHECK (duration_min > 0),
  started_at      TIMESTAMPTZ,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type            notification_type NOT NULL DEFAULT 'info',
  title           TEXT NOT NULL,
  body            TEXT,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  report_id       UUID REFERENCES hourly_reports(id),
  machine_id      UUID REFERENCES machines(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at         TIMESTAMPTZ
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES profiles(id),
  action          audit_action NOT NULL,
  table_name      TEXT,
  record_id       UUID,
  old_values      JSONB,
  new_values      JSONB,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_hourly_reports_shift     ON hourly_reports(shift_id);
CREATE INDEX idx_hourly_reports_date      ON hourly_reports(report_date);
CREATE INDEX idx_hourly_reports_machine   ON hourly_reports(machine_id);
CREATE INDEX idx_hourly_reports_operator  ON hourly_reports(operator_id);
CREATE INDEX idx_downtime_report          ON downtime_events(report_id);
CREATE INDEX idx_downtime_machine         ON downtime_events(machine_id);
CREATE INDEX idx_shifts_date              ON shifts(shift_date);
CREATE INDEX idx_shifts_machine           ON shifts(machine_id, shift_date);
CREATE INDEX idx_notifications_user       ON notifications(user_id, is_read);
CREATE INDEX idx_audit_logs_user          ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created       ON audit_logs(created_at DESC);
CREATE INDEX idx_profiles_role            ON profiles(role);

-- ============================================================
-- UPDATED_AT trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated       BEFORE UPDATE ON profiles           FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_machines_updated       BEFORE UPDATE ON machines           FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_shifts_updated         BEFORE UPDATE ON shifts             FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_reports_updated        BEFORE UPDATE ON hourly_reports     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_schedules_updated      BEFORE UPDATE ON schedules          FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE on auth.users insert
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'operator')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self"    ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_admin"   ON profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "profiles_manager" ON profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);

-- machines
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "machines_read_all"  ON machines FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "machines_write_adm" ON machines FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- shifts
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shifts_read"  ON shifts FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "shifts_write" ON shifts FOR INSERT WITH CHECK (
  auth.uid() = operator_1_id OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);

-- hourly_reports
ALTER TABLE hourly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_read"    ON hourly_reports FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "reports_insert"  ON hourly_reports FOR INSERT WITH CHECK (auth.uid() = operator_id);
CREATE POLICY "reports_update"  ON hourly_reports FOR UPDATE USING (
  auth.uid() = operator_id OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);

-- downtime_events
ALTER TABLE downtime_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "downtime_read"  ON downtime_events FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "downtime_write" ON downtime_events FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_own" ON notifications FOR ALL USING (auth.uid() = user_id);

-- audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_admin" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);
CREATE POLICY "audit_insert" ON audit_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- production_targets
ALTER TABLE production_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "targets_read"  ON production_targets FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "targets_write" ON production_targets FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- schedules
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "schedules_read"  ON schedules FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "schedules_write" ON schedules FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
