-- W EPQ is based on machine hourly capacity adjusted by real runtime.
-- target in hourly_reports stores the effective expected quantity for that report:
-- machine.target_per_hour * runtime_min / 60.

UPDATE public.hourly_reports hr
SET target = ROUND(m.target_per_hour::NUMERIC * GREATEST(hr.runtime_min, 0)::NUMERIC / 60)::INT
FROM public.machines m
WHERE m.id = hr.machine_id
  AND hr.deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
