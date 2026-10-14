-- Correct or close one active session without deleting production history.
BEGIN;
CREATE OR REPLACE FUNCTION public.sa_correct_active_session(
  p_session uuid, p_operator uuid, p_date date, p_shift text, p_close boolean,
  p_reason text, p_expected_updated_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.sa_sessions%ROWTYPE; v_new public.sa_sessions%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()
    AND role::text IN ('admin','manager') AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Brak uprawnień do korekty zmiany.';
  END IF;
  IF length(trim(coalesce(p_reason,''))) < 15 OR p_close IS NULL THEN
    RAISE EXCEPTION 'Podaj konkretny powód korekty, minimum 15 znaków.';
  END IF;
  SELECT * INTO s FROM public.sa_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.ended_at IS NOT NULL OR s.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Zmiana została zmodyfikowana lub zamknięta. Odśwież panel.';
  END IF;
  IF p_close THEN
    -- Use the existing workflow: preserves totals and validates active events.
    PERFORM public.sa_session_command('finish', jsonb_build_object(
      'session_id', s.id, 'request_id', gen_random_uuid(), 'comment', trim(p_reason),
      'final_print', coalesce((SELECT coalesce(counter_print_value,counter_value) FROM public.sa_production_entries
        WHERE session_id=s.id AND NOT is_cancelled ORDER BY recorded_at DESC,created_at DESC,id DESC LIMIT 1),0)::text,
      'final_assembly', coalesce((SELECT coalesce(counter_assembly_value,counter_value) FROM public.sa_production_entries
        WHERE session_id=s.id AND NOT is_cancelled ORDER BY recorded_at DESC,created_at DESC,id DESC LIMIT 1),0)::text));
  ELSE
    IF p_date IS NULL OR p_shift IS NULL OR p_shift NOT IN ('I','II','III')
      OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_operator AND is_active
        AND deleted_at IS NULL AND role::text='syringe_operator') THEN
      RAISE EXCEPTION 'Wybierz aktywnego operatora, datę i numer zmiany.';
    END IF;
    IF public.sa_shift_auto_close_at(p_date,p_shift) <= clock_timestamp() THEN
      RAISE EXCEPTION 'Ta zmiana przekroczyła termin automatycznego zamknięcia.';
    END IF;
    -- Lock the target operator to serialize competing supervisor corrections.
    PERFORM id FROM public.profiles WHERE id=p_operator FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.sa_sessions WHERE operator_id=p_operator AND ended_at IS NULL AND id<>s.id) THEN
      RAISE EXCEPTION 'Wybrany operator ma już otwartą zmianę.';
    END IF;
    IF p_operator <> s.operator_id AND (
      EXISTS (SELECT 1 FROM public.sa_production_entries WHERE session_id=s.id)
      OR EXISTS (SELECT 1 FROM public.sa_downtime_events WHERE session_id=s.id)
      OR EXISTS (SELECT 1 FROM public.sa_changeovers WHERE session_id=s.id)
      OR EXISTS (SELECT 1 FROM public.sa_component_usages WHERE session_id=s.id)
      OR EXISTS (SELECT 1 FROM public.sa_failure_reports WHERE session_id=s.id)
      OR EXISTS (SELECT 1 FROM public.sa_quality_issues WHERE session_id=s.id)) THEN
      RAISE EXCEPTION 'Zmiana zawiera wpisy. Zakończ ją z uzasadnieniem i otwórz nową dla właściwego operatora.';
    END IF;
    UPDATE public.sa_sessions SET operator_id=p_operator, session_date=p_date, shift_type=p_shift,
      updated_at=clock_timestamp() WHERE id=s.id;
  END IF;
  SELECT * INTO v_new FROM public.sa_sessions WHERE id=s.id;
  INSERT INTO public.sa_audit_log(user_id,action,table_name,record_id,old_values,new_values)
    VALUES(auth.uid(),'session_supervisor_correction','sa_sessions',s.id,to_jsonb(s),
      to_jsonb(v_new) || jsonb_build_object('correction_reason',trim(p_reason)));
END;
$$;
REVOKE ALL ON FUNCTION public.sa_correct_active_session(uuid,uuid,date,text,boolean,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sa_correct_active_session(uuid,uuid,date,text,boolean,text,timestamptz) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
