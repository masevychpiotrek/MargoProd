-- Keep syringe operators inside the syringe module.
-- They must not be treated as regular IS Pro operators by old RLS policies/functions.

BEGIN;

-- IS Pro shifts.
DROP POLICY IF EXISTS "shifts_read" ON public.shifts;
CREATE POLICY "shifts_read" ON public.shifts
FOR SELECT
USING (
  public.current_user_role() IN ('manager', 'admin', 'viewer', 'executive')
  OR (
    public.current_user_role() = 'operator'
    AND (auth.uid() = operator_1_id OR auth.uid() = operator_2_id)
  )
);

DROP POLICY IF EXISTS "shifts_write" ON public.shifts;
CREATE POLICY "shifts_write" ON public.shifts
FOR INSERT
WITH CHECK (
  (
    public.current_user_role() = 'operator'
    AND auth.uid() = operator_1_id
  )
  OR public.current_user_role() IN ('manager', 'admin')
);

DROP POLICY IF EXISTS "shifts_update" ON public.shifts;
CREATE POLICY "shifts_update" ON public.shifts
FOR UPDATE
USING (
  (
    public.current_user_role() = 'operator'
    AND (auth.uid() = operator_1_id OR auth.uid() = operator_2_id)
  )
  OR public.current_user_role() IN ('manager', 'admin')
)
WITH CHECK (
  (
    public.current_user_role() = 'operator'
    AND (auth.uid() = operator_1_id OR auth.uid() = operator_2_id)
  )
  OR public.current_user_role() IN ('manager', 'admin')
);

