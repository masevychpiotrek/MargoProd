-- Private one-to-one conversations. Apply before deploying the messenger UI.
BEGIN;

CREATE TABLE public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low uuid NOT NULL REFERENCES public.profiles(id),
  user_high uuid NOT NULL REFERENCES public.profiles(id),
  read_low_seq bigint NOT NULL DEFAULT 0,
  read_high_seq bigint NOT NULL DEFAULT 0,
  last_message_seq bigint,
  last_message_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (user_low < user_high),
  UNIQUE (user_low, user_high)
);
CREATE INDEX chat_conversations_high ON public.chat_conversations(user_high);

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id),
  sender_id uuid NOT NULL REFERENCES public.profiles(id),
  request_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body, E' \t\r\n')) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (sender_id, request_id)
);
CREATE INDEX chat_messages_history ON public.chat_messages(conversation_id, seq DESC);

CREATE FUNCTION public.chat_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()
    AND is_active AND deleted_at IS NULL
    AND role::text IN ('operator', 'syringe_operator', 'manager', 'specialist', 'executive', 'admin'));
$$;

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_conversations_own ON public.chat_conversations FOR SELECT TO authenticated
  USING (public.chat_enabled() AND auth.uid() IN (user_low, user_high));
CREATE POLICY chat_messages_own ON public.chat_messages FOR SELECT TO authenticated
  USING (public.chat_enabled() AND EXISTS (SELECT 1 FROM public.chat_conversations c
    WHERE c.id = conversation_id AND auth.uid() IN (c.user_low, c.user_high)));
REVOKE ALL ON public.chat_conversations, public.chat_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_conversations, public.chat_messages TO authenticated;

-- Only the directory fields needed to choose a recipient are exposed.
CREATE FUNCTION public.chat_contacts()
RETURNS TABLE(id uuid, full_name text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.chat_enabled() THEN RAISE EXCEPTION 'Brak dostępu do komunikatora.'; END IF;
  RETURN QUERY SELECT p.id, p.full_name, p.role::text FROM public.profiles p
    WHERE p.id <> auth.uid() AND p.is_active AND p.deleted_at IS NULL
      AND p.role::text IN ('operator', 'syringe_operator', 'manager', 'specialist', 'executive', 'admin')
    ORDER BY p.full_name, p.id;
END;
$$;

CREATE FUNCTION public.chat_inbox()
RETURNS TABLE(id uuid, other_id uuid, full_name text, role text, can_send boolean,
  last_body text, last_sender_id uuid, last_message_at timestamptz,
  unread_count bigint, other_read_seq bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.chat_enabled() THEN RAISE EXCEPTION 'Brak dostępu do komunikatora.'; END IF;
  RETURN QUERY SELECT c.id, p.id, p.full_name, p.role::text,
    p.is_active AND p.deleted_at IS NULL AND p.role::text IN ('operator', 'syringe_operator', 'manager', 'specialist', 'executive', 'admin'),
    m.body, m.sender_id, c.last_message_at,
    (SELECT count(*) FROM public.chat_messages unread WHERE unread.conversation_id = c.id
      AND unread.sender_id <> auth.uid()
      AND unread.seq > CASE WHEN c.user_low = auth.uid() THEN c.read_low_seq ELSE c.read_high_seq END),
    CASE WHEN c.user_low = auth.uid() THEN c.read_high_seq ELSE c.read_low_seq END
  FROM public.chat_conversations c
  JOIN public.profiles p ON p.id = CASE WHEN c.user_low = auth.uid() THEN c.user_high ELSE c.user_low END
  LEFT JOIN public.chat_messages m ON m.seq = c.last_message_seq
  WHERE auth.uid() IN (c.user_low, c.user_high)
  ORDER BY c.last_message_at DESC, c.id;
END;
$$;

CREATE FUNCTION public.chat_send(p_recipient uuid, p_body text, p_request_id uuid)
RETURNS public.chat_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_body text := btrim(p_body, E' \t\r\n');
  v_conversation public.chat_conversations%ROWTYPE;
  v_message public.chat_messages%ROWTYPE;
BEGIN
  IF NOT public.chat_enabled() THEN RAISE EXCEPTION 'Brak dostępu do komunikatora.'; END IF;
  IF p_recipient IS NULL OR p_recipient = v_actor THEN RAISE EXCEPTION 'Wybierz inną osobę.'; END IF;
  IF v_body IS NULL OR length(v_body) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Wiadomość musi mieć od 1 do 4000 znaków.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Brak identyfikatora wiadomości.'; END IF;

  -- A retry after a lost HTTP response must return the original message.
  -- Serialize by sender/request also when a caller reuses the key for another recipient.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text || p_request_id::text, 0));
  SELECT * INTO v_message FROM public.chat_messages
    WHERE sender_id = v_actor AND request_id = p_request_id;
  IF FOUND THEN
    IF v_message.body <> v_body OR NOT EXISTS (SELECT 1 FROM public.chat_conversations
      WHERE id = v_message.conversation_id AND p_recipient IN (user_low, user_high)) THEN
      RAISE EXCEPTION 'Identyfikator wiadomości został już użyty.';
    END IF;
    RETURN v_message;
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = p_recipient AND is_active AND deleted_at IS NULL
    AND role::text IN ('operator', 'syringe_operator', 'manager', 'specialist', 'executive', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ta osoba nie jest dostępna w komunikatorze.'; END IF;
  INSERT INTO public.chat_conversations(user_low, user_high)
    VALUES (least(v_actor, p_recipient), greatest(v_actor, p_recipient))
    ON CONFLICT (user_low, user_high) DO NOTHING;
  SELECT * INTO v_conversation FROM public.chat_conversations
    WHERE user_low = least(v_actor, p_recipient) AND user_high = greatest(v_actor, p_recipient)
    FOR UPDATE;
  INSERT INTO public.chat_messages(conversation_id, sender_id, request_id, body)
    VALUES (v_conversation.id, v_actor, p_request_id, v_body) RETURNING * INTO v_message;
  UPDATE public.chat_conversations SET last_message_seq = v_message.seq,
    last_message_at = v_message.created_at WHERE id = v_conversation.id;
  RETURN v_message;
END;
$$;

CREATE FUNCTION public.chat_mark_read(p_conversation uuid, p_through_seq bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.chat_enabled() OR NOT EXISTS (SELECT 1 FROM public.chat_conversations
    WHERE id = p_conversation AND auth.uid() IN (user_low, user_high)) THEN
    RAISE EXCEPTION 'Brak dostępu do rozmowy.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE conversation_id = p_conversation AND seq = p_through_seq) THEN
    RAISE EXCEPTION 'Nieprawidłowe potwierdzenie odczytu.';
  END IF;
  UPDATE public.chat_conversations
    SET read_low_seq = CASE WHEN user_low = auth.uid() THEN greatest(read_low_seq, p_through_seq) ELSE read_low_seq END,
        read_high_seq = CASE WHEN user_high = auth.uid() THEN greatest(read_high_seq, p_through_seq) ELSE read_high_seq END
    WHERE id = p_conversation AND p_through_seq > CASE WHEN user_low = auth.uid() THEN read_low_seq ELSE read_high_seq END;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_enabled(), public.chat_contacts(), public.chat_inbox(),
  public.chat_send(uuid, text, uuid), public.chat_mark_read(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_enabled(), public.chat_contacts(), public.chat_inbox(),
  public.chat_send(uuid, text, uuid), public.chat_mark_read(uuid, bigint) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations, public.chat_messages;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
