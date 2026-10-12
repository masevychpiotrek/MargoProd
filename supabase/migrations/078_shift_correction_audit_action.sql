-- Required by correct_day_report_shift and manager shift corrections.
-- Apply and commit before calling the correction function.
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'shift_manager_correction';
