-- "Find my booking" (design: booking/design/find-my-booking.html). A patient who lost the private link types their phone number;
-- each of that number's upcoming online bookings gets a NEW private link by WhatsApp, and the old link stops working.
-- Undo: db/rollback/0013_down.sql
--
-- - Off by default, per clinic (Settings > Online booking), and only usable once the clinic's WhatsApp number is connected.
-- - The page never says whether a number has a booking: public.online_find() returns nothing, whatever happens.
-- - The page only queues a request. The WhatsApp assistant (agent) makes the new link at the moment it sends it, so the link
--   itself is never stored; it keeps the old link's hash so a replaced link can say "replaced" instead of "not found".

alter table online_booking add column find_enabled          boolean not null default false;
alter table online_booking add column find_per_phone_per_day int not null default 3  check (find_per_phone_per_day between 1 and 20);
alter table online_booking add column find_per_ip_per_hour   int not null default 10 check (find_per_ip_per_hour between 1 and 200);
-- The text of the WhatsApp template ("booking link") as submitted to Meta. {clinic}, {when}, {doctor} and {link} are filled in.
alter table online_booking add column find_message_en text not null
  default 'Your appointment at {clinic}: {when}, {doctor}. Your new private link to see the status, change or cancel: {link}'
  check (char_length(find_message_en) <= 600);
alter table online_booking add column find_message_ar text not null
  default 'موعدك في {clinic}: {when}، {doctor}. رابطك الخاص الجديد لمعرفة حالة الحجز أو تعديله أو إلغائه: {link}'
  check (char_length(find_message_ar) <= 600);

-- The queue: one row per booking whose link is to be sent again. Only the definer functions below and the agent touch it.
create table link_requests (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics (id) on delete cascade,
  appointment_id  uuid not null references appointments (id) on delete cascade,
  phone_e164      text not null,
  ip              text,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  old_token_hash  text check (old_token_hash ~ '^[0-9a-f]{64}$'),   -- the link it replaced, so that link can say "replaced"
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index link_requests_pending on link_requests (created_at) where status = 'pending';
create index link_requests_phone on link_requests (clinic_id, phone_e164, created_at);
create index link_requests_old_hash on link_requests (old_token_hash) where old_token_hash is not null;
alter table link_requests enable row level security;      -- no policies: no login reads it directly

-- Can this clinic's page offer "Find my booking" right now?
create function public.online_find_available(p_clinic uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.online_booking o join public.clinics c on c.id = o.clinic_id
                  where o.clinic_id = p_clinic and o.enabled and o.find_enabled and c.active and c.wa_phone_number_id is not null);
$$;

-- Queue the links of a number's upcoming online bookings. Returns nothing, so the page cannot tell whether the number has any.
create function public.online_find(p_clinic uuid, p_phone text, p_ip text) returns void language plpgsql security definer set search_path = '' as $$
declare v_max int; v_used int;
begin
  if not public.online_find_available(p_clinic) then
    raise exception 'find my booking is off for this clinic' using errcode = '42501';
  end if;
  select find_per_phone_per_day into v_max from public.online_booking where clinic_id = p_clinic;
  select count(*) into v_used from public.link_requests
   where clinic_id = p_clinic and phone_e164 = p_phone and created_at > now() - interval '1 day';
  if v_used >= v_max then return; end if;
  insert into public.link_requests (clinic_id, appointment_id, phone_e164, ip)
  select p_clinic, a.id, p_phone, left(p_ip, 64)
    from public.appointments a join public.patients p on p.id = a.patient_id and p.clinic_id = a.clinic_id
   where a.clinic_id = p_clinic and p.phone_e164 = p_phone and a.source = 'web' and a.manage_token_hash is not null
     and a.status in ('booked', 'confirmed') and a.starts_at > now()
     -- not one already waiting to be sent
     and not exists (select 1 from public.link_requests r where r.appointment_id = a.id and r.status = 'pending')
   order by a.starts_at
   limit v_max - v_used;
end $$;

-- Was this link replaced by a newer one (rather than never existing)? Only for that clinic's page.
create function public.online_link_replaced(p_slug text, p_hash text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.link_requests r join public.clinics c on c.id = r.clinic_id
                  where c.slug = p_slug and r.old_token_hash = p_hash);
$$;

revoke all on function public.online_find_available(uuid), public.online_find(uuid, text, text), public.online_link_replaced(text, text) from public;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on function public.online_find_available(uuid), public.online_find(uuid, text, text), public.online_link_replaced(text, text) from %I', r);
      execute format('revoke all on table public.link_requests from %I', r);
    end if;
  end loop;
end $$;
grant execute on function public.online_find_available(uuid), public.online_find(uuid, text, text), public.online_link_replaced(text, text) to public_app;
grant execute on function public.online_find_available(uuid) to booking_app;
