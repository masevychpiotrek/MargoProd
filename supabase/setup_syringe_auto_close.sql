-- Run once if pg_cron was not installed when migration 075 was applied.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('syringe-auto-close', '* * * * *', 'SELECT public.sa_expire_sessions();');
-- Also release existing expired sessions immediately.
SELECT public.sa_expire_sessions();
