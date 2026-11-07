-- When a booking moves to a new time. Enforced in the database, so every way of changing a booking follows it.
-- Undo: db/rollback/0012_down.sql
--
-- 1. Anyone moves it (staff, the WhatsApp assistant, the patient's private link): the reminders start again for the new time.
-- 2. The patient moves it through the private link: the clinic has not agreed to the new time yet, so a confirmed booking goes
--    back to booked, and where the clinic checks online bookings it is "Online, not checked" again. The patient's page then
--    shows "Waiting for the clinic" until a secretary checks or confirms it.

create function public.appointments_moved() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.starts_at is distinct from old.starts_at then
    new.reminder_24h_at := null;
    new.reminder_2h_at := null;
    -- Runs as the login making the change (not security definer): public_app is the online booking page.
    if current_user = 'public_app' and new.status in ('booked', 'confirmed') then
      new.status := 'booked';
      if exists (select 1 from public.online_booking o where o.clinic_id = new.clinic_id and o.staff_check) then
        new.needs_check := true;
        new.checked_at := null;
        new.checked_by := null;
      end if;
    end if;
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
create trigger appointments_moved before update of starts_at on appointments
  for each row execute function public.appointments_moved();
