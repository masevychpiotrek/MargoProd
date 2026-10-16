BEGIN;

CREATE TABLE public.is_pro_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  assortment_id uuid NOT NULL REFERENCES public.assortments(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  final_good integer CHECK(final_good >= 0),
  final_reject integer CHECK(final_reject >= 0),
  UNIQUE(shift_id,assortment_id),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX is_pro_one_running_segment ON public.is_pro_segments(shift_id) WHERE ended_at IS NULL;
CREATE TABLE public.is_pro_changeovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.machines(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK(ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX is_pro_one_changeover ON public.is_pro_changeovers(machine_id) WHERE ended_at IS NULL;
ALTER TABLE public.hourly_reports ADD COLUMN segment_id uuid REFERENCES public.is_pro_segments(id);
ALTER TABLE public.hourly_reports ADD COLUMN is_segment_close boolean NOT NULL DEFAULT false;
DROP INDEX IF EXISTS public.hourly_reports_active_shift_hour_key;
CREATE UNIQUE INDEX hourly_reports_active_shift_hour_key ON public.hourly_reports
 (shift_id, hour_start, coalesce(segment_id, '00000000-0000-0000-0000-000000000000'::uuid))
 WHERE deleted_at IS NULL AND NOT is_segment_close;

ALTER TABLE public.is_pro_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.is_pro_changeovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY is_pro_segments_read ON public.is_pro_segments FOR SELECT TO authenticated USING(true);
CREATE POLICY is_pro_changeovers_read ON public.is_pro_changeovers FOR SELECT TO authenticated USING(true);
GRANT SELECT ON public.is_pro_segments, public.is_pro_changeovers TO authenticated;

-- All transitions and report writes lock the shift first, including concurrent devices.
CREATE FUNCTION public.is_pro_command(p_shift uuid, p_action text, p_segment uuid DEFAULT NULL,
 p_assortment uuid DEFAULT NULL, p_good integer DEFAULT NULL, p_reject integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.shifts; seg public.is_pro_segments; result_id uuid; g integer; r integer;
BEGIN
 SELECT * INTO s FROM public.shifts WHERE id=p_shift FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR s.ended_at IS NOT NULL OR NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND deleted_at IS NULL
    AND (id IN(s.operator_1_id,s.operator_2_id) OR role::text IN('admin','manager'))) THEN
  RAISE EXCEPTION 'Brak dostępu do aktywnej zmiany.';
 END IF;
 PERFORM 1 FROM public.machines WHERE id=s.machine_id FOR UPDATE;
 SELECT * INTO seg FROM public.is_pro_segments WHERE shift_id=s.id AND ended_at IS NULL;
 IF p_action='start' THEN
  IF seg.id IS NOT NULL THEN
   IF seg.id=p_segment THEN RETURN seg.id; END IF;
   RAISE EXCEPTION 'Produkcja jest już rozpoczęta. Odśwież ekran.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.is_pro_segments x JOIN public.shifts sh ON sh.id=x.shift_id
    WHERE sh.machine_id=s.machine_id AND sh.id<>s.id AND sh.ended_at IS NULL AND x.ended_at IS NULL) THEN
   RAISE EXCEPTION 'Najpierw zakończ produkcję poprzedniej zmiany na tej maszynie.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.assortments WHERE id=p_assortment AND is_active) THEN
   RAISE EXCEPTION 'Wybierz aktywny asortyment.';
  END IF;
  -- Do not silently assign earlier, unlabelled production to a new product.
  IF NOT EXISTS(SELECT 1 FROM public.is_pro_segments WHERE shift_id=s.id)
    AND EXISTS(SELECT 1 FROM public.hourly_reports WHERE shift_id=s.id AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'Ta zmiana ma już wyniki bez asortymentu. Nowy przebieg rozpocznij od kolejnej zmiany.';
  END IF;
  UPDATE public.is_pro_changeovers SET ended_at=now() WHERE machine_id=s.machine_id AND ended_at IS NULL;
  INSERT INTO public.is_pro_segments(shift_id,assortment_id) VALUES(s.id,p_assortment) RETURNING id INTO result_id;
  RETURN result_id;
 ELSIF p_action='changeover' THEN
  IF seg.id IS NULL OR seg.id IS DISTINCT FROM p_segment THEN
   -- A retry of a completed request must not start a second event.
   IF EXISTS(SELECT 1 FROM public.is_pro_segments WHERE id=p_segment AND shift_id=s.id AND ended_at IS NOT NULL) THEN RETURN p_segment; END IF;
   RAISE EXCEPTION 'Asortyment został już zmieniony. Odśwież ekran.';
  END IF;
  SELECT coalesce(sum(good_count),0),coalesce(sum(reject_count),0) INTO g,r
   FROM public.hourly_reports WHERE segment_id=seg.id AND deleted_at IS NULL;
  IF p_good IS NULL OR p_reject IS NULL OR p_good<g OR p_reject<r THEN
   RAISE EXCEPTION 'Końcowy stan licznika nie może być mniejszy od zapisanej produkcji.';
  END IF;
  -- Save the unreported tail separately; never rewrite an earlier hourly result.
  IF p_good>g OR p_reject>r THEN
   INSERT INTO public.hourly_reports(shift_id,machine_id,operator_id,hour_block,report_date,hour_start,
    good_count,reject_count,counter_good,counter_reject,target,runtime_min,downtime_reason,segment_id,is_segment_close)
   VALUES(s.id,s.machine_id,auth.uid(),'Zamknięcie asortymentu',s.shift_date,
    extract(hour FROM now() AT TIME ZONE 'Europe/Warsaw'),p_good-g,p_reject-r,p_good,p_reject,0,0,
    'Zakończenie asortymentu przed przezbrojeniem',seg.id,true);
  END IF;
  UPDATE public.is_pro_segments SET ended_at=now(),final_good=p_good,final_reject=p_reject WHERE id=seg.id;
  INSERT INTO public.is_pro_changeovers(shift_id,machine_id) VALUES(s.id,s.machine_id);
  RETURN seg.id;
 END IF;
 RAISE EXCEPTION 'Nieznana operacja.';
END;
$$;
REVOKE ALL ON FUNCTION public.is_pro_command(uuid,text,uuid,uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_pro_command(uuid,text,uuid,uuid,integer,integer) TO authenticated;

CREATE FUNCTION public.is_pro_guard_report() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s public.shifts; seg public.is_pro_segments; g integer; r integer;
BEGIN
 SELECT * INTO s FROM public.shifts WHERE id=NEW.shift_id FOR UPDATE;
 IF NEW.segment_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.is_pro_segments WHERE shift_id=NEW.shift_id) THEN
   RAISE EXCEPTION 'Wybierz aktualny asortyment i odśwież ekran.';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO seg FROM public.is_pro_segments WHERE id=NEW.segment_id;
 IF current_user NOT IN('postgres','supabase_admin','service_role') AND NOT EXISTS
  (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND deleted_at IS NULL
   AND (id IN(s.operator_1_id,s.operator_2_id) OR role::text IN('admin','manager'))) THEN
  RAISE EXCEPTION 'Brak dostępu do tej zmiany.';
 END IF;
 IF seg.shift_id IS DISTINCT FROM NEW.shift_id OR s.machine_id IS DISTINCT FROM NEW.machine_id
   OR s.ended_at IS NOT NULL OR seg.ended_at IS NOT NULL THEN
  RAISE EXCEPTION 'Nie można zmieniać wyników zakończonego asortymentu.';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.segment_id IS DISTINCT FROM OLD.segment_id OR NEW.is_segment_close IS DISTINCT FROM OLD.is_segment_close) THEN
  RAISE EXCEPTION 'Nie można przenosić wpisu do innego asortymentu.';
 END IF;
 IF NEW.is_segment_close AND current_user NOT IN('postgres','supabase_admin','service_role') THEN
  RAISE EXCEPTION 'Użyj przycisku rozpoczęcia przezbrojenia.';
 END IF;
 SELECT coalesce(sum(good_count),0),coalesce(sum(reject_count),0) INTO g,r
  FROM public.hourly_reports WHERE segment_id=NEW.segment_id AND deleted_at IS NULL AND id<>NEW.id;
 IF NEW.deleted_at IS NULL AND (NEW.counter_good IS NULL OR NEW.counter_reject IS NULL
   OR NEW.counter_good-g IS DISTINCT FROM NEW.good_count OR NEW.counter_reject-r IS DISTINCT FROM NEW.reject_count
   OR NEW.good_count<0 OR NEW.reject_count<0) THEN
  RAISE EXCEPTION 'Stan licznika jest nieaktualny. Odśwież ekran i wpisz bieżący stan.';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER is_pro_guard_report BEFORE INSERT OR UPDATE ON public.hourly_reports
 FOR EACH ROW EXECUTE FUNCTION public.is_pro_guard_report();

-- Final totals remain compatible with existing management reports.
CREATE FUNCTION public.is_pro_close_shift() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE seg public.is_pro_segments; g integer; r integer; closed_g integer; closed_r integer; fg integer; fr integer;
BEGIN
 IF NEW.ended_at IS NULL OR OLD.ended_at IS NOT NULL THEN RETURN NEW; END IF;
 SELECT * INTO seg FROM public.is_pro_segments WHERE shift_id=NEW.id AND ended_at IS NULL;
 IF seg.id IS NULL THEN RETURN NEW; END IF;
 SELECT coalesce(sum(final_good),0),coalesce(sum(final_reject),0) INTO closed_g,closed_r
  FROM public.is_pro_segments WHERE shift_id=NEW.id AND ended_at IS NOT NULL;
 SELECT coalesce(sum(good_count),0),coalesce(sum(reject_count),0) INTO g,r
  FROM public.hourly_reports WHERE segment_id=seg.id AND deleted_at IS NULL;
 fg:=coalesce(NEW.summary_good_count-closed_g,g); fr:=coalesce(NEW.summary_reject_count-closed_r,r);
 IF fg<g OR fr<r THEN RAISE EXCEPTION 'Końcowy licznik jest mniejszy od zapisanej produkcji.'; END IF;
 IF fg>g OR fr>r THEN
  INSERT INTO public.hourly_reports(shift_id,machine_id,operator_id,hour_block,report_date,hour_start,
   good_count,reject_count,counter_good,counter_reject,target,runtime_min,downtime_reason,segment_id,is_segment_close)
  VALUES(NEW.id,NEW.machine_id,NEW.operator_1_id,'Koniec zmiany',NEW.shift_date,
   extract(hour FROM NEW.ended_at AT TIME ZONE 'Europe/Warsaw'),fg-g,fr-r,fg,fr,0,0,'Końcowy stan licznika',seg.id,true);
 END IF;
 UPDATE public.is_pro_segments SET ended_at=greatest(started_at,NEW.ended_at),final_good=fg,final_reject=fr WHERE id=seg.id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER is_pro_close_shift BEFORE UPDATE OF ended_at ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.is_pro_close_shift();
NOTIFY pgrst, 'reload schema';
COMMIT;
