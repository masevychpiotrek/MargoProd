-- Pozwol operatorowi usunac wlasne (przypadkowe/nieudane) zdjecie statystyk
-- zmianowych, oraz managerowi/adminowi usuwac dowolne. Bez tej migracji nie
-- ma zadnej polityki DELETE, wiec zdjecia raz dodane nie mozna bylo usunac.

CREATE POLICY "shift_stat_photos_delete" ON shift_stat_photos FOR DELETE
  USING (
    operator_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
        AND is_active = true AND deleted_at IS NULL
    )
  );

CREATE POLICY "shift_stats_photos_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'shift-stats-photos'
    AND (
      EXISTS (
        SELECT 1 FROM shift_stat_photos p
        WHERE p.photo_path = storage.objects.name AND p.operator_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND role IN ('manager', 'admin')
          AND is_active = true AND deleted_at IS NULL
      )
    )
  );

GRANT DELETE ON public.shift_stat_photos TO authenticated;
