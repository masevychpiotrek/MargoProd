-- Syringe workflow guard:
-- - one active session per operator and per machine;
-- - shift finish always requires a written reason;
-- - explicit UR repair downtime phase after "waiting for UR".

BEGIN;

INSERT INTO public.sa_downtime_categories (name, code, category_type, sort_order)
VALUES ('Naprawa UR', 'MAINT_REPAIR', 'unplanned', 14)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  category_type = EXCLUDED.category_type,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

CREATE OR REPLACE FUNCTION public.sa_prevent_duplicate_active_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.ended_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sa_sessions s
    WHERE s.operator_id = NEW.operator_id
      AND s.ended_at IS NULL
      AND s.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Operator ma już otwartą zmianę. Najpierw zakończ poprzednią zmianę.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sa_sessions s
    WHERE s.machine_id = NEW.machine_id
      AND s.ended_at IS NULL
      AND s.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Na tej maszynie jest już aktywna zmiana. Nie można uruchomić drugiej zmiany równolegle.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sa_prevent_duplicate_active_session ON public.sa_sessions;
CREATE TRIGGER trg_sa_prevent_duplicate_active_session
BEFORE INSERT OR UPDATE OF machine_id, operator_id, ended_at ON public.sa_sessions
FOR EACH ROW
EXECUTE FUNCTION public.sa_prevent_duplicate_active_session();

CREATE OR REPLACE FUNCTION public.sa_require_finish_reason()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.ended_at IS NULL
    AND NEW.ended_at IS NOT NULL
    AND NULLIF(trim(COALESCE(NEW.summary_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Podaj powód zamknięcia zmiany.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sa_require_finish_reason ON public.sa_sessions;
CREATE TRIGGER trg_sa_require_finish_reason
BEFORE UPDATE OF ended_at, summary_notes ON public.sa_sessions
FOR EACH ROW
EXECUTE FUNCTION public.sa_require_finish_reason();

-- Add physical unique guards only when existing data is already clean.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.sa_sessions
    WHERE ended_at IS NULL
    GROUP BY machine_id
    HAVING count(*) > 1
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_sa_sessions_one_active ON public.sa_sessions(machine_id) WHERE ended_at IS NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sa_sessions
    WHERE ended_at IS NULL
    GROUP BY operator_id
    HAVING count(*) > 1
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_sa_sessions_one_active_operator_guard ON public.sa_sessions(operator_id) WHERE ended_at IS NULL';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
