-- ============================================================
-- Margoline MES — Reset danych operatorskich modułu strzykawkowego
-- Migration 043
-- Admin-only, uruchamiane z uprawnieniami definiującej funkcji,
-- żeby RLS nie blokowało czyszczenia z aplikacji.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sa_admin_reset_data(p_scope TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_deleted JSONB := '{}'::JSONB;
  v_count INT;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
      AND deleted_at IS NULL
  )
  INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only active admin can reset syringe operator data';
  END IF;

  IF p_scope NOT IN ('sessions', 'audit', 'all') THEN
    RAISE EXCEPTION 'Unknown reset scope: %', p_scope;
  END IF;

  -- 'sessions' obejmuje WSZYSTKO co operator wprowadza w trakcie zmiany:
  -- sesje, wpisy produkcyjne, braki, przestoje, awarie, problemy jakościowe,
  -- zużycie komponentów, przezbrojenia (+checklisty) i przekazania zmian —
  -- wszystkie te tabele mają FK do sa_sessions, więc TRUNCATE ... CASCADE
  -- czyści je automatycznie razem z sesją.
  IF p_scope IN ('sessions', 'all') THEN
    SELECT COUNT(*) INTO v_count FROM public.sa_sessions;
    EXECUTE 'TRUNCATE TABLE public.sa_sessions CASCADE';
    v_deleted := v_deleted || jsonb_build_object('sa_sessions', v_count);
  END IF;

  IF p_scope IN ('audit', 'all') THEN
    SELECT COUNT(*) INTO v_count FROM public.sa_audit_log;
    EXECUTE 'TRUNCATE TABLE public.sa_audit_log CASCADE';
    v_deleted := v_deleted || jsonb_build_object('sa_audit_log', v_count);
  END IF;

  INSERT INTO public.audit_logs (user_id, action, table_name, new_values)
  VALUES (auth.uid(), 'config_change', 'sa_reset', jsonb_build_object('scope', p_scope, 'deleted', v_deleted));

  RETURN jsonb_build_object('ok', true, 'scope', p_scope, 'deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.sa_admin_reset_data(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sa_admin_reset_data(TEXT) TO authenticated;

-- Refresh PostgREST/Supabase schema cache so the app can call the RPC immediately.
NOTIFY pgrst, 'reload schema';
