-- Naprawa: edge function extract-shift-stats dziala jako service_role, a tabele
-- utworzone w migracji 049 nie dostaly zadnych grantow dla tej roli (tabele
-- tworzone przez "db query" nie dziedzicza domyslnych uprawnien Supabase).
-- Skutek: funkcja nie mogla ani odczytac rekordu zdjecia, ani zapisac wynikow
-- OCR - kazda proba odczytu AI konczyla sie "permission denied".
GRANT ALL ON public.shift_stat_photos TO service_role;
GRANT ALL ON public.shift_stat_readings TO service_role;
