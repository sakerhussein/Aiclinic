-- Undoes 0019 (dictation). Roll the code back first: Booking from this change reads these columns.
-- Notes keep the words already dictated into them; only the settings and the count of dictations go.
begin;
drop table if exists visit_note_dictations;
alter table scribe_settings
  drop column if exists dictation_enabled,
  drop column if exists dictation_model,
  drop column if exists dictation_translate,
  drop column if exists dictation_field_seconds,
  drop column if exists dictation_note_minutes,
  drop column if exists dictations_per_doctor_per_day;
commit;
