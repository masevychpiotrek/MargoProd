-- Atomic correction of a machine/shift, including hourly increments and counters.
CREATE OR REPLACE FUNCTION public.correct_day_report_shift(
  p_shift_id uuid, p_good integer, p_reject integer, p_reason text,
  p_expected_shift_updated_at timestamptz, p_reports jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.shifts%ROWTYPE;
  item jsonb;
  r public.hourly_reports%ROWTYPE;
  old_rows jsonb;
  new_rows jsonb;
  good_sum bigint := 0;
  reject_sum bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('manager','admin') AND is_active = true AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Brak uprawnień do korekty.';
  END IF;
  IF p_good IS NULL OR p_reject IS NULL OR p_good < 0 OR p_reject < 0 OR nullif(trim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Podaj poprawne ilości i powód korekty.';
  END IF;
  SELECT * INTO s FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF s.id IS NULL OR s.updated_at IS DISTINCT FROM p_expected_shift_updated_at THEN
    RAISE EXCEPTION 'Zmiana została zmodyfikowana. Odśwież dane i ponów korektę.';
  END IF;
  IF jsonb_typeof(p_reports) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Niepoprawne wpisy godzinowe.'; END IF;
  PERFORM id FROM public.hourly_reports WHERE shift_id = p_shift_id AND deleted_at IS NULL ORDER BY id FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY hour_start, id), '[]'::jsonb) INTO old_rows
    FROM public.hourly_reports h WHERE shift_id = p_shift_id AND deleted_at IS NULL;
  IF jsonb_array_length(old_rows) <> jsonb_array_length(p_reports)
    OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_reports)) <> jsonb_array_length(p_reports) THEN
    RAISE EXCEPTION 'Lista wpisów zmieniła się. Odśwież raport.';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_reports) LOOP
    SELECT * INTO r FROM public.hourly_reports WHERE id = (item->>'id')::uuid AND shift_id = p_shift_id AND deleted_at IS NULL;
    IF r.id IS NULL OR r.updated_at IS DISTINCT FROM (item->>'updated_at')::timestamptz THEN
      RAISE EXCEPTION 'Wpis godzinowy został zmieniony. Odśwież raport.';
    END IF;
    IF item->>'good_count' IS NULL OR item->>'reject_count' IS NULL
      OR (item->>'good_count')::integer < 0 OR (item->>'reject_count')::integer < 0 THEN RAISE EXCEPTION 'Niepoprawna ilość godzinowa.'; END IF;
    good_sum := good_sum + (item->>'good_count')::integer;
    reject_sum := reject_sum + (item->>'reject_count')::integer;
  END LOOP;
  IF jsonb_array_length(p_reports) > 0 AND (good_sum <> p_good OR reject_sum <> p_reject) THEN
    RAISE EXCEPTION 'Suma wpisów nie zgadza się z korektą zmiany.';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_reports) LOOP
    UPDATE public.hourly_reports SET good_count = (item->>'good_count')::integer, reject_count = (item->>'reject_count')::integer
      WHERE id = (item->>'id')::uuid;
  END LOOP;
  WITH counters AS (
    SELECT id,
      sum(good_count) OVER (ORDER BY CASE WHEN hour_start < 6 THEN hour_start + 24 ELSE hour_start END, id) AS good,
      sum(reject_count) OVER (ORDER BY CASE WHEN hour_start < 6 THEN hour_start + 24 ELSE hour_start END, id) AS reject
    FROM public.hourly_reports WHERE shift_id = p_shift_id AND deleted_at IS NULL
  ) UPDATE public.hourly_reports h SET counter_good = c.good, counter_reject = c.reject, total_count = c.good FROM counters c WHERE h.id = c.id;
  UPDATE public.shifts SET summary_good_count = p_good, summary_reject_count = p_reject WHERE id = p_shift_id;
  SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY hour_start, id), '[]'::jsonb) INTO new_rows
    FROM public.hourly_reports h WHERE shift_id = p_shift_id AND deleted_at IS NULL;
  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_values, new_values)
    VALUES(auth.uid(), 'shift_manager_correction', 'shifts', p_shift_id,
      jsonb_build_object('summary_good_count',s.summary_good_count,'summary_reject_count',s.summary_reject_count,'reports',old_rows),
      jsonb_build_object('summary_good_count',p_good,'summary_reject_count',p_reject,'reason',trim(p_reason),'reports',new_rows));
END;
$$;
REVOKE ALL ON FUNCTION public.correct_day_report_shift(uuid,integer,integer,text,timestamptz,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_day_report_shift(uuid,integer,integer,text,timestamptz,jsonb) TO authenticated;
