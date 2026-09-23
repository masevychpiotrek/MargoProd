-- Explicit physical line size. Only known seeded codes are mapped automatically.
BEGIN;
ALTER TABLE public.sa_machines ADD COLUMN volume_ml numeric(6,2) CHECK (volume_ml > 0);
UPDATE public.sa_machines SET volume_ml = CASE code
  WHEN 'SA-2ML' THEN 2 WHEN 'SA-5ML' THEN 5 WHEN 'SA-10ML' THEN 10
  WHEN 'SA-20ML' THEN 20 WHEN 'SA-50ML' THEN 50 WHEN 'SA-100ML' THEN 100 END;

CREATE OR REPLACE FUNCTION public.sa_assert_compatible(p_machine uuid, p_assortment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Shared row locks also serialize concurrent configuration changes.
  PERFORM 1 FROM sa_machines m JOIN sa_assortments a ON a.id = p_assortment
    WHERE m.id = p_machine AND m.is_active AND m.deleted_at IS NULL AND a.is_active
      AND m.volume_ml > 0 AND m.volume_ml = a.volume_ml FOR SHARE OF m, a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asortyment niezgodny z rozmiarem linii lub nieaktywna konfiguracja. Sprawdź pojemność linii i asortymentu.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.sa_assert_compatible(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.sa_guard_compatibility() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'sa_changeovers' THEN
    PERFORM sa_assert_compatible(NEW.machine_id, NEW.from_assortment_id);
    PERFORM sa_assert_compatible(NEW.machine_id, NEW.to_assortment_id);
  ELSIF TG_TABLE_NAME <> 'sa_orders' OR NEW.machine_id IS NOT NULL THEN
    PERFORM sa_assert_compatible(NEW.machine_id, NEW.assortment_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sa_compat_session BEFORE INSERT OR UPDATE OF machine_id, assortment_id
  ON public.sa_sessions FOR EACH ROW EXECUTE FUNCTION public.sa_guard_compatibility();
CREATE TRIGGER sa_compat_entry BEFORE INSERT ON public.sa_production_entries
  FOR EACH ROW EXECUTE FUNCTION public.sa_guard_compatibility();
CREATE TRIGGER sa_compat_changeover BEFORE INSERT OR UPDATE OF to_assortment_id, ended_at
  ON public.sa_changeovers FOR EACH ROW EXECUTE FUNCTION public.sa_guard_compatibility();
CREATE TRIGGER sa_compat_order BEFORE INSERT OR UPDATE OF machine_id, assortment_id
  ON public.sa_orders FOR EACH ROW EXECUTE FUNCTION public.sa_guard_compatibility();

-- Configuration changes must not change the physical size of existing history.
CREATE FUNCTION public.sa_guard_size_edit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.volume_ml IS NULL AND NEW.volume_ml IS NOT NULL THEN
    IF TG_TABLE_NAME = 'sa_machines' THEN
      IF EXISTS (SELECT 1 FROM (
        SELECT assortment_id FROM sa_sessions WHERE machine_id = OLD.id
        UNION SELECT assortment_id FROM sa_production_entries WHERE machine_id = OLD.id
        UNION SELECT assortment_id FROM sa_orders WHERE machine_id = OLD.id
        UNION SELECT from_assortment_id FROM sa_changeovers WHERE machine_id = OLD.id
        UNION SELECT to_assortment_id FROM sa_changeovers WHERE machine_id = OLD.id
      ) x JOIN sa_assortments a ON a.id = x.assortment_id
        WHERE a.volume_ml IS DISTINCT FROM NEW.volume_ml) THEN
        RAISE EXCEPTION 'Rozmiar linii jest sprzeczny z istniejącymi powiązaniami. Najpierw sprawdź audyt danych.';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM (
      SELECT machine_id FROM sa_sessions WHERE assortment_id = OLD.id
      UNION SELECT machine_id FROM sa_production_entries WHERE assortment_id = OLD.id
      UNION SELECT machine_id FROM sa_orders WHERE assortment_id = OLD.id AND machine_id IS NOT NULL
      UNION SELECT machine_id FROM sa_changeovers WHERE from_assortment_id = OLD.id OR to_assortment_id = OLD.id
    ) x JOIN sa_machines m ON m.id = x.machine_id
      WHERE m.volume_ml IS DISTINCT FROM NEW.volume_ml) THEN
      RAISE EXCEPTION 'Rozmiar asortymentu jest sprzeczny z istniejącymi powiązaniami. Najpierw sprawdź audyt danych.';
    END IF;
  END IF;
  IF OLD.volume_ml IS NOT NULL AND NEW.volume_ml IS DISTINCT FROM OLD.volume_ml THEN
    IF TG_TABLE_NAME = 'sa_machines' THEN
      IF EXISTS (SELECT 1 FROM sa_sessions WHERE machine_id = OLD.id)
        OR EXISTS (SELECT 1 FROM sa_orders WHERE machine_id = OLD.id) THEN
        RAISE EXCEPTION 'Nie można zmienić rozmiaru linii powiązanej z produkcją lub zleceniem.';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM sa_sessions WHERE assortment_id = OLD.id)
      OR EXISTS (SELECT 1 FROM sa_production_entries WHERE assortment_id = OLD.id)
      OR EXISTS (SELECT 1 FROM sa_changeovers WHERE from_assortment_id = OLD.id OR to_assortment_id = OLD.id)
      OR EXISTS (SELECT 1 FROM sa_orders WHERE assortment_id = OLD.id) THEN
      RAISE EXCEPTION 'Nie można zmienić rozmiaru asortymentu powiązanego z produkcją lub zleceniem.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sa_size_machine BEFORE UPDATE OF volume_ml ON public.sa_machines
  FOR EACH ROW EXECUTE FUNCTION public.sa_guard_size_edit();
CREATE TRIGGER sa_size_assortment BEFORE UPDATE OF volume_ml ON public.sa_assortments
  FOR EACH ROW EXECUTE FUNCTION public.sa_guard_size_edit();
ALTER TABLE public.sa_assortments ADD COLUMN variant text CHECK (variant IN ('Nominał', 'Standard'));
-- Keep original IDs/codes and production norms; create the second selectable variant.
UPDATE public.sa_assortments SET variant = 'Nominał', name = name || ' · Nominał'
 WHERE code IN ('SYR_2ML','SYR_5ML','SYR_10ML','SYR_20ML','SYR_50ML','SYR_100ML');
INSERT INTO public.sa_assortments(name, code, volume_ml, nominal_per_hour, shift_target_qty,
 reject_target_pct, description, is_active, sort_order, variant)
SELECT replace(name, ' · Nominał', ' · Standard'), code || '_STANDARD', volume_ml, nominal_per_hour,
 shift_target_qty, reject_target_pct, description, is_active, sort_order, 'Standard'
FROM public.sa_assortments WHERE code IN ('SYR_2ML','SYR_5ML','SYR_10ML','SYR_20ML','SYR_50ML','SYR_100ML')
ON CONFLICT (code) DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;
