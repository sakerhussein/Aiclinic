-- Undoes 0011. Run as the database owner, and only before real patients book online: it removes the online fields of bookings.
-- The bookings themselves stay. The audit log is append-only, so audit entries made by "patient" stay, and the audit table keeps
-- accepting the 'patient' value for them; only new ones are refused, because audit.set_actor goes back to user, agent or system.

begin;
drop policy if exists public_app_read   on clinics;
drop policy if exists public_app_read   on doctors;
drop policy if exists public_app_read   on services;
drop policy if exists public_app_read   on doctor_services;
drop policy if exists public_app_read   on working_hours;
drop policy if exists public_app_read   on clinic_hours;
drop policy if exists public_app_read   on time_off;
drop policy if exists public_app_read   on booking_rules;
drop policy if exists public_app_read   on appointments;
drop policy if exists public_app_insert on appointments;
drop policy if exists public_app_update on appointments;

drop function if exists public.online_patient(uuid, text, text, text, boolean);
drop owned by public_app;
drop role if exists public_app;

drop trigger if exists clinics_online_booking_defaults on clinics;
drop function if exists public.online_booking_defaults();
drop table if exists online_booking;

drop index if exists appointments_unchecked;
alter table appointments drop column if exists online_from, drop column if exists booked_name, drop column if exists booked_for_other,
  drop column if exists needs_check, drop column if exists checked_at, drop column if exists checked_by, drop column if exists manage_token_hash;

create or replace function audit.set_actor(
  p_type text, p_id text, p_label text,
  p_ip text default null, p_user_agent text default null, p_request_id text default null,
  p_reason text default null, p_clinic uuid default null
) returns void language plpgsql set search_path = '' as $$
begin
  if p_type not in ('user', 'agent', 'system') then
    raise exception 'audit.set_actor: type must be user, agent or system' using errcode = '22023';
  end if;
  perform set_config('app.actor_type', p_type, true), set_config('app.actor_id', coalesce(p_id, ''), true),
          set_config('app.actor_label', coalesce(p_label, ''), true), set_config('app.ip', coalesce(p_ip, ''), true),
          set_config('app.user_agent', coalesce(p_user_agent, ''), true), set_config('app.request_id', coalesce(p_request_id, ''), true),
          set_config('app.reason', coalesce(p_reason, ''), true);
  if p_clinic is not null then
    perform audit.chain_lock(p_clinic);
  end if;
end $$;
commit;
