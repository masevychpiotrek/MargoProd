-- Keep admin-created accounts immediately usable, but force a password change
-- on the first login.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.profiles
  ALTER COLUMN must_change_password SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.create_user_with_profile(
  p_email    TEXT,
  p_password TEXT,
  p_name     TEXT,
  p_role     TEXT DEFAULT 'operator'
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT;
BEGIN
  v_email := lower(trim(p_email));

  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Nieprawidlowy adres e-mail: %', p_email;
  END IF;

  IF trim(p_password) = '' THEN
    RAISE EXCEPTION 'Haslo nie moze byc puste';
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      uuid_generate_v4(),
      'authenticated', 'authenticated',
      v_email,
      crypt(p_password, gen_salt('bf')),
      NOW(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', trim(p_name), 'name', trim(p_name), 'role', p_role),
      NOW(), NOW()
    )
    RETURNING id INTO v_user_id;
  ELSE
    UPDATE auth.users
    SET
      email = v_email,
      aud = COALESCE(NULLIF(aud, ''), 'authenticated'),
      role = COALESCE(NULLIF(role, ''), 'authenticated'),
      email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
      raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('full_name', trim(p_name), 'name', trim(p_name), 'role', p_role),
      updated_at = NOW()
    WHERE id = v_user_id;
  END IF;

  PERFORM public.ensure_email_identity(v_user_id, v_email);

  INSERT INTO public.profiles (id, full_name, role, is_active, must_change_password)
  VALUES (v_user_id, trim(p_name), p_role::user_role, true, true)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    is_active = true,
    must_change_password = true,
    deleted_at = NULL,
    updated_at = NOW();

  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.create_user_with_profile(TEXT, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
