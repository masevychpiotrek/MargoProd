-- Read-only guest role.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'viewer';
