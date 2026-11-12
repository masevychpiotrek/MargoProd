-- Manager corrections are atomic and retain the original job and component history.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'production_job_correction';
