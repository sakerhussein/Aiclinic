-- Undoes 0013. Links already sent keep working; the queue and the "Find my booking" settings are removed.
begin;
drop function if exists public.online_link_replaced(text, text);
drop function if exists public.online_find(uuid, text, text);
drop function if exists public.online_find_available(uuid);
drop table if exists link_requests;
alter table online_booking drop column if exists find_enabled, drop column if exists find_per_phone_per_day,
  drop column if exists find_per_ip_per_hour, drop column if exists find_message_en, drop column if exists find_message_ar;
commit;
