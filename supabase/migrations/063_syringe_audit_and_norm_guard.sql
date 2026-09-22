-- Syringe module hardening:
-- 1) production below expected output requires an operator reason at database level;
-- 2) confirmed syringe workflow changes are written to audit_logs.

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_session_start';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_session_finish';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_status_update';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_production_save';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_production_correction';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_defect_assign';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_downtime_start';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_downtime_end';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_changeover_start';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_changeover_end';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_checklist_update';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_failure_create';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_quality_create';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_component_update';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'syringe_handover_save';

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

  IF a.code IN ('SYR_50ML', 'SYR_100ML') THEN
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
      extract(epoch FROM (COALESCE(NEW.recorded_at, clock_timestamp()) - COALESCE(prev_entry.recorded_at, s.started_at))) / 3600
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

DROP TRIGGER IF EXISTS trg_sa_require_low_output_reason ON public.sa_production_entries;
CREATE TRIGGER trg_sa_require_low_output_reason
BEFORE INSERT ON public.sa_production_entries
FOR EACH ROW
EXECUTE FUNCTION public.sa_require_low_output_reason();

CREATE OR REPLACE FUNCTION public.sa_write_audit(
  p_action text,
  p_table_name text,
  p_record_id uuid,
  p_user_id uuid,
  p_old_values jsonb DEFAULT NULL,
  p_new_values jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_values, new_values)
  VALUES (COALESCE(p_user_id, auth.uid()), p_action::public.audit_action, p_table_name, p_record_id, p_old_values, p_new_values);
EXCEPTION WHEN invalid_text_representation THEN
  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    COALESCE(p_user_id, auth.uid()),
    'config_change',
    p_table_name,
    p_record_id,
    p_old_values,
    jsonb_build_object('audit_action', p_action, 'payload', p_new_values)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sa_audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action text;
  v_user_id uuid;
  v_record_id uuid;
  v_old_values jsonb;
  v_new_values jsonb;
