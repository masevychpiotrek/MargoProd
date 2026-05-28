-- Harden app-created auth users: validate email and create the Email identity/provider.

CREATE OR REPLACE FUNCTION create_user_with_profile(
  p_email    TEXT,
  p_password TEXT,
  p_name     TEXT,
  p_role     TEXT DEFAULT 'operator'
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT;
  v_has_provider_id BOOLEAN;
  v_identity_id_type TEXT;
  v_identity_id_sql TEXT;
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
      raw_user_meta_data, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      uuid_generate_v4(),
      'authenticated', 'authenticated',
      v_email,
      crypt(p_password, gen_salt('bf')),
      NOW(),
      jsonb_build_object('full_name', trim(p_name), 'role', p_role),
      NOW(), NOW()
    )
    RETURNING id INTO v_user_id;
  ELSE
    UPDATE auth.users
    SET
      email = v_email,
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('full_name', trim(p_name), 'role', p_role),
      updated_at = NOW()
    WHERE id = v_user_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'identities'
      AND column_name = 'provider_id'
  ) INTO v_has_provider_id;

  SELECT udt_name INTO v_identity_id_type
  FROM information_schema.columns
  WHERE table_schema = 'auth'
    AND table_name = 'identities'
    AND column_name = 'id'
  LIMIT 1;

  v_identity_id_sql := CASE
    WHEN v_identity_id_type = 'uuid' THEN 'gen_random_uuid()'
    ELSE quote_literal(v_user_id::text)
  END;

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE user_id = v_user_id AND provider = 'email'
  ) THEN
    IF v_has_provider_id THEN
      EXECUTE format(
        'INSERT INTO auth.identities
          (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         VALUES
          (%s, $1, $2, jsonb_build_object(''sub'', $2, ''email'', $3, ''email_verified'', true, ''phone_verified'', false), ''email'', NOW(), NOW(), NOW())',
        v_identity_id_sql
      )
      USING v_user_id, v_user_id::text, v_email;
    ELSE
      EXECUTE format(
        'INSERT INTO auth.identities
          (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         VALUES
          (%s, $1, jsonb_build_object(''sub'', $2, ''email'', $3, ''email_verified'', true, ''phone_verified'', false), ''email'', NOW(), NOW(), NOW())',
        v_identity_id_sql
      )
      USING v_user_id, v_user_id::text, v_email;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, full_name, role, is_active)
  VALUES (v_user_id, trim(p_name), p_role::user_role, true)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    is_active = true,
    deleted_at = NULL,
    updated_at = NOW();

  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
