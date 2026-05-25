-- Admin-only reset for test data.
-- Runs with definer privileges so RLS does not block cleanup from the app.

CREATE OR REPLACE FUNCTION public.admin_reset_test_data(p_scope TEXT)
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
    RAISE EXCEPTION 'Only active admin can reset test data';
  END IF;

  IF p_scope NOT IN ('reports', 'shifts', 'orders', 'plans', 'audit', 'all') THEN
    RAISE EXCEPTION 'Unknown reset scope: %', p_scope;
  END IF;

  IF p_scope IN ('reports', 'all') THEN
    SELECT COUNT(*) INTO v_count FROM public.downtime_events;
    EXECUTE 'TRUNCATE TABLE public.downtime_events CASCADE';
    v_deleted := v_deleted || jsonb_build_object('downtime_events', v_count);

    SELECT COUNT(*) INTO v_count FROM public.hourly_reports;
    EXECUTE 'TRUNCATE TABLE public.hourly_reports CASCADE';
    v_deleted := v_deleted || jsonb_build_object('hourly_reports', v_count);
  END IF;

  IF p_scope IN ('shifts', 'all') THEN
    SELECT COUNT(*) INTO v_count FROM public.shifts;
    EXECUTE 'TRUNCATE TABLE public.shifts CASCADE';
    v_deleted := v_deleted || jsonb_build_object('shifts', v_count);
  END IF;

  IF p_scope IN ('orders', 'all') THEN
    UPDATE public.hourly_reports SET order_id = NULL WHERE order_id IS NOT NULL;

    SELECT COUNT(*) INTO v_count FROM public.production_orders;
    DELETE FROM public.production_orders WHERE id IS NOT NULL;
    v_deleted := v_deleted || jsonb_build_object('production_orders', v_count);
  END IF;

  IF p_scope IN ('plans', 'all') AND to_regclass('public.monthly_plans') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*) FROM public.monthly_plans' INTO v_count;
    EXECUTE 'TRUNCATE TABLE public.monthly_plans CASCADE';
    v_deleted := v_deleted || jsonb_build_object('monthly_plans', v_count);
  END IF;

  IF p_scope IN ('audit', 'all') THEN
    SELECT COUNT(*) INTO v_count FROM public.audit_logs;
    EXECUTE 'TRUNCATE TABLE public.audit_logs CASCADE';
    v_deleted := v_deleted || jsonb_build_object('audit_logs', v_count);
  END IF;

  INSERT INTO public.audit_logs (user_id, action, table_name, new_values)
  VALUES (auth.uid(), 'config_change', 'reset', jsonb_build_object('scope', p_scope, 'deleted', v_deleted));

  RETURN jsonb_build_object('ok', true, 'scope', p_scope, 'deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_test_data(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_test_data(TEXT) TO authenticated;

-- Refresh PostgREST/Supabase schema cache so the app can call the RPC immediately.
NOTIFY pgrst, 'reload schema';
