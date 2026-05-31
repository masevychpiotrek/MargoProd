-- Force users to change temporary passwords on first login or after admin reset.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ALTER COLUMN must_change_password SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.mark_password_change_required(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET must_change_password = true
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_password_change_required(UUID) TO authenticated;

DROP POLICY IF EXISTS "profiles_self_password_update" ON public.profiles;
CREATE POLICY "profiles_self_password_update" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
