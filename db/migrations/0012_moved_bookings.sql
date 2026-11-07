-- When a booking moves to a new time. Enforced in the database, so every way of changing a booking follows it.
-- Undo: db/rollback/0012_down.sql
--
-- 1. Anyone moves it (staff, the WhatsApp assistant, the patient's private link): the reminders start again for the new time.
-- 2. The patient moves it through the private link: the clinic has not agreed to the new time yet. A confirmed booking goes
--    back to booked and is marked "Time changed by patient" (moved_online_at). The check of the person ("Mark as checked")
--    stays: the person did not change, only the time. The patient's page shows "Waiting for the clinic".
-- 3. The clinic confirms it, or moves it again itself: the mark goes away. Once confirmed the patient's page shows "Confirmed".

alter table appointments add column moved_online_at timestamptz;   -- set by the patient's move, cleared when the clinic confirms
create index appointments_moved_online on appointments (clinic_id, starts_at) where moved_online_at is not null;
grant select (moved_online_at) on appointments to public_app;

create function public.appointments_moved() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.starts_at is distinct from old.starts_at then
    new.reminder_24h_at := null;
    new.reminder_2h_at := null;
    -- Runs as the login making the change (not security definer): public_app is the online booking page.
    if current_user = 'public_app' and new.status in ('booked', 'confirmed') then
      new.status := 'booked';
      new.moved_online_at := now();
    elsif current_user <> 'public_app' then
      new.moved_online_at := null;   -- the clinic chose the time itself
    end if;
  end if;
  -- The clinic accepted the time, or the booking is no longer active: nothing is waiting for the clinic.
  if new.status is distinct from old.status and new.status not in ('booked') then
    new.moved_online_at := null;
  end if;
  return new;
end $$;
revoke all on function public.appointments_moved() from public;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on function public.appointments_moved() from %I', r);
    end if;
  end loop;
end $$;

-- Named to run before appointments_row_version (triggers of one kind run in name order), so these changes count as a new version.
create trigger appointments_moved before update on appointments
  for each row execute function public.appointments_moved();
