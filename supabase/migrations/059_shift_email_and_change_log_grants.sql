-- Brakujace GRANTy odkryte przy testowaniu webhooka maili zmianowych: bez
-- jawnego GRANT ... TO authenticated/service_role, PostgreSQL odrzuca dostep
-- ("permission denied for table ...") ZANIM w ogole dojdzie do sprawdzenia
-- polityk RLS - RLS nie wystarcza samo w sobie. Ten sam brak dotyczyl juz
-- wdrozonej migracji 056_change_issue_log.sql (change_log/issue_log byly
-- calkowicie niedostepne dla zwyklych uzytkownikow od czasu wdrozenia -
-- naprawiane tu razem, przy okazji). Wzorzec zgodny z reszta repo, patrz np.
-- 054_monthly_production_targets.sql, 055_internal_complaints.sql.

-- Naprawa 056_change_issue_log.sql (brakowalo calkowicie)
GRANT SELECT, INSERT, UPDATE ON public.change_log TO authenticated;
GRANT ALL ON public.change_log TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.issue_log TO authenticated;
GRANT ALL ON public.issue_log TO service_role;

-- 057_shift_email_system.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_notification_recipients TO authenticated;
GRANT ALL ON public.shift_notification_recipients TO service_role;
GRANT SELECT ON public.shift_email_threads TO authenticated;
GRANT ALL ON public.shift_email_threads TO service_role;
GRANT SELECT ON public.technician_shift_reports TO authenticated;
GRANT ALL ON public.technician_shift_reports TO service_role;
GRANT SELECT, UPDATE ON public.technician_action_items TO authenticated;
GRANT ALL ON public.technician_action_items TO service_role;

NOTIFY pgrst, 'reload schema';
