-- Undo 0023_records_phase_c.sql. Roll the code back first. Prescriptions, filled forms, courses and summaries go with their tables,
-- so take a copy first if any were made:
--   \copy (select * from prescriptions) to 'prescriptions_before_undo.csv' csv header      (and form_responses, treatment_courses)
-- Answers already confirmed into the chart stay there (they are ordinary chart entries). Consent copies stay in Documents.
drop function if exists public.records_signed_notes(uuid, uuid, int);

delete from accounts.role_permissions where permission in ('records.courses.view', 'records.courses.edit', 'records.rx.write', 'records.forms.send');
delete from accounts.permissions where key in ('records.courses.view', 'records.courses.edit', 'records.rx.write', 'records.forms.send');

alter table record_files disable trigger record_files_guard;
update record_files set source = 'upload' where source = 'form';
alter table record_files enable trigger record_files_guard;
alter table record_files drop constraint record_files_source_check, add constraint record_files_source_check check (source in ('upload', 'phone'));
alter table chart_entries drop column if exists form_response_id;
drop table if exists record_summaries;
drop table if exists form_responses;
drop table if exists form_links;
drop table if exists form_templates;
drop table if exists prescriptions;
drop table if exists treatment_courses;
drop function if exists public.form_responses_guard();
drop function if exists public.prescriptions_guard();
drop function if exists public.treatment_courses_guard();
drop function if exists audit.capture_phase_c();

revoke select (photo_areas) on record_settings from booking_app;
alter table record_settings drop column if exists courses_on, drop column if exists course_defaults, drop column if exists course_area_required, drop column if exists rx_on,
  drop column if exists rx_valid_days, drop column if exists rx_paper, drop column if exists rx_favourites, drop column if exists rx_year,
  drop column if exists rx_next, drop column if exists forms_on, drop column if exists form_link_hours, drop column if exists form_message_en,
  drop column if exists form_message_ar, drop column if exists summary_model, drop column if exists summary_daily;

revoke select (phone, address_en, address_ar) on clinics from records_app;
revoke select (title_en, title_ar, licence_no) on doctors from records_app;
alter table doctors drop column if exists licence_no;
