-- W EPQ is based on machine hourly capacity adjusted by accountable time.
-- target in hourly_reports stores the effective expected quantity for that report:
-- machine.target_per_hour * (runtime + ready + alarm + downtime + failure) / 60.

UPDATE public.hourly_reports hr
SET target = ROUND(
  m.target_per_hour::NUMERIC *
  GREATEST(
    hr.runtime_min +
    COALESCE(hr.ready_min, 0) +
    COALESCE(hr.alarm_min, 0) +
    hr.downtime_min +
    hr.failure_min,
    0
  )::NUMERIC / 60
)::INT
FROM public.machines m
WHERE m.id = hr.machine_id
  AND hr.deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
