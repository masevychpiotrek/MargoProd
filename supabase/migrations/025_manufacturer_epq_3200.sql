-- W EPQ / WEPQ TOTAL base: manufacturer optimal capacity.
-- One hourly production entry is compared to 3200 szt/h.

ALTER TABLE public.machines
  ALTER COLUMN target_per_hour SET DEFAULT 3200;

ALTER TABLE public.production_targets
  ALTER COLUMN target_per_hour SET DEFAULT 3200;

ALTER TABLE public.hourly_reports
  ALTER COLUMN target SET DEFAULT 3200;

UPDATE public.machines
SET target_per_hour = 3200,
    updated_at = NOW()
WHERE deleted_at IS NULL;

UPDATE public.production_targets
SET target_per_hour = 3200
WHERE target_per_hour IS DISTINCT FROM 3200;

UPDATE public.hourly_reports
SET target = 3200
WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
