-- Ensure the syringe operator role exists before admin-created accounts use it.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'syringe_operator';

NOTIFY pgrst, 'reload schema';
