-- Fallback for admin-created accounts when the deployed Edge Function is stale.
-- Only an active admin can execute this RPC.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'syringe_operator';

CREATE OR REPLACE FUNCTION public.admin_create_user_with_profile(
  p_email text,
  p_password text,
  p_name text,
  p_role text DEFAULT 'operator'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_key text;
  v_user_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_uid
      AND role::text = 'admin'
      AND is_active = true
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Tylko administrator może tworzyć konta.';
  END IF;

  v_role := trim(COALESCE(p_role, 'operator'));
  v_key := lower(v_role);
  v_key := translate(v_key, 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzACELNOSZZ');
  v_key := regexp_replace(v_key, '[^a-z0-9]+', '_', 'g');
  v_key := regexp_replace(v_key, '^_+|_+$', '', 'g');

  v_role := CASE v_key
    WHEN 'op_strzykawek' THEN 'syringe_operator'
    WHEN 'op_automatow_strzykawkowych' THEN 'syringe_operator'
    WHEN 'operator_strzykawek' THEN 'syringe_operator'
    WHEN 'operator_linii_strzykawkowych' THEN 'syringe_operator'
    WHEN 'operator_automatow_strzykawkowych' THEN 'syringe_operator'
    WHEN 'automaty_strzykawkowe' THEN 'syringe_operator'
    WHEN 'linie_strzykawkowe' THEN 'syringe_operator'
    WHEN 'syringe' THEN 'syringe_operator'
    WHEN 'syringe_operator' THEN 'syringe_operator'
    WHEN 'sa_operator' THEN 'syringe_operator'
    ELSE v_role
  END;

  IF v_role NOT IN ('operator', 'syringe_operator', 'manager', 'specialist', 'viewer', 'executive', 'admin') THEN
    RAISE EXCEPTION 'Nieprawidłowa rola użytkownika.';
  END IF;

  v_user_id := public.create_user_with_profile(p_email, p_password, p_name, v_role);

  UPDATE public.profiles
  SET
    role = v_role::public.user_role,
    is_active = true,
    must_change_password = true,
    deleted_at = NULL,
    updated_at = now()
  WHERE id = v_user_id;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_user_with_profile(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user_with_profile(text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