BEGIN
  IF TG_TABLE_NAME = 'sa_sessions' THEN
    v_user_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.operator_id ELSE COALESCE(NEW.operator_id, OLD.operator_id) END;
    v_record_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.id ELSE COALESCE(NEW.id, OLD.id) END;

    IF TG_OP = 'INSERT' THEN
      v_action := 'syringe_session_start';
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL THEN
        v_action := 'syringe_session_finish';
      ELSIF OLD.machine_status IS DISTINCT FROM NEW.machine_status THEN
        v_action := 'syringe_status_update';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'sa_production_entries' THEN
    v_user_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.operator_id ELSE COALESCE(NEW.operator_id, OLD.operator_id) END;
    v_record_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.id ELSE COALESCE(NEW.id, OLD.id) END;

    IF TG_OP = 'INSERT' AND NEW.is_cancelled IS NOT TRUE THEN
      v_action := 'syringe_production_save';
    ELSIF TG_OP = 'UPDATE' AND OLD.is_cancelled IS NOT TRUE AND NEW.is_cancelled IS TRUE THEN
      v_action := 'syringe_production_correction';
    END IF;

  ELSIF TG_TABLE_NAME = 'sa_defect_entries' THEN
    SELECT operator_id INTO v_user_id FROM public.sa_sessions WHERE id = NEW.session_id;
    v_record_id := NEW.id;
    IF TG_OP = 'INSERT' THEN
      v_action := 'syringe_defect_assign';
    END IF;

  ELSIF TG_TABLE_NAME = 'sa_downtime_events' THEN
    v_user_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.operator_id ELSE COALESCE(NEW.operator_id, OLD.operator_id) END;
    v_record_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.id ELSE COALESCE(NEW.id, OLD.id) END;

    IF TG_OP = 'INSERT' THEN
      v_action := 'syringe_downtime_start';
    ELSIF TG_OP = 'UPDATE' AND OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL THEN
      v_action := 'syringe_downtime_end';
    END IF;

  ELSIF TG_TABLE_NAME = 'sa_changeovers' THEN
    v_user_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.operator_id ELSE COALESCE(NEW.operator_id, OLD.operator_id) END;
    v_record_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.id ELSE COALESCE(NEW.id, OLD.id) END;

    IF TG_OP = 'INSERT' THEN
      v_action := 'syringe_changeover_start';
    ELSIF TG_OP = 'UPDATE' AND OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL THEN
      v_action := 'syringe_changeover_end';
    END IF;

  ELSIF TG_TABLE_NAME = 'sa_checklist_completions' THEN
    v_user_id := NEW.completed_by;
    v_record_id := NEW.id;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_action := 'syringe_checklist_update';
    END IF;

  ELSIF TG_TABLE_NAME = 'sa_failure_reports' THEN
    v_user_id := NEW.reporter_id;
    v_record_id := NEW.id;
    IF TG_OP = 'INSERT' THEN
      v_action := 'syringe_failure_create';
    END IF;

  ELSIF TG_TABLE_NAME = 'sa_quality_issues' THEN
    v_user_id := NEW.reporter_id;
    v_record_id := NEW.id;
    IF TG_OP = 'INSERT' THEN
      v_action := 'syringe_quality_create';
    END IF;

  ELSIF TG_TABLE_NAME = 'sa_component_usages' THEN
    v_user_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.operator_id ELSE COALESCE(NEW.operator_id, OLD.operator_id) END;
    v_record_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.id ELSE COALESCE(NEW.id, OLD.id) END;
    IF TG_OP = 'INSERT'
      OR (TG_OP = 'UPDATE' AND OLD.used_to IS NULL AND NEW.used_to IS NOT NULL) THEN
      v_action := 'syringe_component_update';
    END IF;

  ELSIF TG_TABLE_NAME = 'sa_handovers' THEN
    v_user_id := NEW.from_operator_id;
    v_record_id := NEW.id;
    IF TG_OP = 'INSERT' THEN
      v_action := 'syringe_handover_save';
    END IF;
  END IF;

  IF v_action IS NOT NULL THEN
    IF TG_OP = 'UPDATE' THEN
      v_old_values := to_jsonb(OLD);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_new_values := to_jsonb(NEW);
    END IF;

    PERFORM public.sa_write_audit(
      v_action,
      TG_TABLE_NAME,
      v_record_id,
      v_user_id,
      v_old_values,
      v_new_values
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sa_audit_sessions ON public.sa_sessions;
CREATE TRIGGER trg_sa_audit_sessions
AFTER INSERT OR UPDATE ON public.sa_sessions
FOR EACH ROW EXECUTE FUNCTION public.sa_audit_row_change();

DROP TRIGGER IF EXISTS trg_sa_audit_production_entries ON public.sa_production_entries;
CREATE TRIGGER trg_sa_audit_production_entries
AFTER INSERT OR UPDATE ON public.sa_production_entries
FOR EACH ROW EXECUTE FUNCTION public.sa_audit_row_change();

DROP TRIGGER IF EXISTS trg_sa_audit_defect_entries ON public.sa_defect_entries;
CREATE TRIGGER trg_sa_audit_defect_entries
AFTER INSERT ON public.sa_defect_entries
FOR EACH ROW EXECUTE FUNCTION public.sa_audit_row_change();

DROP TRIGGER IF EXISTS trg_sa_audit_downtime_events ON public.sa_downtime_events;
CREATE TRIGGER trg_sa_audit_downtime_events
AFTER INSERT OR UPDATE ON public.sa_downtime_events
FOR EACH ROW EXECUTE FUNCTION public.sa_audit_row_change();

DROP TRIGGER IF EXISTS trg_sa_audit_changeovers ON public.sa_changeovers;
CREATE TRIGGER trg_sa_audit_changeovers
AFTER INSERT OR UPDATE ON public.sa_changeovers
FOR EACH ROW EXECUTE FUNCTION public.sa_audit_row_change();

DROP TRIGGER IF EXISTS trg_sa_audit_checklist_completions ON public.sa_checklist_completions;
CREATE TRIGGER trg_sa_audit_checklist_completions
AFTER INSERT OR UPDATE ON public.sa_checklist_completions
FOR EACH ROW EXECUTE FUNCTION public.sa_audit_row_change();

DROP TRIGGER IF EXISTS trg_sa_audit_failure_reports ON public.sa_failure_reports;
CREATE TRIGGER trg_sa_audit_failure_reports
AFTER INSERT ON public.sa_failure_reports
FOR EACH ROW EXECUTE FUNCTION public.sa_audit_row_change();

DROP TRIGGER IF EXISTS trg_sa_audit_quality_issues ON public.sa_quality_issues;
CREATE TRIGGER trg_sa_audit_quality_issues
AFTER INSERT ON public.sa_quality_issues
FOR EACH ROW EXECUTE FUNCTION public.sa_audit_row_change();

DROP TRIGGER IF EXISTS trg_sa_audit_component_usages ON public.sa_component_usages;
CREATE TRIGGER trg_sa_audit_component_usages
AFTER INSERT OR UPDATE ON public.sa_component_usages
FOR EACH ROW EXECUTE FUNCTION public.sa_audit_row_change();

DROP TRIGGER IF EXISTS trg_sa_audit_handovers ON public.sa_handovers;
CREATE TRIGGER trg_sa_audit_handovers
AFTER INSERT ON public.sa_handovers
FOR EACH ROW EXECUTE FUNCTION public.sa_audit_row_change();

NOTIFY pgrst, 'reload schema';
