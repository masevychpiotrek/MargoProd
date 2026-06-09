-- Let admins remove users from the application without breaking historical data.
-- The auth account stays in Supabase, while the profile is deactivated and hidden.

CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_admin_id UUID;
  v_user_name TEXT;
BEGIN
  v_admin_id := auth.uid();

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Brak aktywnej sesji admina';
  END IF;

  IF p_user_id = v_admin_id THEN
    RAISE EXCEPTION 'Nie mozesz usunac wlasnego konta';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_admin_id
      AND role = 'admin'
      AND is_active = true
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Tylko aktywny administrator moze usuwac konta';
  END IF;

  SELECT full_name INTO v_user_name
  FROM public.profiles
  WHERE id = p_user_id
    AND deleted_at IS NULL;

  IF v_user_name IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono aktywnego uzytkownika do usuniecia';
  END IF;

  UPDATE public.profiles
  SET
    is_active = false,
    rfid_uid = NULL,
    deleted_at = NOW(),
    updated_at = NOW()
  WHERE id = p_user_id
    AND deleted_at IS NULL;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    v_admin_id,
    'user_delete',
    'profiles',
    p_user_id,
    jsonb_build_object('full_name', v_user_name),
    jsonb_build_object('deleted_at', NOW(), 'is_active', false)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.admin_soft_delete_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
