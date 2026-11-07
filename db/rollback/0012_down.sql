-- Undoes 0012. Bookings already moved keep their status as it is now; the "Time changed by patient" mark is removed.
begin;
drop trigger if exists appointments_moved on appointments;
drop function if exists public.appointments_moved();
drop index if exists appointments_moved_online;
alter table appointments drop column if exists moved_online_at;
commit;
