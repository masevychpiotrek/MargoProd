-- Read-only checks. These queries never correct/delete historical production.
SELECT operator_id, count(*) AS active_sessions, array_agg(id) AS session_ids
FROM public.sa_sessions WHERE ended_at IS NULL GROUP BY operator_id HAVING count(*) > 1;

SELECT s.id, s.session_date, s.shift_type, s.machine_id,
  s.total_good AS stored_good, e.good AS entries_good,
  s.total_reject AS stored_reject, e.reject AS entries_reject
FROM public.sa_sessions s
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(good_qty), 0) good, COALESCE(sum(reject_qty), 0) reject
  FROM public.sa_production_entries WHERE session_id = s.id AND NOT is_cancelled
) e
WHERE COALESCE(s.total_good, 0) <> e.good OR COALESCE(s.total_reject, 0) <> e.reject;

SELECT 'downtime' AS event_type, d.id, d.session_id, d.started_at, s.ended_at AS shift_ended_at
FROM public.sa_downtime_events d JOIN public.sa_sessions s ON s.id = d.session_id
WHERE d.ended_at IS NULL AND s.ended_at IS NOT NULL
UNION ALL
SELECT 'changeover', c.id, c.session_id, c.started_at, s.ended_at
FROM public.sa_changeovers c JOIN public.sa_sessions s ON s.id = c.session_id
WHERE c.ended_at IS NULL AND s.ended_at IS NOT NULL;

SELECT e.id, e.session_id, e.produced_qty, e.good_qty, e.reject_qty,
  COALESCE(sum(d.qty), 0) AS allocated_rejects
FROM public.sa_production_entries e LEFT JOIN public.sa_defect_entries d ON d.entry_id = e.id
WHERE NOT e.is_cancelled
GROUP BY e.id
HAVING e.produced_qty <> e.good_qty + e.reject_qty OR e.reject_qty <> COALESCE(sum(d.qty), 0)
  OR e.good_qty < 0 OR e.reject_qty < 0;
