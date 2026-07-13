-- Funkcja numerujaca zlecenia odwoluje sie do sekwencji production_job_seq oraz
-- odczytuje machines.code - uruchamiana byla jako zwykly (nie SECURITY DEFINER)
-- trigger, wiec dzialala z uprawnieniami wywolujacego operatora, ktory nie ma
-- GRANT na sama sekwencje ("permission denied for sequence production_job_seq").
-- Ten sam wzorzec co juz zastosowany w production_job_seed_components (migracja 045) -
-- system-owe generowanie numerow nie powinno zalezec od uprawnien klienta.
CREATE OR REPLACE FUNCTION production_job_set_numbers()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    NEW.order_number := 'ZP/' || LPAD(nextval('production_job_seq')::text, 6, '0') || '/' || TO_CHAR(NOW(), 'MM/YY');
  END IF;
  IF NEW.series_number IS NULL OR NEW.series_number = '' THEN
    NEW.series_number := 'SER-' || COALESCE((SELECT code FROM machines WHERE id = NEW.machine_id), 'X') || '-' ||
      TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
      LPAD((
        SELECT COUNT(*) + 1 FROM production_jobs
        WHERE machine_id = NEW.machine_id AND started_at::date = CURRENT_DATE
      )::text, 2, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
