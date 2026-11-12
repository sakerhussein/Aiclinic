-- Undo 0024_online_visits.sql. Roll the code back first (Booking and the online page read these columns).
-- Lost on undo: the online-visit settings, the payment settings, the Join links, and on each booking whether it was online.
-- An online booking stays as an ordinary booking at the same time.
drop trigger if exists audit_join_links on join_links;
drop trigger if exists audit_clinic_payment on clinic_payment;
drop trigger if exists audit_online_visits on online_visits;

drop function if exists public.online_join(text, boolean, timestamptz);
drop function if exists public.online_visit_use(uuid, uuid);
drop function if exists public.online_visit_check(uuid, text);

revoke insert (visit_type, online_mode, link_channel, link_email, online_consent_at, online_consent_version) on appointments from public_app;
revoke select (visit_type, online_mode, link_channel) on appointments from public_app;
revoke select (online_allowed) on services from public_app;
revoke select (online_enabled, online_min_notice_minutes) on doctors from public_app;

drop table if exists join_links;

drop index if exists appointments_next_online;
alter table appointments drop constraint if exists appointments_online_mode;
alter table appointments
  drop column if exists next_online_used_by, drop column if exists next_online_by_name, drop column if exists next_online_at, drop column if exists next_online_by,
  drop column if exists next_online_mode, drop column if exists next_online,
  drop column if exists identity_checked_by_name, drop column if exists identity_checked_by, drop column if exists identity_checked_at,
  drop column if exists online_consent_version, drop column if exists online_consent_at,
  drop column if exists meeting_url, drop column if exists link_email, drop column if exists link_channel,
  drop column if exists online_mode, drop column if exists visit_type;

alter table patients
  drop column if exists email, drop column if exists online_mode, drop column if exists online_allowed_by_name, drop column if exists online_allowed_at,
  drop column if exists online_allowed_by, drop column if exists online_allowed;
alter table services drop column if exists online_allowed;
alter table doctors drop column if exists teams_link, drop column if exists online_min_notice_minutes, drop column if exists online_enabled;

drop trigger if exists clinics_online_visits_defaults on clinics;
drop function if exists public.online_visits_defaults();
drop table if exists clinic_payment;
drop table if exists online_visits;
