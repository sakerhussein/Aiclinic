-- Online visits, phase 2 (design: booking/design/online-visits.html, section D): the assistants book online visits, and the
-- "Join the visit" link goes out by itself on WhatsApp (the "visit link" message) and again in the online-visit reminder.
-- Only adds; the phase 1 code keeps working with it.
-- Undo: db/rollback/0025_down.sql

-- When the visit link went out by itself for this booking's time (WhatsApp from the assistant's number, or email when the clinic
-- confirmed). Cleared when the time or the doctor changes, so the patient is told again once the clinic confirms the new time.
alter table appointments add column link_sent_at timestamptz;

create function public.appointments_link_resend() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.starts_at is distinct from old.starts_at or new.doctor_id is distinct from old.doctor_id then new.link_sent_at := null; end if;
  return new;
end $$;
create trigger appointments_link_resend before update of starts_at, doctor_id on appointments
  for each row execute function public.appointments_link_resend();
revoke all on function public.appointments_link_resend() from public;

-- Like reminder bookkeeping, the mark is not a change to the booking: staff with the booking open can still save it, and the
-- audit trail records the Join link itself (join_links) instead.
create or replace function public.appointments_bump_version() returns trigger language plpgsql set search_path = '' as $$
declare
  v_noise text[] := array['updated_at', 'row_version', 'reminder_24h_at', 'reminder_2h_at', 'link_sent_at'];
begin
  if (to_jsonb(new) - v_noise) is distinct from (to_jsonb(old) - v_noise) then
    new.row_version := old.row_version + 1;
  else
    new.row_version := old.row_version;
  end if;
  return new;
end $$;
drop trigger audit_appointments on public.appointments;
create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function audit.capture('appointment', 'updated_at,row_version,reminder_24h_at,reminder_2h_at,link_sent_at');

-- A Join link that went out by itself: 'confirmed' (the visit-link message) or 'reminder' (inside a reminder). Null: sent by staff.
alter table join_links add column auto text check (auto in ('confirmed', 'reminder'));
alter table join_links add constraint join_links_auto_or_staff check (auto is null or sent_by is null);

-- Bookings whose link phase 1 already emailed on confirmation keep it as sent.
update appointments a set link_sent_at = j.first_sent
  from (select appointment_id, min(sent_at) as first_sent from join_links where channel = 'email' and stopped_at is null group by appointment_id) j
 where j.appointment_id = a.id and a.visit_type = 'online' and a.status = 'confirmed' and a.link_channel = 'email';

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on function public.appointments_link_resend() from %I', r);
    end if;
  end loop;
end $$;
