-- Automatyczne maile zmianowe do technikow - patrz plan: swirling-dreaming-avalanche.
-- Technik = rola 'specialist', Mistrz/Kierownik = rola 'manager' (ustalenie z
-- 056_change_issue_log.sql, reuzywane tu bez ponownego pytania).
--
-- Zrodlem "problemu" jest hourly_reports.downtime_reason/reject_reason (brak
-- osobnej tabeli problems w tym schemacie - patrz analiza w planie).
--
-- Lista odbiorcow: stala, recznie zarzadzana (shift_notification_recipients) -
-- NIE role systemowe, bo shifts nie ma zadnego przypisania technika, a profiles
-- nie ma kolumny email.

-- ============================================================
-- SHIFT_NOTIFICATION_RECIPIENTS (stala lista adresow do maila zmianowego)
-- ============================================================
CREATE TABLE shift_notification_recipients (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES profiles(id)
);

-- ============================================================
-- SHIFT_EMAIL_THREADS (jedna wysylka = jedno okno czasowe, WSZYSTKIE automaty)
-- ============================================================
CREATE TABLE shift_email_threads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shift_date      DATE NOT NULL,
  shift_type      TEXT NOT NULL CHECK (shift_type IN ('I', 'II', 'III')),
  message_id      TEXT NOT NULL UNIQUE,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_manually   BOOLEAN NOT NULL DEFAULT false,
  sent_by         UUID REFERENCES profiles(id),
  recipients      TEXT[] NOT NULL,
  numbered_items  JSONB NOT NULL
);

CREATE INDEX idx_shift_email_threads_shift ON shift_email_threads(shift_date, shift_type);

-- ============================================================
-- TECHNICIAN_SHIFT_REPORTS (jeden wiersz na kazda odebrana odpowiedz mailowa)
-- ============================================================
CREATE TABLE technician_shift_reports (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id         UUID NOT NULL REFERENCES shift_email_threads(id),
  shift_date        DATE NOT NULL,
  shift_type        TEXT NOT NULL CHECK (shift_type IN ('I', 'II', 'III')),
  technician_email  TEXT NOT NULL,
  technician_id     UUID REFERENCES profiles(id),
  raw_content       TEXT NOT NULL,
  subject           TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_late           BOOLEAN NOT NULL DEFAULT false,
  matched_via       TEXT NOT NULL CHECK (matched_via IN ('reply', 'subject_fallback'))
);

CREATE INDEX idx_technician_shift_reports_thread ON technician_shift_reports(thread_id);
CREATE INDEX idx_technician_shift_reports_shift ON technician_shift_reports(shift_date, shift_type);

-- ============================================================
-- TECHNICIAN_ACTION_ITEMS (pojedyncze dzialanie technika, dopasowane do numeru)
-- ============================================================
CREATE TABLE technician_action_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id           UUID NOT NULL REFERENCES technician_shift_reports(id),
  item_number         INT,
  action_text         TEXT NOT NULL,
  matched_problem_ids UUID[],
  matched_by          TEXT CHECK (matched_by IN ('number', 'ai')),
  needs_review        BOOLEAN NOT NULL DEFAULT false,
  confirmed_by        UUID REFERENCES profiles(id),
  confirmed_at        TIMESTAMPTZ
);

CREATE INDEX idx_technician_action_items_report ON technician_action_items(report_id);
CREATE INDEX idx_technician_action_items_review ON technician_action_items(needs_review) WHERE needs_review = true;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE shift_notification_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_shift_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_action_items ENABLE ROW LEVEL SECURITY;

-- Lista odbiorcow: pelne zarzadzanie tylko manager/admin (Kierownik/Mistrz).
CREATE POLICY "shift_notification_recipients_all" ON shift_notification_recipients
  FOR ALL USING (
    public.current_user_role() IN ('manager', 'admin')
  ) WITH CHECK (
    public.current_user_role() IN ('manager', 'admin')
  );

-- Watki/raporty/dzialania: odczyt dla specialist/manager/admin (Technik i
-- Kierownik/Mistrz maja widziec to samo w raporcie zmiany). Zapis wylacznie
-- przez Edge Function na service-role (brak INSERT policy dla klienta - ten
-- sam wzorzec co reszta repo, np. shift_email_threads w innych modulach).
CREATE POLICY "shift_email_threads_read" ON shift_email_threads
  FOR SELECT USING (
    public.current_user_role() IN ('specialist', 'manager', 'admin')
  );

CREATE POLICY "technician_shift_reports_read" ON technician_shift_reports
  FOR SELECT USING (
    public.current_user_role() IN ('specialist', 'manager', 'admin')
  );

-- Reczne dopasowanie/potwierdzenie niedopasowanych pozycji - tylko manager/admin
-- (Krok 5 promptu: "mozliwosc recznego przypisania przez Mistrza/Kierownika").
CREATE POLICY "technician_action_items_read" ON technician_action_items
  FOR SELECT USING (
    public.current_user_role() IN ('specialist', 'manager', 'admin')
  );

CREATE POLICY "technician_action_items_update" ON technician_action_items
  FOR UPDATE USING (
    public.current_user_role() IN ('manager', 'admin')
  ) WITH CHECK (
    public.current_user_role() IN ('manager', 'admin')
  );

NOTIFY pgrst, 'reload schema';
