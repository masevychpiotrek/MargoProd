-- Sync Supabase Auth display names from public.profiles.
-- Supabase dashboard reads display names from user metadata, while the app uses public.profiles.

UPDATE auth.users u
SET raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'full_name', trim(p.full_name),
      'name', trim(p.full_name)
    ),
    updated_at = NOW()
FROM public.profiles p
WHERE p.id = u.id
  AND p.deleted_at IS NULL
  AND trim(COALESCE(p.full_name, '')) <> '';

UPDATE auth.identities i
SET identity_data = COALESCE(i.identity_data, '{}'::jsonb)
    || jsonb_build_object(
      'full_name', trim(p.full_name),
      'name', trim(p.full_name)
    ),
    updated_at = NOW()
FROM public.profiles p
WHERE p.id = i.user_id
  AND p.deleted_at IS NULL
  AND trim(COALESCE(p.full_name, '')) <> '';
