-- Explicit early-close tracking for syringe operator sessions.

BEGIN;

ALTER TABLE public.sa_sessions
  ADD COLUMN IF NOT EXISTS ended_early boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS early_end_reason text;

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

  SELECT count(*) INTO v_entry_count
  FROM public.sa_production_entries
  WHERE session_id = NEW.id
    AND is_cancelled IS NOT TRUE;

  IF clock_timestamp() < v_shift_end OR v_entry_count < v_expected_entries THEN
    v_reason := NULLIF(trim(COALESCE(NEW.early_end_reason, NEW.summary_notes, '')), '');
    IF v_reason IS NULL OR length(v_reason) < 15 THEN
      RAISE EXCEPTION 'Podaj konkretny powód przedwczesnego zamknięcia zmiany.';
    END IF;

    NEW.ended_early := true;
    NEW.early_end_reason := v_reason;
  ELSE
    NEW.ended_early := false;
    NEW.early_end_reason := NULLIF(trim(COALESCE(NEW.early_end_reason, '')), '');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sa_mark_early_finish ON public.sa_sessions;
CREATE TRIGGER trg_sa_mark_early_finish
BEFORE UPDATE OF ended_at, summary_notes, early_end_reason ON public.sa_sessions
FOR EACH ROW
EXECUTE FUNCTION public.sa_mark_early_finish();

NOTIFY pgrst, 'reload schema';
COMMIT;
