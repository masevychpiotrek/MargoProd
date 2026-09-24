BEGIN;

CREATE TABLE public.chat_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  endpoint text NOT NULL UNIQUE CHECK (length(endpoint) <= 4096),
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_push_subscriptions_user ON public.chat_push_subscriptions(user_id);
ALTER TABLE public.chat_push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_push_own ON public.chat_push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.chat_enabled());
REVOKE ALL ON public.chat_push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_push_subscriptions TO authenticated;
GRANT ALL ON public.chat_push_subscriptions TO service_role;

-- The endpoint is a capability URL. Restrict requests to known push services.
CREATE FUNCTION public.chat_push_register(p_endpoint text, p_p256dh text, p_auth text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.chat_enabled() THEN RAISE EXCEPTION 'Brak dostępu do komunikatora.'; END IF;
  IF p_endpoint IS NULL OR length(p_endpoint) > 4096 OR p_endpoint !~
    '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)?push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]]+$'
    OR p_p256dh IS NULL OR p_p256dh !~ '^[A-Za-z0-9_-]{87}=?$'
    OR p_auth IS NULL OR p_auth !~ '^[A-Za-z0-9_-]{22}={0,2}$' THEN
    RAISE EXCEPTION 'Nieprawidłowa subskrypcja powiadomień.';
  END IF;
  INSERT INTO public.chat_push_subscriptions(user_id, endpoint, p256dh, auth_key)
    VALUES (auth.uid(), p_endpoint, p_p256dh, p_auth)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = auth.uid(), updated_at = now()
      WHERE chat_push_subscriptions.p256dh = EXCLUDED.p256dh AND chat_push_subscriptions.auth_key = EXCLUDED.auth_key
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Odnów zgodę na powiadomienia na tym urządzeniu.'; END IF;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.chat_push_unregister(p_endpoint text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM public.chat_push_subscriptions WHERE endpoint = p_endpoint AND user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.chat_push_register(text,text,text), public.chat_push_unregister(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_push_register(text,text,text), public.chat_push_unregister(text) TO authenticated;

CREATE TABLE public.chat_push_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.chat_push_subscriptions(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  completed_at timestamptz,
  result text,
  UNIQUE(message_id, subscription_id)
);
CREATE INDEX chat_push_jobs_pending ON public.chat_push_jobs(available_at) WHERE completed_at IS NULL;
ALTER TABLE public.chat_push_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_push_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.chat_push_jobs TO service_role;

CREATE FUNCTION public.chat_push_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.chat_push_jobs(message_id, subscription_id, recipient_id)
    SELECT NEW.id, s.id, s.user_id FROM public.chat_conversations c
    JOIN public.chat_push_subscriptions s ON s.user_id = CASE WHEN c.user_low = NEW.sender_id THEN c.user_high ELSE c.user_low END
    JOIN public.profiles p ON p.id = s.user_id
    WHERE c.id = NEW.conversation_id AND p.is_active AND p.deleted_at IS NULL
      AND p.role::text IN ('operator','syringe_operator','manager','specialist','executive','admin');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_push_enqueue() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER chat_push_enqueue AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_push_enqueue();

-- Claimed jobs have a lease; parallel workers cannot deliver the same job.
CREATE FUNCTION public.chat_push_claim()
RETURNS TABLE(job_id uuid, lease_token uuid, endpoint text, p256dh text, auth_key text,
  recipient_id uuid, conversation_id uuid, sender_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.chat_push_jobs j SET completed_at = now(), result = 'skipped'
  FROM public.chat_messages m, public.chat_conversations c, public.chat_push_subscriptions s, public.profiles p
  WHERE j.message_id = m.id AND c.id = m.conversation_id AND s.id = j.subscription_id
    AND p.id = j.recipient_id AND j.completed_at IS NULL AND (j.lease_until IS NULL OR j.lease_until < now())
    AND (j.attempts >= 5 OR m.created_at < now() - interval '24 hours'
      OR s.user_id <> j.recipient_id OR NOT p.is_active OR p.deleted_at IS NOT NULL
      OR p.role::text NOT IN ('operator','syringe_operator','manager','specialist','executive','admin')
      OR m.seq <= CASE WHEN c.user_low = j.recipient_id THEN c.read_low_seq ELSE c.read_high_seq END);
  RETURN QUERY
  WITH pending AS (
    SELECT j.id FROM public.chat_push_jobs j WHERE j.completed_at IS NULL
      AND j.available_at <= now() AND (j.lease_until IS NULL OR j.lease_until < now())
    ORDER BY j.available_at, j.id LIMIT 25 FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.chat_push_jobs j SET lease_until = now() + interval '2 minutes', lease_token = gen_random_uuid(), attempts = attempts + 1
      FROM pending WHERE j.id = pending.id RETURNING j.*
  ) SELECT j.id, j.lease_token, s.endpoint, s.p256dh, s.auth_key, j.recipient_id, m.conversation_id, m.sender_id
    FROM claimed j JOIN public.chat_push_subscriptions s ON s.id = j.subscription_id
    JOIN public.chat_messages m ON m.id = j.message_id;
END;
$$;

CREATE FUNCTION public.chat_push_complete(p_job uuid, p_lease uuid, p_status integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_job public.chat_push_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.chat_push_jobs WHERE id = p_job AND lease_token = p_lease
    AND completed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_status IN (404, 410) THEN
    -- Do not remove a registration reassigned to another account since claiming.
    DELETE FROM public.chat_push_subscriptions WHERE id = v_job.subscription_id AND user_id = v_job.recipient_id;
  ELSE
    UPDATE public.chat_push_jobs SET
      completed_at = CASE WHEN p_status BETWEEN 200 AND 299 OR attempts >= 5 THEN now() ELSE NULL END,
      result = CASE WHEN p_status BETWEEN 200 AND 299 THEN 'sent' ELSE 'http_' || coalesce(p_status, 0)::text END,
      available_at = now() + make_interval(secs => least(3600, 30 * (2 ^ attempts)::integer)),
      lease_until = NULL, lease_token = NULL
    WHERE id = p_job;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_push_claim(), public.chat_push_complete(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_push_claim(), public.chat_push_complete(uuid,uuid,integer) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
