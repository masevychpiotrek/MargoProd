-- role remains the active function, so existing RLS policies and RPCs continue
-- to enforce the chosen permissions. Only admins can grant the second function.
BEGIN;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS operator_manager_access boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_operator_manager_access_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_operator_manager_access_check
  CHECK (NOT operator_manager_access OR role::text IN ('operator', 'manager'));

CREATE OR REPLACE FUNCTION public.guard_profile_access_changes()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- The switch RPC runs as its trusted owner; direct authenticated profile
  -- updates must never grant roles via the self/password update policy.
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND coalesce(public.current_user_role(), '') <> 'admin'
     AND (NEW.role IS DISTINCT FROM OLD.role
       OR NEW.operator_manager_access IS DISTINCT FROM OLD.operator_manager_access
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'Tylko administrator może zmieniać uprawnienia konta.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_access_changes ON public.profiles;
CREATE TRIGGER profiles_guard_access_changes BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_access_changes();

CREATE OR REPLACE FUNCTION public.switch_operator_manager_role(p_role text)
RETURNS public.profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_profile public.profiles;
  v_old_role text;
BEGIN
  IF auth.uid() IS NULL OR p_role IS NULL OR p_role NOT IN ('operator', 'manager') THEN
    RAISE EXCEPTION 'Niedozwolona funkcja.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR NOT v_profile.is_active OR v_profile.deleted_at IS NOT NULL
     OR NOT v_profile.operator_manager_access OR v_profile.role::text NOT IN ('operator', 'manager') THEN
    RAISE EXCEPTION 'Nie masz przypisanych obu funkcji. Skontaktuj się z administratorem.' USING ERRCODE = '42501';
  END IF;
  v_old_role := v_profile.role::text;
  UPDATE public.profiles SET role = p_role::public.user_role, updated_at = now()
  WHERE id = auth.uid() RETURNING * INTO v_profile;
  IF v_old_role <> p_role THEN
    INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_values, new_values)
    VALUES(auth.uid(), 'user_update', 'profiles', auth.uid(),
      jsonb_build_object('role', v_old_role), jsonb_build_object('role', p_role, 'method', 'function_selection'));
  END IF;
  RETURN v_profile;
END;
$$;
REVOKE ALL ON FUNCTION public.switch_operator_manager_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_operator_manager_role(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
