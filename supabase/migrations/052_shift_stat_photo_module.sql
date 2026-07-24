-- Zdjecia statystyk sa robione osobno dla dwoch modulow automatu:
-- "Modul Komory kroplowej" i "Modul Zestaw". Kolumna pozwala UI pokazac
-- dwa dedykowane sloty i wiedziec, ktore zdjecie jest ktore.
ALTER TABLE shift_stat_photos ADD COLUMN module_key TEXT;
