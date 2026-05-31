-- Existing accounts created before the force-password-change column need to be flagged too.
UPDATE public.profiles
SET must_change_password = true
WHERE deleted_at IS NULL
  AND is_active = true
  AND COALESCE(must_change_password, false) = false;
