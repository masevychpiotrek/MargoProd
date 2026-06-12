-- Executive read-only profile for board-level dashboards.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'executive';

DROP POLICY IF EXISTS "profiles_manager" ON public.profiles;
CREATE POLICY "profiles_manager" ON public.profiles
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role::text IN ('manager', 'admin', 'viewer', 'executive')
      AND is_active = true
      AND deleted_at IS NULL
  )
);

DROP POLICY IF EXISTS "failure_reports_staff_read" ON public.failure_reports;
CREATE POLICY "failure_reports_staff_read" ON public.failure_reports
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role::text IN ('specialist', 'manager', 'admin', 'viewer', 'executive')
      AND is_active = true
      AND deleted_at IS NULL
  )
);

NOTIFY pgrst, 'reload schema';
