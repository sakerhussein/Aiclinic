-- Undoes 0009 and 0008, for an emergency only. Run as the database owner, in this order, as one transaction.
-- Deploy the agent code from before 372f0bd FIRST: newer agent code cannot read a clinic without 0008.
-- This removes every clinic setting, audit anchor and checkpoint. Take a copy of them before running it.

begin;

-- ---------------------------------------------------------------- 0009
revoke execute on function audit.nightly(uuid, date) from booking_app;
drop function audit.nightly(uuid, date);
drop function audit.purge_before(uuid, timestamptz);
drop function audit.retention_cutoff(uuid);

-- The two functions as they were on the live database on 2026-11-06, before 0009.
create or replace function audit.verify(p_clinic uuid default null::uuid)
returns table(ok boolean, checked bigint, broken_seq bigint) language plpgsql security definer set search_path to '' as $function$
declare
  v_key uuid := coalesce(p_clinic, '00000000-0000-0000-0000-000000000000'::uuid);
  r audit.events; v_expect_seq bigint := 1; v_prev text := ''; v_n bigint := 0;
begin
  for r in select * from audit.events where chain_key = v_key order by seq loop
    v_n := v_n + 1;
    if r.seq <> v_expect_seq or r.prev_hash <> v_prev
       or r.hash <> audit.hash_of(audit.row_text(r.chain_key, r.seq, r.at, r.actor_type, r.actor_id, r.actor_label, r.db_role,
            r.ip, r.user_agent, r.request_id, r.entity, r.entity_id, r.action, r.before, r.after, r.changed_fields, r.reason, r.prev_hash))
    then
      return query select false, v_n, r.seq;
      return;
    end if;
    v_expect_seq := v_expect_seq + 1;
    v_prev := r.hash;
  end loop;
  return query select true, v_n, null::bigint;
end $function$;

drop table audit.anchors;
drop table audit.checkpoints;

create or replace function audit.forbid_change() returns trigger language plpgsql set search_path to '' as $function$
begin
  raise exception 'audit.events is append-only' using errcode = '42501';
end $function$;

-- ---------------------------------------------------------------- 0008
drop trigger audit_clinics         on clinics;
drop trigger audit_doctors         on doctors;
drop trigger audit_services        on services;
drop trigger audit_working_hours   on working_hours;
drop trigger audit_time_off        on time_off;
drop trigger audit_doctor_services on doctor_services;
drop trigger audit_clinic_faqs     on clinic_faqs;
drop trigger clinics_defaults      on clinics;
drop function public.clinic_defaults();

revoke select, insert, update, delete on working_hours, time_off, doctor_services, clinic_faqs from booking_app;
revoke insert, update on doctors, services from booking_app;
revoke update (name_en, name_ar, timezone, phone, address_en, address_ar, maps_url, default_language, slot_step_minutes, week_start) on clinics from booking_app;

drop table clinic_settings;
drop table booking_rules;
drop table clinic_hours;

alter table doctors drop column buffer_minutes;
alter table doctors drop column slot_minutes;
alter table clinics drop column week_start;

commit;
