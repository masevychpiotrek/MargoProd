-- Allow operators to finish their own shifts.
-- Without this UPDATE policy, ended_at cannot be saved by an operator.

DROP POLICY IF EXISTS "shifts_update" ON shifts;

CREATE POLICY "shifts_update" ON shifts
FOR UPDATE
USING (
  auth.uid() = operator_1_id OR
  auth.uid() = operator_2_id OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('manager','admin')
  )
)
WITH CHECK (
  auth.uid() = operator_1_id OR
  auth.uid() = operator_2_id OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('manager','admin')
  )
);
