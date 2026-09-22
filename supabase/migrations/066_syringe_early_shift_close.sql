-- Explicit early-close tracking for syringe operator sessions.

BEGIN;

ALTER TABLE public.sa_sessions
  ADD COLUMN IF NOT EXISTS ended_early boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS early_end_reason text,
  ADD COLUMN IF NOT EXISTS early_missing_blocks integer[] NOT NULL DEFAULT ARRAY[]::integer[];

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
    WHEN v_assortment_code IN ('SYR_50ML', 'SYR_100ML') THEN 1
    ELSE 8
  END;

  IF v_expected_entries > 1 THEN
    v_shift_hours := CASE NEW.shift_type
      WHEN 'I' THEN ARRAY[6, 7, 8, 9, 10, 11, 12, 13]
      WHEN 'II' THEN ARRAY[14, 15, 16, 17, 18, 19, 20, 21]
      ELSE ARRAY[22, 23, 0, 1, 2, 3, 4, 5]
    END;
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

DROP TRIGGER IF EXISTS trg_sa_mark_early_finish ON public.sa_sessions;
CREATE TRIGGER trg_sa_mark_early_finish
BEFORE UPDATE OF ended_at, summary_notes, early_end_reason, early_missing_blocks ON public.sa_sessions
FOR EACH ROW
EXECUTE FUNCTION public.sa_mark_early_finish();

NOTIFY pgrst, 'reload schema';
COMMIT;
