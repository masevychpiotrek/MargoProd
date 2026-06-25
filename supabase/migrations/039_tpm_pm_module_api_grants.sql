-- ============================================================
-- Margoline MES - TPM/PM API grants
-- Migration 039
-- ============================================================

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.tpm_machines TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_stations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_checkpoints TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_am_checklists TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_am_results TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_issues TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_issue_history TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_media TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.tpm_pm_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_pm_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tpm_pm_results TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_parameters TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_parts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tpm_part_usages TO authenticated;

GRANT EXECUTE ON FUNCTION public.tpm_role() TO authenticated;
