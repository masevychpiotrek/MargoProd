-- Migracja 045 utworzyla tabele + RLS, ale pominela GRANT dla roli authenticated -
-- RLS nigdy nie jest osiagane bez podstawowego uprawnienia na poziomie tabeli,
-- stad "permission denied for table production_jobs" mimo poprawnych polityk RLS.
-- Ten sam wzorzec co supabase/migrations/037_syringe_module_api_grants.sql.

GRANT SELECT, INSERT, UPDATE ON public.production_jobs TO authenticated;
GRANT SELECT, UPDATE ON public.production_job_components TO authenticated;
GRANT SELECT, INSERT ON public.production_job_component_history TO authenticated;
