-- Emergency hardening for profile RLS.
-- Avoid recursive policies on public.profiles by checking current user role
-- through a SECURITY DEFINER helper.

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT AS $$
  SELECT role::text
  FROM public.profiles
  WHERE id = auth.uid()
    AND is_active = true
    AND deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

DROP POLICY IF EXISTS "profiles_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_manager" ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_password_update" ON public.profiles;

CREATE POLICY "profiles_self"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "profiles_role_read"
ON public.profiles
FOR SELECT
USING (
  public.current_user_role() IN ('manager', 'admin', 'viewer', 'executive')
);

CREATE POLICY "profiles_admin_write"
ON public.profiles
FOR ALL
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "profiles_self_password_update"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "failure_reports_staff_read" ON public.failure_reports;
CREATE POLICY "failure_reports_staff_read"
ON public.failure_reports
FOR SELECT
USING (
  public.current_user_role() IN ('specialist', 'manager', 'admin', 'viewer', 'executive')
);

NOTIFY pgrst, 'reload schema';
