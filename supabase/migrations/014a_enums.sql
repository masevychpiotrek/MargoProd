-- Specialist/failure module enum extensions.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'specialist';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'failure_report';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'failure_report_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'failure_report_update';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'failure_severity') THEN
    CREATE TYPE failure_severity AS ENUM ('low', 'medium', 'high', 'critical');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'failure_status') THEN
    CREATE TYPE failure_status AS ENUM ('new', 'acknowledged', 'in_progress', 'resolved');
  END IF;
END $$;
