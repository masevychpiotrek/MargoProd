-- Explicit manager/admin edit permissions for production control.
-- Run in Supabase SQL Editor if manager edits are blocked by RLS.

DROP POLICY IF EXISTS "reports_update" ON public.hourly_reports;
CREATE POLICY "reports_update" ON public.hourly_reports
  FOR UPDATE
  USING (
    auth.uid() = operator_id OR
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'admin')
        AND is_active = true
        AND deleted_at IS NULL
    )
  )
  WITH CHECK (
    auth.uid() = operator_id OR
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'admin')
        AND is_active = true
        AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "orders_update" ON public.production_orders;
CREATE POLICY "orders_update" ON public.production_orders
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'admin')
        AND is_active = true
        AND deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'admin')
        AND is_active = true
        AND deleted_at IS NULL
    )
  );

NOTIFY pgrst, 'reload schema';