-- IS Pro hourly reports.
DROP POLICY IF EXISTS "reports_read" ON public.hourly_reports;
CREATE POLICY "reports_read" ON public.hourly_reports
FOR SELECT
USING (
  public.current_user_role() IN ('manager', 'admin', 'viewer', 'executive')
  OR (
    public.current_user_role() = 'operator'
    AND EXISTS (
      SELECT 1
      FROM public.shifts s
      WHERE s.id = hourly_reports.shift_id
        AND (s.operator_1_id = auth.uid() OR s.operator_2_id = auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "reports_insert" ON public.hourly_reports;
CREATE POLICY "reports_insert" ON public.hourly_reports
FOR INSERT
WITH CHECK (
  public.current_user_role() = 'operator'
  AND auth.uid() = operator_id
);

DROP POLICY IF EXISTS "reports_update" ON public.hourly_reports;
CREATE POLICY "reports_update" ON public.hourly_reports
FOR UPDATE
USING (
  (
    public.current_user_role() = 'operator'
    AND auth.uid() = operator_id
  )
  OR public.current_user_role() IN ('manager', 'admin')
)
WITH CHECK (
  (
    public.current_user_role() = 'operator'
    AND auth.uid() = operator_id
  )
  OR public.current_user_role() IN ('manager', 'admin')
);

-- IS Pro downtime records attached to hourly reports.
DROP POLICY IF EXISTS "downtime_read" ON public.downtime_events;
CREATE POLICY "downtime_read" ON public.downtime_events
FOR SELECT
USING (
  public.current_user_role() IN ('manager', 'admin', 'viewer', 'executive')
  OR (
    public.current_user_role() = 'operator'
    AND EXISTS (
      SELECT 1
      FROM public.shifts s
      WHERE s.id = downtime_events.shift_id
        AND (s.operator_1_id = auth.uid() OR s.operator_2_id = auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "downtime_write" ON public.downtime_events;
CREATE POLICY "downtime_write" ON public.downtime_events
FOR INSERT
WITH CHECK (
  public.current_user_role() = 'operator'
  AND EXISTS (
    SELECT 1
    FROM public.hourly_reports r
    JOIN public.shifts s ON s.id = r.shift_id
    WHERE r.id = downtime_events.report_id
      AND r.shift_id = downtime_events.shift_id
      AND (s.operator_1_id = auth.uid() OR s.operator_2_id = auth.uid())
  )
);

-- IS Pro failure reports.
DROP POLICY IF EXISTS "failure_photos_insert" ON storage.objects;
CREATE POLICY "failure_photos_insert" ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'failure-photos'
  AND public.current_user_role() IN ('operator', 'specialist', 'manager', 'admin')
);

DROP POLICY IF EXISTS "failure_reports_read" ON public.failure_reports;
CREATE POLICY "failure_reports_read" ON public.failure_reports
FOR SELECT
USING (
  public.current_user_role() IN ('specialist', 'manager', 'admin', 'viewer', 'executive')
  OR (
    public.current_user_role() = 'operator'
    AND auth.uid() = reporter_id
  )
);

DROP POLICY IF EXISTS "failure_reports_staff_read" ON public.failure_reports;
CREATE POLICY "failure_reports_staff_read" ON public.failure_reports
FOR SELECT
USING (
  public.current_user_role() IN ('specialist', 'manager', 'admin', 'viewer', 'executive')
);

DROP POLICY IF EXISTS "failure_reports_insert" ON public.failure_reports;
CREATE POLICY "failure_reports_insert" ON public.failure_reports
FOR INSERT
WITH CHECK (
  public.current_user_role() = 'operator'
  AND auth.uid() = reporter_id
);

DROP POLICY IF EXISTS "failure_reports_update_reporter" ON public.failure_reports;
CREATE POLICY "failure_reports_update_reporter" ON public.failure_reports
FOR UPDATE
USING (
  public.current_user_role() = 'operator'
  AND auth.uid() = reporter_id
)
WITH CHECK (
  public.current_user_role() = 'operator'
  AND auth.uid() = reporter_id
);

-- IS Pro internal quality complaints.
DROP POLICY IF EXISTS "internal_complaints_insert" ON public.internal_complaints;
CREATE POLICY "internal_complaints_insert" ON public.internal_complaints
FOR INSERT
WITH CHECK (
  public.current_user_role() IN ('operator', 'manager', 'admin')
  AND reporter_id = auth.uid()
);

DROP POLICY IF EXISTS "internal_complaints_update" ON public.internal_complaints;
CREATE POLICY "internal_complaints_update" ON public.internal_complaints
FOR UPDATE
USING (
  (
    public.current_user_role() = 'operator'
    AND reporter_id = auth.uid()
  )
  OR public.current_user_role() IN ('manager', 'admin')
)
WITH CHECK (
  (
    public.current_user_role() = 'operator'
    AND reporter_id = auth.uid()
  )
  OR public.current_user_role() IN ('manager', 'admin')
);

-- IS Pro shift-stat photos and OCR.
DROP POLICY IF EXISTS "shift_stats_photos_read" ON storage.objects;
CREATE POLICY "shift_stats_photos_read" ON storage.objects
FOR SELECT
USING (
  bucket_id = 'shift-stats-photos'
  AND public.current_user_role() IN ('operator', 'manager', 'admin')
);

DROP POLICY IF EXISTS "shift_stats_photos_insert" ON storage.objects;
CREATE POLICY "shift_stats_photos_insert" ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'shift-stats-photos'
  AND public.current_user_role() IN ('operator', 'manager', 'admin')
);

DROP POLICY IF EXISTS "shift_stat_photos_read" ON public.shift_stat_photos;
CREATE POLICY "shift_stat_photos_read" ON public.shift_stat_photos
FOR SELECT
USING (
  public.current_user_role() IN ('operator', 'manager', 'admin', 'viewer', 'executive')
);

DROP POLICY IF EXISTS "shift_stat_photos_insert" ON public.shift_stat_photos;
CREATE POLICY "shift_stat_photos_insert" ON public.shift_stat_photos
FOR INSERT
WITH CHECK (
  public.current_user_role() IN ('operator', 'manager', 'admin')
  AND operator_id = auth.uid()
);

DROP POLICY IF EXISTS "shift_stat_photos_delete" ON public.shift_stat_photos;
CREATE POLICY "shift_stat_photos_delete" ON public.shift_stat_photos
FOR DELETE
USING (
  (
    public.current_user_role() = 'operator'
    AND operator_id = auth.uid()
  )
  OR public.current_user_role() IN ('manager', 'admin')
);

DROP POLICY IF EXISTS "shift_stats_photos_delete" ON storage.objects;
CREATE POLICY "shift_stats_photos_delete" ON storage.objects
FOR DELETE
USING (
  bucket_id = 'shift-stats-photos'
  AND (
    public.current_user_role() IN ('manager', 'admin')
    OR (
      public.current_user_role() = 'operator'
      AND EXISTS (
        SELECT 1
        FROM public.shift_stat_photos p
        WHERE p.photo_path = storage.objects.name
          AND p.operator_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS "shift_stat_readings_read" ON public.shift_stat_readings;
CREATE POLICY "shift_stat_readings_read" ON public.shift_stat_readings
FOR SELECT
USING (
  public.current_user_role() IN ('operator', 'manager', 'admin', 'viewer', 'executive')
);

DROP POLICY IF EXISTS "shift_stat_readings_update" ON public.shift_stat_readings;
CREATE POLICY "shift_stat_readings_update" ON public.shift_stat_readings
FOR UPDATE
USING (
  public.current_user_role() IN ('operator', 'manager', 'admin')
);

-- TPM operator records stay out of the syringe operator role as well.
DROP POLICY IF EXISTS tpm_ih_insert ON public.tpm_issue_history;
CREATE POLICY tpm_ih_insert ON public.tpm_issue_history
FOR INSERT
WITH CHECK (
  public.current_user_role() IN ('operator', 'specialist', 'manager', 'admin')
);

DROP POLICY IF EXISTS tpm_media_read ON public.tpm_media;
CREATE POLICY tpm_media_read ON public.tpm_media
FOR SELECT
USING (
  public.current_user_role() IN ('operator', 'specialist', 'manager', 'executive', 'admin')
);

DROP POLICY IF EXISTS tpm_media_insert ON public.tpm_media;
CREATE POLICY tpm_media_insert ON public.tpm_media
FOR INSERT
WITH CHECK (
  public.current_user_role() IN ('operator', 'specialist', 'manager', 'admin')
  AND author_id = auth.uid()
);

DROP POLICY IF EXISTS tpm_media_update ON public.tpm_media;
CREATE POLICY tpm_media_update ON public.tpm_media
FOR UPDATE
USING (
  public.current_user_role() IN ('specialist', 'manager', 'admin')
  OR (
    public.current_user_role() = 'operator'
    AND author_id = auth.uid()
  )
);

NOTIFY pgrst, 'reload schema';
COMMIT;
