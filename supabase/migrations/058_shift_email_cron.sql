-- Cron dla maili zmianowych - patrz plan: swirling-dreaming-avalanche.
--
-- pg_cron/pg_net nigdy wczesniej nie byly wlaczone w tym projekcie. Zamiast
-- sztywnego harmonogramu UTC (przesunalby sie o godzine przy zmianie czasu
-- letniego/zimowego), cron odpala sie CO GODZINE - sama funkcja
-- send-shift-email sprawdza aktualna godzine Europe/Warsaw i wysyla tylko gdy
-- to faktycznie ~13:00/21:00/05:00 lokalnie (10-min okno tolerancji), inaczej
-- no-op. Rozwiazuje to zmiane czasu bez recznego przestawiania cron wyrazenia
-- dwa razy w roku.
--
-- Sekret uwierzytelniajacy wywolanie cron->Edge Function trzymany jest w
-- Supabase Vault (NIE jako literal w tej migracji) - nazwa: 'cron_shared_secret'.
-- Tworzony osobno, jednorazowo, poza wersjonowanymi migracjami:
--   select vault.create_secret('<wygenerowana-wartosc>', 'cron_shared_secret');
-- Ta sama wartosc musi byc ustawiona jako sekret Edge Function CRON_SHARED_SECRET
-- (npx supabase secrets set CRON_SHARED_SECRET=...) - send-shift-email porownuje
-- naglowek x-cron-secret z tym sekretem, zeby odroznic wywolanie systemowe od
-- zwyklego (niezalogowanego) requestu.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

SELECT cron.schedule(
  'shift-email-hourly-check',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yuofvnitpgipezymkihz.supabase.co/functions/v1/send-shift-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
