-- Undoes 0012. Bookings already moved keep their status and check as they are now.
begin;
drop trigger if exists appointments_moved on appointments;
drop function if exists public.appointments_moved();
commit;
