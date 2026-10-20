-- Additive migration: existing batches and history remain untouched.
BEGIN;
CREATE FUNCTION public.production_job_exchange_batch(
  p_component uuid, p_job uuid, p_previous text, p_batch text
) RETURNS public.production_job_component_history
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.production_job_components; h public.production_job_component_history;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active
      AND deleted_at IS NULL AND role::text IN ('operator','manager','admin')
  ) THEN RAISE EXCEPTION 'Brak dostępu.'; END IF;
  PERFORM 1 FROM public.production_jobs WHERE id=p_job AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zlecenie nie jest aktywne. Odśwież ekran.'; END IF;
  SELECT * INTO c FROM public.production_job_components
    WHERE id=p_component AND job_id=p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Półfabrykat nie należy do tego zlecenia.'; END IF;
  IF c.batch_number IS DISTINCT FROM p_previous THEN
    RAISE EXCEPTION 'Partia została zmieniona przez innego operatora. Odśwież ekran.';
  END IF;
  IF p_batch IS NULL OR length(trim(p_batch))<3 THEN
    RAISE EXCEPTION 'Podaj konkretny numer partii.';
  END IF;
  IF c.batch_number IS NOT DISTINCT FROM trim(p_batch) THEN
    RAISE EXCEPTION 'Nowa partia jest taka sama jak aktualna.';
  END IF;
  INSERT INTO public.production_job_component_history
    (component_id,job_id,previous_batch_number,new_batch_number,changed_by)
    VALUES(c.id,c.job_id,c.batch_number,trim(p_batch),auth.uid()) RETURNING * INTO h;
  UPDATE public.production_job_components SET batch_number=trim(p_batch),
    entered_at=h.changed_at,entered_by=auth.uid(),status='aktywny' WHERE id=c.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie udało się zapisać partii.'; END IF;
  RETURN h;
END;
$$;
REVOKE ALL ON FUNCTION public.production_job_exchange_batch(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_job_exchange_batch(uuid,uuid,text,text) TO authenticated;
COMMIT;
