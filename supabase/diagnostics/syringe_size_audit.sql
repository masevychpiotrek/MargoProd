-- Read-only audit AFTER migration 069. Run with an authorized database role.
-- No automatic corrections: historical mismatches require business review.
WITH links AS (
  SELECT 'session' source, id, machine_id, assortment_id FROM public.sa_sessions
  UNION ALL SELECT 'entry', id, machine_id, assortment_id FROM public.sa_production_entries
  UNION ALL SELECT 'changeover_from', id, machine_id, from_assortment_id FROM public.sa_changeovers
  UNION ALL SELECT 'changeover_to', id, machine_id, to_assortment_id FROM public.sa_changeovers
  UNION ALL SELECT 'order', id, machine_id, assortment_id FROM public.sa_orders WHERE machine_id IS NOT NULL
)
SELECT l.source, l.id, m.name line, m.volume_ml line_ml, a.name assortment, a.volume_ml assortment_ml
FROM links l LEFT JOIN public.sa_machines m ON m.id = l.machine_id
LEFT JOIN public.sa_assortments a ON a.id = l.assortment_id
WHERE m.volume_ml IS NULL OR a.volume_ml IS NULL OR m.volume_ml <> a.volume_ml;

SELECT id, code, name FROM public.sa_machines
WHERE is_active AND deleted_at IS NULL AND volume_ml IS NULL;

SELECT id, code, name, volume_ml, variant FROM public.sa_assortments
WHERE is_active AND (volume_ml IS NULL OR volume_ml <= 0 OR variant IS NULL);
