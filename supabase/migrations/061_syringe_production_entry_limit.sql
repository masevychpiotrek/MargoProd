-- Enforce the business rule used by the syringe operator screen:
-- one shift can have at most eight active production entries.
BEGIN;

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
      AND id IS DISTINCT FROM NEW.id
  ) >= 8 THEN
    RAISE EXCEPTION 'W tej zmianie zapisano już 8 wpisów produkcji. Skoryguj ostatni wpis albo zakończ zmianę.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sa_limit_production_entries ON public.sa_production_entries;

CREATE TRIGGER trg_sa_limit_production_entries
BEFORE INSERT ON public.sa_production_entries
FOR EACH ROW
EXECUTE FUNCTION public.sa_limit_production_entries();

COMMIT;
