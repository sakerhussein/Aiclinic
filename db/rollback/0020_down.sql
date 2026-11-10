-- Undo 0020_records.sql. Roll the code back first (Booking's visit note reads chart_entries), and stop limitsiz-records.
-- WARNING: this deletes every chart entry, detail and opening record. Export them first if any are real.
drop policy if exists booking_app_read on chart_entries;
drop table if exists record_openings, chart_answers, chart_entries, patient_details, record_settings;
drop function if exists audit.capture_chart();
drop function if exists public.chart_entries_guard();
drop function if exists public.patient_details_version();
drop trigger if exists clinics_record_defaults on clinics;
drop function if exists public.record_settings_defaults();
drop policy if exists records_app_read on clinics;
drop policy if exists records_app_read on doctors;
drop policy if exists records_app_read on services;
drop policy if exists records_app_read on patients;
drop policy if exists records_app_read on appointments;
drop policy if exists records_app_read on visit_notes;
revoke all on clinics, doctors, services, patients, appointments, visit_notes from records_app;
revoke all on schema audit from records_app;
revoke execute on function audit.set_actor(text, text, text, text, text, text, text, uuid) from records_app;
drop role if exists records_app;
delete from accounts.app_sessions where app_key = 'records';
delete from accounts.sso_codes where app_key = 'records';
delete from accounts.role_permissions where permission like 'records.%';
delete from accounts.permissions where app_key = 'records';
delete from accounts.apps where key = 'records';
