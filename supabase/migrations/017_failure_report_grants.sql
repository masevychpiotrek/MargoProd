-- Supabase API roles need table grants in addition to RLS policies.
GRANT SELECT, INSERT, UPDATE ON public.failure_reports TO authenticated;
GRANT SELECT ON public.failure_reports TO anon;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
