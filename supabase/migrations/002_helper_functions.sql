-- ============================================================
-- Helper: create_user_with_profile
-- Uruchom TEN plik jako PIERWSZY, przed seed.sql
-- ============================================================
CREATE OR REPLACE FUNCTION create_user_with_profile(
  p_email    TEXT,
  p_password TEXT,
  p_name     TEXT,
  p_role     TEXT DEFAULT 'operator'
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Utwórz konto w auth.users
  v_user_id := (
    SELECT id FROM auth.users WHERE email = p_email
  );

  IF v_user_id IS NULL THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_user_meta_data, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      uuid_generate_v4(),
      'authenticated', 'authenticated',
      p_email,
      crypt(p_password, gen_salt('bf')),
      NOW(),
      jsonb_build_object('full_name', p_name, 'role', p_role),
      NOW(), NOW()
    )
    RETURNING id INTO v_user_id;
  END IF;

  -- Upsert profil
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (v_user_id, p_name, p_role::user_role)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role;

  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
