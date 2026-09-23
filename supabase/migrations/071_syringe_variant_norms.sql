BEGIN;
CREATE OR REPLACE FUNCTION public.sa_require_low_output_reason()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.sa_sessions%ROWTYPE;
  a public.sa_assortments%ROWTYPE;
  m public.sa_machines%ROWTYPE;
  prev_entry public.sa_production_entries%ROWTYPE;
  v_nominal numeric := 0;
  v_elapsed_hours numeric := 0;
  v_expected_good integer := 0;
BEGIN
  IF NEW.is_cancelled IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NULLIF(trim(COALESCE(NEW.notes, '')), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM public.sa_sessions WHERE id = NEW.session_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT * INTO a FROM public.sa_assortments WHERE id = COALESCE(NEW.assortment_id, s.assortment_id);
  SELECT * INTO m FROM public.sa_machines WHERE id = NEW.machine_id;

  IF a.volume_ml IN (50, 100) THEN
    v_expected_good := COALESCE(NULLIF(s.plan_qty, 0), a.shift_target_qty, 0);
  ELSE
    SELECT * INTO prev_entry
    FROM public.sa_production_entries
    WHERE session_id = NEW.session_id
      AND is_cancelled IS NOT TRUE
      AND id IS DISTINCT FROM NEW.id
    ORDER BY recorded_at DESC, created_at DESC, id DESC
    LIMIT 1;

    v_nominal := COALESCE(NULLIF(a.nominal_per_hour, 0), NULLIF(m.nominal_per_hour, 0), 0);
    v_elapsed_hours := GREATEST(
      0,
      extract(epoch FROM (COALESCE(NEW.recorded_at, clock_timestamp()) - GREATEST(COALESCE(prev_entry.recorded_at, s.started_at), COALESCE(s.production_started_at, s.started_at)))) / 3600
    );

    IF v_nominal > 0 AND v_elapsed_hours >= 0.75 THEN
      v_expected_good := round(v_nominal * v_elapsed_hours)::integer;
    END IF;
  END IF;

  IF v_expected_good > 0 AND COALESCE(NEW.good_qty, 0) < v_expected_good THEN
    RAISE EXCEPTION 'Wynik jest poniżej normy o % szt. Podaj przyczynę w komentarzu operatora.',
      (v_expected_good - COALESCE(NEW.good_qty, 0));
  END IF;

  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.sa_mark_early_finish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_end timestamptz;
  v_entry_count integer;
  v_expected_entries integer;
  v_assortment_code text;
  v_shift_hours integer[] := ARRAY[]::integer[];
  v_missing_blocks integer[] := ARRAY[]::integer[];
  v_reason text;
BEGIN
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL THEN
    RETURN NEW;
  END IF;

  v_shift_end := CASE NEW.shift_type
    WHEN 'I' THEN (NEW.session_date::timestamp + interval '14 hours') AT TIME ZONE 'Europe/Warsaw'
    WHEN 'II' THEN (NEW.session_date::timestamp + interval '22 hours') AT TIME ZONE 'Europe/Warsaw'
    ELSE (NEW.session_date::timestamp + interval '1 day 6 hours') AT TIME ZONE 'Europe/Warsaw'
  END;

  SELECT code INTO v_assortment_code
  FROM public.sa_assortments
  WHERE id = NEW.assortment_id;

  v_expected_entries := CASE
    WHEN v_assortment_code IN ('SYR_50ML', 'SYR_100ML', 'SYR_50ML_STANDARD', 'SYR_100ML_STANDARD') THEN 1
    ELSE 8
  END;

  IF v_expected_entries > 1 THEN
    SELECT COALESCE(array_agg(hour_start ORDER BY ord), ARRAY[]::integer[])
    INTO v_shift_hours
    FROM unnest(CASE NEW.shift_type
      WHEN 'I' THEN ARRAY[6, 7, 8, 9, 10, 11, 12, 13]
      WHEN 'II' THEN ARRAY[14, 15, 16, 17, 18, 19, 20, 21]
      ELSE ARRAY[22, 23, 0, 1, 2, 3, 4, 5]
    END) WITH ORDINALITY AS blocks(hour_start, ord)
    WHERE NEW.started_at < (
      (NEW.session_date::timestamp
        + CASE WHEN NEW.shift_type = 'III' AND hour_start < 6 THEN interval '1 day' ELSE interval '0 day' END
        + make_interval(hours => hour_start)
        + interval '1 hour') AT TIME ZONE 'Europe/Warsaw'
    );

    v_expected_entries := GREATEST(1, COALESCE(array_length(v_shift_hours, 1), 0));
  END IF;

  SELECT count(*) INTO v_entry_count
  FROM public.sa_production_entries
  WHERE session_id = NEW.id
    AND is_cancelled IS NOT TRUE;

  IF v_expected_entries > 1 THEN
    SELECT COALESCE(array_agg(hour_start ORDER BY ord), ARRAY[]::integer[])
    INTO v_missing_blocks
    FROM unnest(v_shift_hours) WITH ORDINALITY AS blocks(hour_start, ord)
    WHERE ord > v_entry_count;
  END IF;

  IF clock_timestamp() < v_shift_end OR v_entry_count < v_expected_entries THEN
    v_reason := NULLIF(trim(COALESCE(NEW.early_end_reason, NEW.summary_notes, '')), '');
    IF v_reason IS NULL OR length(v_reason) < 15 THEN
      RAISE EXCEPTION 'Podaj konkretny powód przedwczesnego zamknięcia zmiany.';
    END IF;

    NEW.ended_early := true;
    NEW.early_end_reason := v_reason;
    NEW.early_missing_blocks := CASE
      WHEN v_entry_count < v_expected_entries THEN v_missing_blocks
      ELSE ARRAY[]::integer[]
    END;
  ELSE
    NEW.ended_early := false;
    NEW.early_end_reason := NULLIF(trim(COALESCE(NEW.early_end_reason, '')), '');
    NEW.early_missing_blocks := ARRAY[]::integer[];
  END IF;

  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.sa_limit_production_entries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_cancelled IS NOT TRUE AND (
    SELECT count(*)
    FROM public.sa_production_entries
    WHERE session_id = NEW.session_id
      AND is_cancelled IS NOT TRUE
      AND recorded_at >= (SELECT COALESCE(production_started_at, started_at) FROM sa_sessions WHERE id = NEW.session_id)
      AND id IS DISTINCT FROM NEW.id
  ) >= 8 THEN
    RAISE EXCEPTION 'W tym segmencie produkcji zapisano już 8 wpisów produkcji. Skoryguj ostatni wpis albo zakończ zmianę.';
  END IF;

  RETURN NEW;
END;
$$;


COMMIT;
