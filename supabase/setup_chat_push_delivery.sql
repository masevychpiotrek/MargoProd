-- Run after 074 and after configuring Vault: chat_push_url, chat_push_secret.
-- chat_push_url = https://<project-ref>.supabase.co/functions/v1/send-chat-push
-- chat_push_secret = the same value as the Edge secret CHAT_PUSH_SECRET.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE OR REPLACE FUNCTION public.chat_push_wake() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_url text; v_secret text;
BEGIN
  DELETE FROM public.chat_push_jobs WHERE completed_at < now() - interval '7 days';
  IF NOT EXISTS (SELECT 1 FROM public.chat_push_jobs WHERE completed_at IS NULL AND available_at <= now()
    AND (lease_until IS NULL OR lease_until < now())) THEN RETURN; END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'chat_push_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'chat_push_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-chat-push-secret',v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 10000);
EXCEPTION WHEN OTHERS THEN
  -- A push outage must not roll back a successfully written chat message.
  RAISE WARNING 'Chat push wake failed; the scheduled worker will retry.';
END;
$$;
CREATE OR REPLACE FUNCTION public.chat_push_signal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN PERFORM public.chat_push_wake(); RETURN NULL; END;
$$;
REVOKE ALL ON FUNCTION public.chat_push_wake(), public.chat_push_signal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS chat_push_signal ON public.chat_push_jobs;
CREATE TRIGGER chat_push_signal AFTER INSERT ON public.chat_push_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION public.chat_push_signal();
SELECT cron.schedule('chat-push-retry', '* * * * *', 'SELECT public.chat_push_wake();');
COMMIT;
