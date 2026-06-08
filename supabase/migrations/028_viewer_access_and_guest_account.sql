-- Viewer can inspect the infrastructure, production and failures, but cannot write.

DROP POLICY IF EXISTS "profiles_manager" ON public.profiles;
CREATE POLICY "profiles_manager" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'admin', 'viewer')
    )
  );

DROP POLICY IF EXISTS "failure_reports_read" ON public.failure_reports;
CREATE POLICY "failure_reports_read" ON public.failure_reports
  FOR SELECT USING (
    auth.uid() = reporter_id OR
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('specialist', 'manager', 'admin', 'viewer')
    )
  );

SELECT public.create_user_with_profile(
  'gosc@margomed.com',
  'Margomed123',
  'Konto Gościa',
  'viewer'
);

NOTIFY pgrst, 'reload schema';
