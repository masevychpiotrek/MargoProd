-- Apply once in Supabase SQL Editor to the database missing migration 069.
-- Requires migrations through 068. Includes original migrations 069-071 in order.

-- SOURCE: supabase/migrations/069_syringe_line_compatibility.sql
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


-- SOURCE: supabase/migrations/070_syringe_changeover_segments.sql
-- Keep existing atomic command, ownership, receipts, counters and checklist workflow.
BEGIN;
ALTER TABLE public.sa_sessions ADD COLUMN production_started_at timestamptz;
UPDATE public.sa_sessions s SET production_started_at = COALESCE(
 (SELECT max(ended_at) FROM public.sa_changeovers c WHERE c.session_id = s.id), s.started_at);
CREATE OR REPLACE FUNCTION public.sa_session_command(p_action text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_request uuid := (p_payload->>'request_id')::uuid;
  v_receipt public.sa_command_receipts%ROWTYPE;
  s public.sa_sessions%ROWTYPE;
  e public.sa_production_entries%ROWTYPE;
  v_corrected public.sa_production_entries%ROWTYPE;
  v_assortment public.sa_assortments%ROWTYPE;
  v_order public.sa_orders%ROWTYPE;
  v_dt public.sa_downtime_events%ROWTYPE;
  v_ch public.sa_changeovers%ROWTYPE;
  v_cat public.sa_defect_categories%ROWTYPE;
  v_dtcat public.sa_downtime_categories%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_id uuid;
  v_machine uuid;
  v_print bigint;
  v_assembly bigint;
  v_pd bigint;
  v_ad bigint;
  v_reject bigint;
  v_tech bigint := 0;
  v_qual bigint := 0;
  v_qty integer;
  v_elapsed numeric;
  v_rate numeric;
  v_defect jsonb;
  v_status text;
  v_result jsonb;
BEGIN
  -- Serialize commands per actor, then per session. Auth identity is never taken from the payload.
  SELECT role::text INTO v_role FROM public.profiles
  WHERE id = v_uid AND is_active AND deleted_at IS NULL FOR UPDATE;
  IF v_role IS NULL OR v_role NOT IN ('syringe_operator', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Brak uprawnień do obsługi linii strzykawkowej.' USING ERRCODE = '42501';
  END IF;
  IF v_request IS NULL THEN RAISE EXCEPTION 'Brak identyfikatora operacji.'; END IF;
  SELECT * INTO v_receipt FROM public.sa_command_receipts WHERE id = v_request;
  IF FOUND THEN
    IF v_receipt.actor_id <> v_uid OR v_receipt.action <> p_action OR v_receipt.payload <> p_payload THEN
      RAISE EXCEPTION 'Identyfikator operacji został już wykorzystany.';
    END IF;
    RETURN v_receipt.result;
  END IF;

  IF p_action = 'start' THEN
    v_machine := (p_payload->>'machine_id')::uuid;
    PERFORM 1 FROM public.sa_machines WHERE id = v_machine AND is_active AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Wybrany automat jest niedostępny.'; END IF;
    IF EXISTS (SELECT 1 FROM public.sa_sessions WHERE operator_id = v_uid AND ended_at IS NULL) THEN
      RAISE EXCEPTION 'Masz już otwartą zmianę. Wróć do pulpitu lub zakończ poprzednią zmianę.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.sa_sessions WHERE machine_id = v_machine AND ended_at IS NULL) THEN
      RAISE EXCEPTION 'Na tym automacie trwa już zmiana. Poprzedni operator lub kierownik musi ją zakończyć.';
    END IF;
    SELECT * INTO v_assortment FROM public.sa_assortments WHERE id = (p_payload->>'assortment_id')::uuid AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Wybrany asortyment jest niedostępny.'; END IF;
    IF NULLIF(p_payload->>'order_id', '') IS NOT NULL THEN
      SELECT * INTO v_order FROM public.sa_orders WHERE id = (p_payload->>'order_id')::uuid FOR UPDATE;
      IF NOT FOUND OR v_order.machine_id IS DISTINCT FROM v_machine OR v_order.assortment_id <> v_assortment.id
        OR v_order.status NOT IN ('planned', 'in_progress') THEN
        RAISE EXCEPTION 'Zlecenie nie pasuje do automatu i asortymentu lub zostało zamknięte.';
      END IF;
    END IF;
    IF p_payload->>'shift_type' IS NULL OR p_payload->>'shift_type' NOT IN ('I', 'II', 'III') THEN
      RAISE EXCEPTION 'Wybierz zmianę.';
    END IF;
    IF NULLIF(p_payload->>'plan_qty', '') IS NOT NULL AND (p_payload->>'plan_qty') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Plan musi być nieujemną liczbą całkowitą.';
    END IF;
    v_now := clock_timestamp();
    INSERT INTO public.sa_sessions(machine_id, operator_id, assortment_id, order_id, shift_type, started_at, session_date, plan_qty)
    VALUES (v_machine, v_uid, v_assortment.id, v_order.id, p_payload->>'shift_type', v_now,
      ((v_now AT TIME ZONE 'Europe/Warsaw') - interval '6 hours')::date,
      COALESCE(NULLIF(p_payload->>'plan_qty', '')::integer, v_assortment.shift_target_qty)) RETURNING * INTO s;
    IF v_order.id IS NOT NULL THEN UPDATE public.sa_orders SET status = 'in_progress', updated_at = v_now WHERE id = v_order.id; END IF;
  ELSE
    SELECT * INTO s FROM public.sa_sessions WHERE id = (p_payload->>'session_id')::uuid FOR UPDATE;
    IF NOT FOUND OR (s.operator_id <> v_uid AND v_role NOT IN ('admin', 'manager')) THEN
      RAISE EXCEPTION 'Nie masz dostępu do tej zmiany.' USING ERRCODE = '42501';
    END IF;
    IF s.ended_at IS NOT NULL THEN RAISE EXCEPTION 'Ta zmiana została już zakończona. Odśwież pulpit.'; END IF;
    v_now := clock_timestamp();
  END IF;

  IF p_action IN ('production', 'production_edit', 'changeover_start') THEN
    PERFORM public.sa_assert_compatible(s.machine_id, s.assortment_id);
  END IF;
  IF p_action IN ('production', 'production_edit') THEN
    IF EXISTS (SELECT 1 FROM sa_changeovers WHERE session_id = s.id AND ended_at IS NULL) THEN
      RAISE EXCEPTION 'Nie można zapisywać produkcji podczas przezbrojenia.';
    END IF;
    SELECT * INTO e FROM public.sa_production_entries WHERE session_id = s.id AND NOT is_cancelled
      ORDER BY recorded_at DESC, created_at DESC, id DESC LIMIT 1;
    IF e.id IS DISTINCT FROM NULLIF(p_payload->>'last_entry_id', '')::uuid THEN
      RAISE EXCEPTION 'W międzyczasie zapisano nowy wynik. Odśwież poprzedni wpis i sprawdź liczniki przed zapisem.';
    END IF;
    IF p_action = 'production_edit' THEN
      IF e.id IS NULL OR NULLIF(trim(p_payload->>'correction_reason'), '') IS NULL THEN
        RAISE EXCEPTION 'Wybierz ostatni wpis i podaj powód korekty.';
      END IF;
      IF e.recorded_at < COALESCE(s.production_started_at, s.started_at) OR (e.assortment_id IS NOT NULL AND e.assortment_id <> s.assortment_id) THEN
        RAISE EXCEPTION 'Nie można zmieniać wpisu poprzedniego asortymentu po przezbrojeniu.';
      END IF;
      v_corrected := e;
      v_now := e.recorded_at;
      UPDATE public.sa_production_entries SET is_cancelled = true, cancel_reason = trim(p_payload->>'correction_reason'),
        cancelled_by = v_uid, cancelled_at = clock_timestamp() WHERE id = e.id;
      SELECT * INTO e FROM public.sa_production_entries WHERE session_id = s.id AND NOT is_cancelled
        ORDER BY recorded_at DESC, created_at DESC, id DESC LIMIT 1;
      IF s.order_id IS NOT NULL THEN
        UPDATE public.sa_orders SET produced_qty = produced_qty - v_corrected.produced_qty,
          good_qty = good_qty - v_corrected.good_qty, reject_qty = reject_qty - v_corrected.reject_qty WHERE id = s.order_id;
      END IF;
    END IF;
    IF COALESCE(p_payload->>'print', '') !~ '^[0-9]+$' OR COALESCE(p_payload->>'assembly', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Stany liczników muszą być nieujemnymi liczbami całkowitymi.';
    END IF;
    v_print := (p_payload->>'print')::bigint; v_assembly := (p_payload->>'assembly')::bigint;
    IF COALESCE((p_payload->>'print_reset')::boolean, false) AND NULLIF(trim(p_payload->>'print_reset_reason'), '') IS NULL
      OR COALESCE((p_payload->>'assembly_reset')::boolean, false) AND NULLIF(trim(p_payload->>'assembly_reset_reason'), '') IS NULL THEN
      RAISE EXCEPTION 'Podaj uzasadnienie zerowania licznika.';
    END IF;
    v_pd := v_print - CASE WHEN COALESCE((p_payload->>'print_reset')::boolean, false) THEN 0 ELSE COALESCE(e.counter_print_value, e.counter_value, 0) END;
    v_ad := v_assembly - CASE WHEN COALESCE((p_payload->>'assembly_reset')::boolean, false) THEN 0 ELSE COALESCE(e.counter_assembly_value, e.counter_value, 0) END;
    IF v_pd < 0 OR v_ad < 0 THEN RAISE EXCEPTION 'Licznik nie może maleć bez zgłoszonego resetu.'; END IF;
    IF v_ad > v_pd THEN RAISE EXCEPTION 'Przyrost montażu nie może przekraczać przyrostu druku.'; END IF;
    IF v_pd > 2147483647 THEN RAISE EXCEPTION 'Przyrost licznika jest zbyt duży. Sprawdź odczyt.'; END IF;
    v_reject := v_pd - v_ad;
    IF jsonb_typeof(COALESCE(p_payload->'defects', '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Nieprawidłowe kategorie braków.'; END IF;
    IF (SELECT count(*) <> count(DISTINCT d->>'category_id') FROM jsonb_array_elements(COALESCE(p_payload->'defects', '[]'::jsonb)) d) THEN
      RAISE EXCEPTION 'Kategorie braków nie mogą się powtarzać.';
    END IF;
    FOR v_defect IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'defects', '[]'::jsonb)) LOOP
      SELECT * INTO v_cat FROM public.sa_defect_categories WHERE id = (v_defect->>'category_id')::uuid AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Kategoria braków jest niedostępna.'; END IF;
      IF COALESCE(v_defect->>'qty', '') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Ilość braków musi być liczbą całkowitą.'; END IF;
      v_qty := (v_defect->>'qty')::integer;
      IF v_qty <= 0 THEN RAISE EXCEPTION 'Ilość w kategorii braków musi być dodatnia.'; END IF;
      IF v_cat.requires_comment AND NULLIF(trim(v_defect->>'notes'), '') IS NULL THEN RAISE EXCEPTION 'Wybrana kategoria braków wymaga komentarza.'; END IF;
      IF v_cat.defect_type = 'tech' THEN v_tech := v_tech + v_qty; ELSE v_qual := v_qual + v_qty; END IF;
    END LOOP;
    IF v_tech + v_qual <> v_reject THEN RAISE EXCEPTION 'Suma kategorii braków musi być równa różnicy druku i montażu.'; END IF;
    v_elapsed := extract(epoch FROM (v_now - GREATEST(COALESCE(e.recorded_at, s.started_at), COALESCE(s.production_started_at, s.started_at))));
    v_rate := CASE WHEN v_elapsed >= 300 THEN round(v_ad / (v_elapsed / 3600)) END;
    INSERT INTO public.sa_production_entries(session_id, machine_id, operator_id, assortment_id, recorded_at,
      counter_value, counter_reset, counter_reset_reason, counter_print_value, counter_print_reset, counter_print_reset_reason,
      counter_assembly_value, counter_assembly_reset, counter_assembly_reset_reason,
      produced_qty, good_qty, reject_qty, tech_reject_qty, qual_reject_qty, qty_since_last, per_hour, reject_pct, notes)
    VALUES (s.id, s.machine_id, v_uid, s.assortment_id, v_now,
      v_assembly, COALESCE((p_payload->>'assembly_reset')::boolean, false), NULLIF(trim(p_payload->>'assembly_reset_reason'), ''),
      v_print, COALESCE((p_payload->>'print_reset')::boolean, false), NULLIF(trim(p_payload->>'print_reset_reason'), ''),
      v_assembly, COALESCE((p_payload->>'assembly_reset')::boolean, false), NULLIF(trim(p_payload->>'assembly_reset_reason'), ''),
      v_pd, v_ad, v_reject, v_tech, v_qual, v_ad, v_rate,
      CASE WHEN v_pd > 0 THEN v_reject::numeric / v_pd * 100 ELSE 0 END, NULLIF(trim(p_payload->>'notes'), '')) RETURNING id INTO v_id;
    INSERT INTO public.sa_defect_entries(entry_id, session_id, category_id, qty, notes)
      SELECT v_id, s.id, (d->>'category_id')::uuid, (d->>'qty')::integer, NULLIF(trim(d->>'notes'), '')
      FROM jsonb_array_elements(COALESCE(p_payload->'defects', '[]'::jsonb)) d;
    PERFORM public.sa_refresh_session_totals(s.id);
    SELECT * INTO s FROM public.sa_sessions WHERE id = s.id;
    UPDATE public.sa_production_entries SET plan_pct = s.plan_pct,
      remaining_qty = CASE WHEN s.plan_qty > 0 THEN GREATEST(0, s.plan_qty - s.total_good) END,
      eta_minutes = CASE WHEN s.plan_qty > 0 AND v_rate > 0 THEN round(GREATEST(0, s.plan_qty - s.total_good) / v_rate * 60) END
    WHERE id = v_id;
    IF s.order_id IS NOT NULL THEN
      UPDATE public.sa_orders SET produced_qty = produced_qty + v_pd, good_qty = good_qty + v_ad,
        reject_qty = reject_qty + v_reject, updated_at = v_now WHERE id = s.order_id;
    END IF;

  ELSIF p_action IN ('downtime_start', 'changeover_start') THEN
    IF EXISTS (SELECT 1 FROM public.sa_downtime_events WHERE session_id = s.id AND ended_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.sa_changeovers WHERE session_id = s.id AND ended_at IS NULL) THEN
      RAISE EXCEPTION 'Najpierw zakończ aktywny przestój lub przezbrojenie.';
    END IF;
    IF p_action = 'downtime_start' THEN
      SELECT * INTO v_dtcat FROM public.sa_downtime_categories WHERE id = (p_payload->>'category_id')::uuid AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Wybierz aktywną kategorię przestoju.'; END IF;
      INSERT INTO public.sa_downtime_events(session_id, machine_id, operator_id, category_id, description)
        VALUES(s.id, s.machine_id, v_uid, v_dtcat.id, NULLIF(trim(p_payload->>'description'), '')) RETURNING id INTO v_id;
      v_status := CASE WHEN v_dtcat.category_type = 'logistics' THEN 'no_components'
        WHEN v_dtcat.category_type = 'quality' THEN 'quality_control'
        WHEN v_dtcat.code = 'CLEANING' THEN 'cleaning' WHEN v_dtcat.code = 'ADJUSTMENT' THEN 'adjustment'
        WHEN v_dtcat.category_type = 'planned' THEN 'planned_stop' ELSE 'waiting' END;
    ELSE
      SELECT * INTO v_assortment FROM public.sa_assortments WHERE id = (p_payload->>'to_assortment_id')::uuid AND is_active;
      IF NOT FOUND OR v_assortment.id = s.assortment_id THEN RAISE EXCEPTION 'Wybierz inny aktywny asortyment.'; END IF;
      IF NULLIF(p_payload->>'counter_before', '') IS NOT NULL AND p_payload->>'counter_before' !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Stan licznika musi być nieujemną liczbą całkowitą.';
      END IF;
      SELECT * INTO e FROM public.sa_production_entries WHERE session_id = s.id AND NOT is_cancelled ORDER BY recorded_at DESC, created_at DESC, id DESC LIMIT 1;
      IF NULLIF(p_payload->>'counter_before', '')::bigint IS DISTINCT FROM COALESCE(e.counter_assembly_value, e.counter_value, 0) THEN
        RAISE EXCEPTION 'Przed przezbrojeniem zapisz bieżącą produkcję. Stan montażu musi odpowiadać ostatniemu wpisowi.';
      END IF;
      PERFORM public.sa_assert_compatible(s.machine_id, v_assortment.id);
      IF COALESCE(p_payload->>'print_before', '') !~ '^[0-9]+$'
        OR (p_payload->>'print_before')::bigint <> COALESCE(e.counter_print_value, e.counter_value, 0) THEN
        RAISE EXCEPTION 'Przed przezbrojeniem zapisz bieżącą produkcję. Stan druku musi odpowiadać ostatniemu wpisowi.';
      END IF;
      INSERT INTO public.sa_changeovers(session_id, machine_id, operator_id, from_assortment_id, to_assortment_id, counter_before, reason, started_at)
        VALUES(s.id, s.machine_id, v_uid, s.assortment_id, v_assortment.id, (p_payload->>'counter_before')::bigint,
          NULLIF(trim(p_payload->>'reason'), ''), v_now) RETURNING id INTO v_id;
      v_status := 'changeover';
    END IF;
    UPDATE public.sa_sessions SET machine_status = v_status, updated_at = v_now WHERE id = s.id;

  ELSIF p_action = 'downtime_end' THEN
    SELECT * INTO v_dt FROM public.sa_downtime_events WHERE id = (p_payload->>'event_id')::uuid AND session_id = s.id AND ended_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Przestój został już zakończony lub jest niedostępny.'; END IF;
    IF p_payload->>'fully_resolved' IS NULL THEN RAISE EXCEPTION 'Określ, czy problem został usunięty.'; END IF;
    UPDATE public.sa_downtime_events SET ended_at = v_now,
      duration_min = GREATEST(0, round(extract(epoch FROM (v_now - started_at)) / 60)),
      actions_taken = NULLIF(trim(p_payload->>'actions_taken'), ''),
      maintenance_needed = COALESCE((p_payload->>'maintenance_needed')::boolean, false),
      fully_resolved = (p_payload->>'fully_resolved')::boolean, updated_at = v_now WHERE id = v_dt.id;
    UPDATE public.sa_sessions SET machine_status = 'production' WHERE id = s.id;
    PERFORM public.sa_refresh_session_totals(s.id);
    v_id := v_dt.id;

  ELSIF p_action = 'checklist' THEN
    SELECT * INTO v_ch FROM public.sa_changeovers WHERE id = (p_payload->>'changeover_id')::uuid AND session_id = s.id AND ended_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Brak aktywnego przezbrojenia.'; END IF;
    PERFORM 1 FROM public.sa_checklist_items WHERE id = (p_payload->>'item_id')::uuid AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pozycja checklisty jest niedostępna.'; END IF;
    INSERT INTO public.sa_checklist_completions(changeover_id, item_id, completed, completed_by, completed_at)
      VALUES (v_ch.id, (p_payload->>'item_id')::uuid, (p_payload->>'completed')::boolean, v_uid,
        CASE WHEN (p_payload->>'completed')::boolean THEN v_now END)
      ON CONFLICT(changeover_id, item_id) DO UPDATE SET completed = excluded.completed,
        completed_by = excluded.completed_by, completed_at = excluded.completed_at RETURNING id INTO v_id;

  ELSIF p_action = 'changeover_end' THEN
    SELECT * INTO v_ch FROM public.sa_changeovers WHERE id = (p_payload->>'event_id')::uuid AND session_id = s.id AND ended_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Przezbrojenie zostało już zakończone lub jest niedostępne.'; END IF;
    IF EXISTS (SELECT 1 FROM public.sa_checklist_items i WHERE i.is_active AND i.is_required AND NOT EXISTS (
      SELECT 1 FROM public.sa_checklist_completions c WHERE c.changeover_id = v_ch.id AND c.item_id = i.id AND c.completed
    )) THEN RAISE EXCEPTION 'Zatwierdź wszystkie wymagane pozycje checklisty.'; END IF;
    IF NULLIF(p_payload->>'to_assortment_id', '') IS NOT NULL THEN
      v_ch.to_assortment_id := (p_payload->>'to_assortment_id')::uuid;
    END IF;
    PERFORM public.sa_assert_compatible(s.machine_id, v_ch.to_assortment_id);
    IF v_ch.to_assortment_id = s.assortment_id THEN RAISE EXCEPTION 'Wybierz inny aktywny asortyment.'; END IF;
    UPDATE public.sa_changeovers SET ended_at = v_now, to_assortment_id = v_ch.to_assortment_id,
      duration_min = GREATEST(0, round(extract(epoch FROM (v_now - started_at)) / 60)) WHERE id = v_ch.id;
    UPDATE public.sa_sessions SET assortment_id = v_ch.to_assortment_id, production_started_at = v_now, order_id = NULL, machine_status = 'production' WHERE id = s.id;
    PERFORM public.sa_refresh_session_totals(s.id);
    v_id := v_ch.id;

  ELSIF p_action = 'finish' THEN
    IF EXISTS (SELECT 1 FROM public.sa_downtime_events WHERE session_id = s.id AND ended_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.sa_changeovers WHERE session_id = s.id AND ended_at IS NULL) THEN
      RAISE EXCEPTION 'Przed zakończeniem zmiany zakończ aktywny przestój i przezbrojenie.';
    END IF;
    SELECT * INTO e FROM public.sa_production_entries WHERE session_id = s.id AND NOT is_cancelled ORDER BY recorded_at DESC, created_at DESC, id DESC LIMIT 1;
    IF COALESCE(p_payload->>'final_print', '') !~ '^[0-9]+$' OR COALESCE(p_payload->>'final_assembly', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Potwierdź końcowe stany obu liczników.';
    END IF;
    IF (p_payload->>'final_print')::bigint <> COALESCE(e.counter_print_value, e.counter_value, 0)
      OR (p_payload->>'final_assembly')::bigint <> COALESCE(e.counter_assembly_value, e.counter_value, 0) THEN
      RAISE EXCEPTION 'Końcowe liczniki różnią się od ostatniego wpisu. Najpierw zapisz produkcję wraz z brakami.';
    END IF;
    UPDATE public.sa_sessions SET ended_at = v_now, machine_status = 'end_of_production',
      summary_notes = NULLIF(trim(p_payload->>'comment'), '') WHERE id = s.id;
    PERFORM public.sa_refresh_session_totals(s.id);
    SELECT * INTO s FROM public.sa_sessions WHERE id = s.id;
    INSERT INTO public.sa_handovers(session_id, from_operator_id, machine_status, current_assortment_id, produced_qty, remaining_qty,
      active_issues, adjustments_made, unresolved_failures, quality_info, component_status, recommendations, comment)
    VALUES(s.id, v_uid, s.machine_status, s.assortment_id, s.total_good, CASE WHEN s.plan_qty > 0 THEN GREATEST(0, s.plan_qty - s.total_good) END,
      NULLIF(trim(p_payload->>'active_issues'), ''), NULLIF(trim(p_payload->>'adjustments_made'), ''),
      NULLIF(trim(p_payload->>'unresolved_failures'), ''), NULLIF(trim(p_payload->>'quality_info'), ''),
      NULLIF(trim(p_payload->>'component_status'), ''), NULLIF(trim(p_payload->>'recommendations'), ''),
      NULLIF(trim(p_payload->>'comment'), '')) RETURNING id INTO v_id;
    UPDATE public.sa_component_usages SET used_to = v_now WHERE session_id = s.id AND used_to IS NULL;

  ELSIF p_action = 'status' THEN
    v_status := p_payload->>'status';
    IF v_status = 'production' THEN PERFORM public.sa_assert_compatible(s.machine_id, s.assortment_id); END IF;
    IF v_status IS NULL OR v_status IN ('end_of_production', 'changeover') THEN RAISE EXCEPTION 'Użyj formularza zakończenia zmiany lub przezbrojenia.'; END IF;
    IF EXISTS (SELECT 1 FROM public.sa_downtime_events WHERE session_id = s.id AND ended_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.sa_changeovers WHERE session_id = s.id AND ended_at IS NULL) THEN
      RAISE EXCEPTION 'Najpierw zakończ aktywny przestój lub przezbrojenie.';
    END IF;
    UPDATE public.sa_sessions SET machine_status = v_status, updated_at = v_now WHERE id = s.id;

  ELSIF p_action IN ('failure', 'quality') THEN
    IF p_action = 'failure' THEN
      IF NULLIF(trim(p_payload->>'symptoms'), '') IS NULL THEN RAISE EXCEPTION 'Opisz objawy awarii.'; END IF;
      INSERT INTO public.sa_failure_reports(session_id, machine_id, reporter_id, component_name, symptoms, error_code, priority, production_stopped, can_continue)
      VALUES(s.id, s.machine_id, v_uid, NULLIF(trim(p_payload->>'component_name'), ''), trim(p_payload->>'symptoms'),
        NULLIF(trim(p_payload->>'error_code'), ''), p_payload->>'priority', (p_payload->>'production_stopped')::boolean,
        CASE WHEN (p_payload->>'production_stopped')::boolean THEN false ELSE COALESCE((p_payload->>'can_continue')::boolean, true) END) RETURNING id INTO v_id;
    ELSE
      IF NULLIF(trim(p_payload->>'description'), '') IS NULL THEN RAISE EXCEPTION 'Opisz niezgodność.'; END IF;
      IF (p_payload->>'product_separated')::boolean AND NULLIF(trim(p_payload->>'separation_location'), '') IS NULL THEN RAISE EXCEPTION 'Podaj lokalizację wyrobu.'; END IF;
      IF NULLIF(p_payload->>'affected_qty', '') IS NOT NULL AND p_payload->>'affected_qty' !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Ilość wyrobu musi być nieujemną liczbą całkowitą.'; END IF;
      INSERT INTO public.sa_quality_issues(session_id, machine_id, assortment_id, order_id, reporter_id, batch_number, description,
        affected_qty, operator_actions, production_stopped, product_separated, separation_location)
      VALUES(s.id, s.machine_id, s.assortment_id, s.order_id, v_uid, NULLIF(trim(p_payload->>'batch_number'), ''), trim(p_payload->>'description'),
        NULLIF(p_payload->>'affected_qty', '')::integer, NULLIF(trim(p_payload->>'operator_actions'), ''), (p_payload->>'production_stopped')::boolean,
        (p_payload->>'product_separated')::boolean, NULLIF(trim(p_payload->>'separation_location'), '')) RETURNING id INTO v_id;
    END IF;
    IF (p_payload->>'production_stopped')::boolean THEN
      -- Register lost time, not only the red status badge. Avoid overlapping events.
      IF NOT EXISTS (SELECT 1 FROM public.sa_downtime_events WHERE session_id = s.id AND ended_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM public.sa_changeovers WHERE session_id = s.id AND ended_at IS NULL) THEN
        SELECT * INTO v_dtcat FROM public.sa_downtime_categories WHERE code = CASE WHEN p_action = 'failure' THEN 'MECH_FAILURE' ELSE 'QUALITY_CTRL' END AND is_active;
        IF NOT FOUND THEN RAISE EXCEPTION 'Brak aktywnej kategorii przestoju dla zgłoszenia. Uzupełnij konfigurację.'; END IF;
        INSERT INTO public.sa_downtime_events(session_id, machine_id, operator_id, category_id, description)
          VALUES(s.id, s.machine_id, v_uid, v_dtcat.id, COALESCE(p_payload->>'symptoms', p_payload->>'description'));
      END IF;
      UPDATE public.sa_sessions SET machine_status = CASE WHEN p_action = 'failure' THEN 'failure' ELSE 'quality_control' END, updated_at = v_now WHERE id = s.id;
    END IF;
  ELSIF p_action = 'component_add' THEN
    IF NULLIF(trim(p_payload->>'component_name'), '') IS NULL THEN RAISE EXCEPTION 'Podaj nazwę komponentu.'; END IF;
    IF NULLIF(p_payload->>'qty_used', '') IS NOT NULL AND
      (p_payload->>'qty_used' !~ '^[0-9]+(\.[0-9]{1,3})?$' OR (p_payload->>'qty_used')::numeric <= 0) THEN
      RAISE EXCEPTION 'Zużycie musi być dodatnią liczbą, z maksymalnie trzema miejscami po przecinku.';
    END IF;
    INSERT INTO public.sa_component_usages(session_id, operator_id, component_type, component_name, batch_number, qty_used, unit, notes)
    VALUES(s.id, v_uid, p_payload->>'component_type', trim(p_payload->>'component_name'), NULLIF(trim(p_payload->>'batch_number'), ''),
      NULLIF(p_payload->>'qty_used', '')::numeric, COALESCE(NULLIF(trim(p_payload->>'unit'), ''), 'szt'),
      NULLIF(trim(p_payload->>'notes'), '')) RETURNING id INTO v_id;
  ELSIF p_action = 'component_end' THEN
    UPDATE public.sa_component_usages SET used_to = v_now WHERE id = (p_payload->>'component_id')::uuid
      AND session_id = s.id AND used_to IS NULL RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Komponent jest już zakończony lub niedostępny.'; END IF;
  ELSIF p_action <> 'start' THEN
    RAISE EXCEPTION 'Nieznana operacja.';
  END IF;

  v_result := jsonb_build_object('session_id', s.id, 'record_id', v_id, 'ok', true);
  INSERT INTO public.sa_command_receipts(id, actor_id, action, payload, result) VALUES(v_request, v_uid, p_action, p_payload, v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.sa_session_command(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sa_session_command(text, jsonb) TO authenticated;


-- Reconstruct exact production segments without rewriting historical production entries.
CREATE VIEW public.sa_production_segments WITH (security_invoker = true) AS
SELECT s.id session_id, s.machine_id, b.assortment_id, b.started_at,
  LEAST(s.ended_at, (SELECT min(c.started_at) FROM public.sa_changeovers c
    WHERE c.session_id = s.id AND c.started_at >= b.started_at)) ended_at
FROM public.sa_sessions s CROSS JOIN LATERAL (
 SELECT s.started_at, COALESCE((SELECT c.from_assortment_id FROM public.sa_changeovers c
   WHERE c.session_id = s.id ORDER BY c.started_at LIMIT 1), s.assortment_id) assortment_id
 UNION ALL
 SELECT c.ended_at, c.to_assortment_id FROM public.sa_changeovers c
   WHERE c.session_id = s.id AND c.ended_at IS NOT NULL
) b;
GRANT SELECT ON public.sa_production_segments TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;


-- SOURCE: supabase/migrations/071_syringe_variant_norms.sql
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
