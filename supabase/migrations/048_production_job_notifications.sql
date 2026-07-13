-- Powiadomienie dla drugiego operatora na zmianie, gdy ktos zmieni numer serii
-- polfabrykatu (glownie dren/regulator/luer-lock, ktore czesto wpisuje inny operator
-- niz ten, ktory prowadzi raport). Powiadomienie zostaje aktywne, dopoki operator
-- nie kliknie "Wpisano" (notifications.is_read).
--
-- RLS na notifications ("notif_own": auth.uid() = user_id) nie pozwala jednemu
-- operatorowi wstawic powiadomienia dla drugiego, wiec robi to trigger SECURITY DEFINER
-- (ten sam wzorzec co production_job_seed_components w migracji 045).

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'production_job_update';

CREATE OR REPLACE FUNCTION production_job_component_notify()
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE
  v_job         production_jobs%ROWTYPE;
  v_shift       shifts%ROWTYPE;
  v_changer     TEXT;
  v_target_id   UUID;
BEGIN
  IF NEW.batch_number IS NOT DISTINCT FROM OLD.batch_number THEN
    RETURN NEW;
  END IF;
  IF NEW.entered_by IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_job FROM production_jobs WHERE id = NEW.job_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- biezaca (aktywna) zmiana na tym automacie - nie koniecznie ta, na ktorej
  -- zlecenie zostalo rozpoczete, bo zlecenie moze trwac przez wiele zmian
  SELECT * INTO v_shift FROM shifts
    WHERE machine_id = v_job.machine_id AND ended_at IS NULL
    ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_target_id := CASE
    WHEN v_shift.operator_1_id = NEW.entered_by THEN v_shift.operator_2_id
    WHEN v_shift.operator_2_id = NEW.entered_by THEN v_shift.operator_1_id
    ELSE NULL
  END;
  IF v_target_id IS NULL THEN RETURN NEW; END IF;

  SELECT full_name INTO v_changer FROM profiles WHERE id = NEW.entered_by;

  INSERT INTO notifications (user_id, type, title, body, machine_id)
  VALUES (
    v_target_id,
    'production_job_update',
    COALESCE(v_changer, 'Operator') || ' zmienił(a): ' || NEW.component_label,
    'Nowy numer serii: ' || COALESCE(NEW.batch_number, '—') || '. Sprawdź i wpisz do raportu w zleceniu ' || v_job.order_number || '.',
    v_job.machine_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_production_job_component_notify
  AFTER UPDATE ON production_job_components
  FOR EACH ROW EXECUTE FUNCTION production_job_component_notify();
