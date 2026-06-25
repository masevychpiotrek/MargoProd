-- Ensure the syringe automation module is reachable through Supabase API.
-- RLS policies decide row-level access; these grants allow authenticated clients
-- to call the tables/functions in the first place.

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.sa_assortments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_machines TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_defect_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_downtime_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_production_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_defect_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_downtime_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_failure_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_quality_issues TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_component_usages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_changeovers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_checklist_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_checklist_completions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sa_handovers TO authenticated;
GRANT SELECT, INSERT ON public.sa_audit_log TO authenticated;

GRANT EXECUTE ON FUNCTION public.sa_get_my_role() TO authenticated;
