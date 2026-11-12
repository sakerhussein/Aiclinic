-- Undo 0025_online_visits_phase2.sql. Roll the code back first (the assistant and Booking read these columns).
-- Lost on undo: which Join links went out by themselves, and when the visit link was last sent automatically.
create or replace function public.appointments_bump_version() returns trigger language plpgsql set search_path = '' as $$
declare
  v_noise text[] := array['updated_at', 'row_version', 'reminder_24h_at', 'reminder_2h_at'];
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
  for each row execute function audit.capture('appointment', 'updated_at,row_version,reminder_24h_at,reminder_2h_at');
alter table join_links drop constraint if exists join_links_auto_or_staff;
alter table join_links drop column if exists auto;
drop trigger if exists appointments_link_resend on appointments;
drop function if exists public.appointments_link_resend();
alter table appointments drop column if exists link_sent_at;
