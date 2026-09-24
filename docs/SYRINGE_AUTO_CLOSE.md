# Automatyczne zamykanie zmian strzykawkowych

Zmiany zamykają się godzinę po planowym końcu, według czasu Europe/Warsaw:
I o 15:00, II o 23:00, III o 07:00 następnego dnia.

Zastosuj `supabase/migrations/075_syringe_auto_close.sql`. Jeżeli `pg_cron`
jest dostępny, migracja ustawia kontrolę co minutę. Następnie wykonaj
`supabase/setup_syringe_auto_close.sql`, aby zapewnić harmonogram i zamknąć
również istniejące zaległe zmiany. Wdróż frontend z tej wersji.

Rozpoczęcie nowej zmiany dodatkowo zwalnia automat z zaległej zmiany, nawet
jeśli harmonogram chwilowo nie działa. Zmiany przed upływem godziny pozostają otwarte.

Zapisane wyniki są zachowane. Otwarte postoje i użycia komponentów zostają
zamknięte; niezakończone przezbrojenie jest oznaczane jako przerwane i nie
zmienia asortymentu. System nie dopisuje fikcyjnego przekazania zmiany ani
brakujących wyników. Historia zawiera oznaczenie automatycznego zamknięcia
i informację do sprawdzenia. Przy zaległych danych zapisanych po terminie
koniec nie jest ustawiany przed ostatnim istniejącym wpisem.

Kontrola harmonogramu: zadanie `syringe-auto-close` w `cron.job`, wykonania
w `cron.job_run_details`, zdarzenia `session_auto_close` w `sa_audit_log`.

Testy: `node --test --test-isolation=none tests/syringe-auto-close.test.mjs`.
