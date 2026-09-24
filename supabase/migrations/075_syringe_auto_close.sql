-- One hour to settle a shift: I 15:00, II 23:00, III 07:00 Warsaw time.
BEGIN;
ALTER TABLE public.sa_sessions ADD COLUMN IF NOT EXISTS auto_closed_at timestamptz;
ALTER TABLE public.sa_changeovers ADD COLUMN IF NOT EXISTS auto_interrupted boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.sa_shift_auto_close_at(p_date date, p_shift text)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT (CASE p_shift WHEN 'I' THEN p_date::timestamp + interval '15 hours'
    WHEN 'II' THEN p_date::timestamp + interval '23 hours'
    WHEN 'III' THEN p_date::timestamp + interval '1 day 7 hours' END) AT TIME ZONE 'Europe/Warsaw';
$$;

-- An interrupted changeover is not a completed switch to another assortment.
DROP TRIGGER IF EXISTS sa_compat_changeover ON public.sa_changeovers;
CREATE TRIGGER sa_compat_changeover BEFORE INSERT OR UPDATE OF to_assortment_id, ended_at
  ON public.sa_changeovers FOR EACH ROW WHEN (NEW.auto_interrupted IS NOT TRUE)
  EXECUTE FUNCTION public.sa_guard_compatibility();
CREATE OR REPLACE VIEW public.sa_production_segments WITH (security_invoker = true) AS
SELECT s.id session_id, s.machine_id, b.assortment_id, b.started_at,
  LEAST(s.ended_at, (SELECT min(c.started_at) FROM public.sa_changeovers c
    WHERE c.session_id = s.id AND c.started_at >= b.started_at)) ended_at
FROM public.sa_sessions s CROSS JOIN LATERAL (
 SELECT s.started_at, COALESCE((SELECT c.from_assortment_id FROM public.sa_changeovers c
   WHERE c.session_id = s.id ORDER BY c.started_at LIMIT 1), s.assortment_id) assortment_id
 UNION ALL
 SELECT c.ended_at, c.to_assortment_id FROM public.sa_changeovers c
   WHERE c.session_id = s.id AND c.ended_at IS NOT NULL AND NOT c.auto_interrupted
) b;

CREATE FUNCTION public.sa_expire_sessions(p_operator uuid DEFAULT NULL, p_machine uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.sa_sessions%ROWTYPE; v_end timestamptz; v_count integer := 0;
  v_reason text := 'Automatyczne zamknięcie: minęła godzina od planowego końca zmiany. Brak ręcznego przekazania — do sprawdzenia przez kierownika.';
BEGIN
  FOR s IN SELECT * FROM public.sa_sessions
    WHERE ended_at IS NULL AND public.sa_shift_auto_close_at(session_date, shift_type) <= clock_timestamp()
      AND ((p_operator IS NULL AND p_machine IS NULL) OR operator_id = p_operator OR machine_id = p_machine)
    ORDER BY id FOR UPDATE SKIP LOCKED
  LOOP
    -- Preserve late historical entries instead of ending the session before its data.
    v_end := greatest(public.sa_shift_auto_close_at(s.session_date, s.shift_type), s.started_at, s.production_started_at,
      (SELECT max(recorded_at) FROM public.sa_production_entries WHERE session_id = s.id AND NOT is_cancelled),
      (SELECT max(greatest(started_at, ended_at)) FROM public.sa_downtime_events WHERE session_id = s.id),
      (SELECT max(greatest(started_at, ended_at)) FROM public.sa_changeovers WHERE session_id = s.id),
      (SELECT max(greatest(used_from, used_to)) FROM public.sa_component_usages WHERE session_id = s.id));
    UPDATE public.sa_downtime_events SET ended_at = v_end,
      duration_min = greatest(0, round(extract(epoch FROM (v_end - started_at)) / 60))::integer,
      actions_taken = concat_ws(E'\n', nullif(actions_taken, ''), 'System: koniec sesji; usunięcie usterki nie zostało potwierdzone.')
      WHERE session_id = s.id AND ended_at IS NULL;
    UPDATE public.sa_changeovers SET ended_at = v_end, auto_interrupted = true,
      duration_min = greatest(0, round(extract(epoch FROM (v_end - started_at)) / 60))::integer,
      notes = concat_ws(E'\n', nullif(notes, ''), 'System: przerwane przy automatycznym zamknięciu zmiany. Wymaga sprawdzenia.')
      WHERE session_id = s.id AND ended_at IS NULL;
    UPDATE public.sa_component_usages SET used_to = v_end WHERE session_id = s.id AND used_to IS NULL;
    UPDATE public.sa_sessions SET ended_at = v_end, auto_closed_at = clock_timestamp(),
      machine_status = 'end_of_production', early_end_reason = v_reason,
      summary_notes = concat_ws(E'\n', nullif(summary_notes, ''), v_reason)
      WHERE id = s.id;
    PERFORM public.sa_refresh_session_totals(s.id);
    INSERT INTO public.sa_audit_log(user_id, action, table_name, record_id, old_values, new_values)
      VALUES (NULL, 'session_auto_close', 'sa_sessions', s.id, jsonb_build_object('ended_at', NULL),
        jsonb_build_object('ended_at', v_end, 'reason', v_reason));
    -- Do not fabricate an operator handover or add production quantities.
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.sa_expire_sessions(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.sa_close_expired_sessions(p_machine uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active AND deleted_at IS NULL
    AND role::text IN ('syringe_operator','manager','admin')) THEN
    RAISE EXCEPTION 'Brak uprawnień do linii strzykawkowych.' USING ERRCODE = '42501';
  END IF;
  RETURN public.sa_expire_sessions(auth.uid(), p_machine);
END;
$$;
REVOKE ALL ON FUNCTION public.sa_close_expired_sessions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sa_close_expired_sessions(uuid) TO authenticated;

-- Preserve the existing atomic command implementation and receipt handling.
ALTER FUNCTION public.sa_session_command(text,jsonb) RENAME TO sa_session_command_before_auto_close;
REVOKE ALL ON FUNCTION public.sa_session_command_before_auto_close(text,jsonb) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.sa_session_command(p_action text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_action = 'start' THEN
    PERFORM public.sa_close_expired_sessions((p_payload->>'machine_id')::uuid);
  END IF;
  RETURN public.sa_session_command_before_auto_close(p_action, p_payload);
END;
$$;
REVOKE ALL ON FUNCTION public.sa_session_command(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sa_session_command(text,jsonb) TO authenticated;

-- pg_cron is installed on hosted production by migration 058.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('syringe-auto-close', '* * * * *', 'SELECT public.sa_expire_sessions();');
  ELSE
    RAISE NOTICE 'Enable pg_cron and run supabase/setup_syringe_auto_close.sql for background closure.';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
