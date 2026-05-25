-- Enable live updates for shared operator sessions.
-- Safe to rerun: each table is added only when it is not already published.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'shifts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'hourly_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hourly_reports;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'production_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.production_orders;
  END IF;
END $$;
