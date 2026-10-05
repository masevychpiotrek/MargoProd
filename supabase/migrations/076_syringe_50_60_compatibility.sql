-- Legacy catalogue SYR_50ML is labelled 50/60 ml and stores volume_ml=60.
-- Keep its identity, quantities and history; match its actual 50 ml line.
BEGIN;
CREATE OR REPLACE FUNCTION public.sa_assert_compatible(p_machine uuid, p_assortment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM sa_machines m JOIN sa_assortments a ON a.id = p_assortment
    WHERE m.id = p_machine AND m.is_active AND m.deleted_at IS NULL AND a.is_active
      AND m.volume_ml > 0 AND m.volume_ml = CASE
        WHEN a.volume_ml = 60 AND a.code IN ('SYR_50ML', 'SYR_50ML_STANDARD') THEN 50
        ELSE a.volume_ml END
    FOR SHARE OF m, a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asortyment niezgodny z rozmiarem linii lub nieaktywna konfiguracja. Sprawdź pojemność linii i asortymentu.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.sa_assert_compatible(uuid, uuid) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
