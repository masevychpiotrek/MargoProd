-- Harden SQL-created Auth users.
-- Supabase Auth expects email provider metadata in auth.users and auth.identities.

ALTER TABLE public.profiles
  ALTER COLUMN must_change_password SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.ensure_email_identity(
  p_user_id UUID,
  p_email TEXT
)
RETURNS VOID AS $$
DECLARE
  v_email TEXT;
  v_has_provider_id BOOLEAN;
  v_identity_id_type TEXT;
  v_identity_id_sql TEXT;
BEGIN
  v_email := lower(trim(p_email));

  IF p_user_id IS NULL OR v_email = '' THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'identities'
      AND column_name = 'provider_id'
  ) INTO v_has_provider_id;

  UPDATE auth.users
  SET
    aud = COALESCE(NULLIF(aud, ''), 'authenticated'),
    role = COALESCE(NULLIF(role, ''), 'authenticated'),
    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb),
    updated_at = NOW()
  WHERE id = p_user_id;

  IF EXISTS (
    SELECT 1
    FROM auth.identities
    WHERE user_id = p_user_id
      AND provider = 'email'
  ) THEN
    IF v_has_provider_id THEN
      UPDATE auth.identities
      SET
        provider_id = p_user_id::text,
        identity_data = COALESCE(identity_data, '{}'::jsonb)
          || jsonb_build_object(
            'sub', p_user_id::text,
            'email', v_email,
            'email_verified', true,
            'phone_verified', false
          ),
        updated_at = NOW()
      WHERE user_id = p_user_id
        AND provider = 'email';
    ELSE
      UPDATE auth.identities
      SET
        identity_data = COALESCE(identity_data, '{}'::jsonb)
          || jsonb_build_object(
            'sub', p_user_id::text,
            'email', v_email,
            'email_verified', true,
            'phone_verified', false
          ),
        updated_at = NOW()
      WHERE user_id = p_user_id
        AND provider = 'email';
    END IF;
    RETURN;
  END IF;

  SELECT udt_name INTO v_identity_id_type
  FROM information_schema.columns
  WHERE table_schema = 'auth'
    AND table_name = 'identities'
    AND column_name = 'id'
  LIMIT 1;

  v_identity_id_sql := CASE
    WHEN v_identity_id_type = 'uuid' THEN 'gen_random_uuid()'
    ELSE quote_literal(p_user_id::text)
  END;

  IF v_has_provider_id THEN
    EXECUTE format(
      'INSERT INTO auth.identities
        (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       VALUES
        (%s, $1, $2, jsonb_build_object(''sub'', $2, ''email'', $3, ''email_verified'', true, ''phone_verified'', false), ''email'', NOW(), NOW(), NOW())',
      v_identity_id_sql
    )
    USING p_user_id, p_user_id::text, v_email;
  ELSE
    EXECUTE format(
      'INSERT INTO auth.identities
        (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       VALUES
        (%s, $1, jsonb_build_object(''sub'', $2, ''email'', $3, ''email_verified'', true, ''phone_verified'', false), ''email'', NOW(), NOW(), NOW())',
      v_identity_id_sql
    )
    USING p_user_id, p_user_id::text, v_email;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
  VALUES (v_user_id, trim(p_name), p_role::user_role, true, false)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    is_active = true,
    must_change_password = false,
    deleted_at = NULL,
    updated_at = NOW();

  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT u.id, lower(u.email) AS email
    FROM auth.users u
    WHERE u.email IS NOT NULL
  LOOP
    PERFORM public.ensure_email_identity(r.id, r.email);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
