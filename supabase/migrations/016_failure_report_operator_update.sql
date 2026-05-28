-- Let an operator attach photos to a failure report they created.
-- The report row is inserted first, then photo URLs are written back after upload.

DROP POLICY IF EXISTS "failure_reports_update_reporter" ON failure_reports;
CREATE POLICY "failure_reports_update_reporter" ON failure_reports
  FOR UPDATE USING (
    auth.uid() = reporter_id
  )
  WITH CHECK (
    auth.uid() = reporter_id
  );
