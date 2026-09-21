-- Atomic syringe workflows. No production records are deleted or rewritten.
BEGIN;

ALTER TABLE public.sa_production_entries
  ADD COLUMN IF NOT EXISTS assortment_id uuid REFERENCES public.sa_assortments(id);

-- A small plan or short interval must not make an otherwise valid record overflow.
ALTER TABLE public.sa_sessions ALTER COLUMN plan_pct TYPE numeric, ALTER COLUMN avg_per_hour TYPE numeric;
ALTER TABLE public.sa_production_entries ALTER COLUMN plan_pct TYPE numeric, ALTER COLUMN per_hour TYPE numeric;

-- Receipts make retries safe, including after a lost HTTP response.
CREATE TABLE IF NOT EXISTS public.sa_command_receipts (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sa_command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sa_command_receipts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sa_refresh_session_totals(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.sa_sessions%ROWTYPE;
  v_now timestamptz;
  v_elapsed numeric;
  v_stopped numeric;
BEGIN
  SELECT * INTO STRICT s FROM public.sa_sessions WHERE id = p_session_id FOR UPDATE;
  v_now := COALESCE(s.ended_at, clock_timestamp());
  v_elapsed := GREATEST(0, extract(epoch FROM (v_now - s.started_at)) / 60);
  -- Merge overlapping legacy intervals; never count the same minute twice.
  SELECT COALESCE(sum(extract(epoch FROM (upper(r) - lower(r))) / 60), 0)
  INTO v_stopped
  FROM unnest((
    SELECT range_agg(tstzrange(GREATEST(started_at, s.started_at), LEAST(COALESCE(ended_at, v_now), v_now), '[)'))
    FROM (
      SELECT started_at, ended_at FROM public.sa_downtime_events WHERE session_id = s.id
      UNION ALL
      SELECT started_at, ended_at FROM public.sa_changeovers WHERE session_id = s.id
    ) events
    WHERE started_at < v_now AND COALESCE(ended_at, v_now) > s.started_at
  )) r;

  UPDATE public.sa_sessions SET
    total_produced = t.produced, total_good = t.good, total_reject = t.reject,
    total_tech_reject = t.tech, total_qual_reject = t.qual,
    total_downtime_min = round(v_stopped),
    total_runtime_min = GREATEST(0, round(v_elapsed) - round(v_stopped)),
    plan_pct = CASE WHEN plan_qty > 0 THEN round(t.good::numeric / plan_qty * 100, 2) END,
    avg_per_hour = CASE WHEN v_elapsed >= 5 THEN round(t.good::numeric / v_elapsed * 60, 2) END,
    updated_at = clock_timestamp()
  FROM (
    SELECT COALESCE(sum(produced_qty), 0) produced, COALESCE(sum(good_qty), 0) good,
      COALESCE(sum(reject_qty), 0) reject, COALESCE(sum(tech_reject_qty), 0) tech,
      COALESCE(sum(qual_reject_qty), 0) qual
    FROM public.sa_production_entries WHERE session_id = s.id AND NOT is_cancelled
  ) t WHERE id = s.id;
END;
$$;
REVOKE ALL ON FUNCTION public.sa_refresh_session_totals(uuid) FROM PUBLIC, anon, authenticated;

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

  IF p_action IN ('production', 'production_edit') THEN
    SELECT * INTO e FROM public.sa_production_entries WHERE session_id = s.id AND NOT is_cancelled
      ORDER BY recorded_at DESC, created_at DESC, id DESC LIMIT 1;
    IF e.id IS DISTINCT FROM NULLIF(p_payload->>'last_entry_id', '')::uuid THEN
      RAISE EXCEPTION 'W międzyczasie zapisano nowy wynik. Odśwież poprzedni wpis i sprawdź liczniki przed zapisem.';
    END IF;
    IF p_action = 'production_edit' THEN
      IF e.id IS NULL OR NULLIF(trim(p_payload->>'correction_reason'), '') IS NULL THEN
        RAISE EXCEPTION 'Wybierz ostatni wpis i podaj powód korekty.';
      END IF;
      IF e.assortment_id IS NOT NULL AND e.assortment_id <> s.assortment_id THEN
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
    v_elapsed := extract(epoch FROM (v_now - e.recorded_at));
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
      INSERT INTO public.sa_changeovers(session_id, machine_id, operator_id, from_assortment_id, to_assortment_id, counter_before, reason)
        VALUES(s.id, s.machine_id, v_uid, s.assortment_id, v_assortment.id, (p_payload->>'counter_before')::bigint,
          NULLIF(trim(p_payload->>'reason'), '')) RETURNING id INTO v_id;
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
    UPDATE public.sa_changeovers SET ended_at = v_now,
      duration_min = GREATEST(0, round(extract(epoch FROM (v_now - started_at)) / 60)) WHERE id = v_ch.id;
    UPDATE public.sa_sessions SET assortment_id = v_ch.to_assortment_id, order_id = NULL, machine_status = 'production' WHERE id = s.id;
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

-- Legacy browser writes must not bypass the transaction/ownership checks.
REVOKE INSERT, UPDATE, DELETE ON public.sa_sessions, public.sa_production_entries,
  public.sa_defect_entries, public.sa_downtime_events, public.sa_changeovers,
  public.sa_handovers, public.sa_checklist_completions, public.sa_component_usages FROM authenticated;
REVOKE INSERT ON public.sa_failure_reports, public.sa_quality_issues FROM authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
