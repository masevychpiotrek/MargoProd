BEGIN;
CREATE FUNCTION public.production_job_correct(
  p_job uuid, p_expected_updated_at timestamptz, p_order text,
  p_assortment text, p_labels integer, p_reason text
) RETURNS public.production_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_job public.production_jobs; new_job public.production_jobs; v_length integer; v_multiplier integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid()
    AND role::text IN ('manager','admin') AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Brak uprawnień kierownika do korekty zlecenia.';
  END IF;
  IF length(trim(coalesce(p_reason,''))) < 15 THEN
    RAISE EXCEPTION 'Podaj powód korekty, minimum 15 znaków.';
  END IF;
  IF p_order IS NULL OR trim(p_order) !~* '^Z/[0-9]+/(0?[1-9]|1[0-2])/([0-9]{2}|[0-9]{4})$' THEN
    RAISE EXCEPTION 'Podaj numer zlecenia w formacie Z/numer/miesiąc/rok.';
  END IF;
  IF p_labels IS NULL OR p_labels <= 0 THEN RAISE EXCEPTION 'Liczba etykiet musi być większa od zera.'; END IF;
  IF p_assortment IN ('IS PRO 150 cm','IS PRO AIR PASS 150 cm','IS PRO SAFETY 150 cm') THEN
    v_length := 150; v_multiplier := 700;
  ELSIF p_assortment IN ('IS PRO 180 cm','IS PRO AIR PASS 180 cm','IS PRO SAFETY 180 cm') THEN
    v_length := 180; v_multiplier := 650;
  ELSE RAISE EXCEPTION 'Wybierz prawidłowy asortyment.';
  END IF;
  IF p_labels::bigint * v_multiplier > 2147483647 THEN RAISE EXCEPTION 'Liczba etykiet jest zbyt duża.'; END IF;
  SELECT * INTO old_job FROM public.production_jobs WHERE id=p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono zlecenia.'; END IF;
  IF old_job.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Zlecenie zostało zmienione. Otwórz je ponownie przed korektą.';
  END IF;
  UPDATE public.production_jobs SET order_number=trim(p_order), assortment_name=p_assortment,
    assortment_length_cm=v_length, multiplier=v_multiplier, label_count=p_labels,
    calculated_qty=p_labels*v_multiplier WHERE id=p_job RETURNING * INTO new_job;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values,new_values)
    VALUES(auth.uid(),'production_job_correction','production_jobs',p_job,to_jsonb(old_job),
      to_jsonb(new_job) || jsonb_build_object('correction_reason',trim(p_reason)));
  RETURN new_job;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Zlecenie o takim numerze już istnieje.';
END;
$$;
REVOKE ALL ON FUNCTION public.production_job_correct(uuid,timestamptz,text,text,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.production_job_correct(uuid,timestamptz,text,text,integer,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
