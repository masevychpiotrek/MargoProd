-- RFID login pilot: tag identifies the account, password still authorizes access.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rfid_uid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_rfid_uid
  ON public.profiles (rfid_uid)
  WHERE rfid_uid IS NOT NULL AND deleted_at IS NULL;

UPDATE public.profiles p
SET rfid_uid = '0701967844'
FROM auth.users u
WHERE p.id = u.id
  AND lower(u.email) = 'petromasevych@margomed.com'
  AND p.deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.lookup_rfid_login(p_rfid_uid TEXT)
RETURNS TABLE(email TEXT, full_name TEXT, role public.user_role)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT lower(u.email)::TEXT, p.full_name, p.role
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE regexp_replace(coalesce(p.rfid_uid, ''), '\s', '', 'g') =
        regexp_replace(coalesce(p_rfid_uid, ''), '\s', '', 'g')
    AND p.is_active = true
    AND p.deleted_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_rfid_login(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_rfid_login(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.lookup_rfid_login(TEXT) TO authenticated;
