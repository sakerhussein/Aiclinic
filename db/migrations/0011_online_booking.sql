-- Online booking link (plan: booking/PLAN_public_link_and_voice.md, feature 1). Additive: every clinic starts with the link OFF,
-- so nothing changes for staff or the WhatsApp assistant until an administrator turns it on.
-- Undo: db/rollback/0011_down.sql
--
-- The public page runs as its own process and database login (public_app), created here WITHOUT a password; the owner sets it
-- out of band:  alter role public_app password '…';
-- It can read what the page shows, add web bookings, and cancel or move web bookings. It cannot read patients at all: a patient
-- is found or added only through public.online_patient(), which never returns anything but an id.

-- ---------------------------------------------------------------- settings, one row per clinic (Settings > Online booking)
-- Every limit and text the page uses lives here, so each clinic can change it without a code change.
create table online_booking (
  clinic_id                    uuid primary key references clinics (id) on delete cascade,
  enabled                      boolean not null default false,
  -- Until WhatsApp proves who owns a number, a secretary checks each online booking ("Online, not checked").
  staff_check                  boolean not null default true,
  show_prices                  boolean not null default false,
  allow_any_doctor             boolean not null default true,
  allow_cancel                 boolean not null default true,
  allow_reschedule             boolean not null default true,
  allow_for_other              boolean not null default true,      -- "I'm booking for someone else" (a parent for a child)
  offer_reminders              boolean not null default true,      -- the "remind me on WhatsApp" tick box
  default_country_code         text not null default '962' check (default_country_code ~ '^[1-9][0-9]{0,3}$'),
  -- Limits. Per phone number, and per connection (IP address) on this clinic's page.
  max_unchecked_per_phone      int  not null default 1  check (max_unchecked_per_phone between 1 and 20),
  bookings_per_phone_per_day   int  not null default 2  check (bookings_per_phone_per_day between 1 and 50),
  bookings_per_ip_per_day      int  not null default 5  check (bookings_per_ip_per_day between 1 and 200),
  lookups_per_ip_per_minute    int  not null default 60 check (lookups_per_ip_per_minute between 5 and 1000),
  manage_per_ip_per_hour       int  not null default 30 check (manage_per_ip_per_hour between 5 and 1000),
  days_per_page                int  not null default 7  check (days_per_page between 1 and 31),
  -- Texts. Empty = the page's built-in wording.
  intro_en                     text check (char_length(intro_en) <= 500),
  intro_ar                     text check (char_length(intro_ar) <= 500),
  done_note_en                 text check (char_length(done_note_en) <= 500),       -- e.g. "Please arrive 10 minutes early"
  done_note_ar                 text check (char_length(done_note_ar) <= 500),
  -- What the "Send booking link" button puts in WhatsApp. {clinic} and {link} are filled in.
  share_message_en             text not null default 'Book your appointment at {clinic} here: {link}' check (char_length(share_message_en) <= 500),
  share_message_ar             text not null default 'احجز موعدك في {clinic} من هذا الرابط: {link}' check (char_length(share_message_ar) <= 500),
  -- The privacy notice patients agree to before booking.
  privacy_url                  text not null default 'https://limitsiz.si/privacy' check (privacy_url ~ '^https://' and char_length(privacy_url) <= 300),
  updated_at                   timestamptz not null default now()
);
insert into online_booking (clinic_id) select id from clinics;

create function public.online_booking_defaults() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.online_booking (clinic_id) values (new.id) on conflict do nothing;
  return null;
end $$;
create trigger clinics_online_booking_defaults after insert on clinics for each row execute function public.online_booking_defaults();
create trigger online_booking_updated_at before update on online_booking for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- the booking's online fields
alter table appointments add column online_from       text check (online_from ~ '^[a-z0-9_-]{1,20}$');   -- ?from= tag: qr, wa, flyer…
alter table appointments add column booked_name       text check (char_length(booked_name) <= 120);      -- the name typed on the page
alter table appointments add column booked_for_other  boolean not null default false;
alter table appointments add column needs_check       boolean not null default false;
alter table appointments add column checked_at        timestamptz;
alter table appointments add column checked_by        uuid references accounts.users (id);
-- The private change-or-cancel link. Only its SHA-256 is stored; the link itself is shown to the patient once.
alter table appointments add column manage_token_hash text unique check (manage_token_hash ~ '^[0-9a-f]{64}$');
create index appointments_unchecked on appointments (clinic_id, starts_at) where needs_check and checked_at is null;

-- ---------------------------------------------------------------- "patient" as a type of actor in the audit log
alter table audit.events drop constraint events_actor_type_check;
alter table audit.events add constraint events_actor_type_check check (actor_type in ('user', 'agent', 'system', 'database', 'patient'));

create or replace function audit.set_actor(
  p_type text, p_id text, p_label text,
  p_ip text default null, p_user_agent text default null, p_request_id text default null,
  p_reason text default null, p_clinic uuid default null
) returns void language plpgsql set search_path = '' as $$
begin
  if p_type not in ('user', 'agent', 'system', 'patient') then
    raise exception 'audit.set_actor: type must be user, agent, system or patient' using errcode = '22023';
  end if;
  perform set_config('app.actor_type', p_type, true), set_config('app.actor_id', coalesce(p_id, ''), true),
          set_config('app.actor_label', coalesce(p_label, ''), true), set_config('app.ip', coalesce(p_ip, ''), true),
          set_config('app.user_agent', coalesce(p_user_agent, ''), true), set_config('app.request_id', coalesce(p_request_id, ''), true),
          set_config('app.reason', coalesce(p_reason, ''), true);
  if p_clinic is not null then
    perform audit.chain_lock(p_clinic);
  end if;
end $$;

-- ---------------------------------------------------------------- finding or adding the patient, without reading patients
-- An existing number never changes the patient's record: the name typed online stays on the booking only.
create function public.online_patient(p_clinic uuid, p_phone text, p_name text, p_lang text, p_reminders boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not exists (select 1 from public.online_booking o join public.clinics c on c.id = o.clinic_id
                  where o.clinic_id = p_clinic and o.enabled and c.active) then
    raise exception 'online booking is off for this clinic' using errcode = '42501';
  end if;
  select id into v from public.patients where clinic_id = p_clinic and phone_e164 = p_phone;
  if v is null then
    insert into public.patients (clinic_id, phone_e164, full_name, preferred_language, whatsapp_reminders)
    values (p_clinic, p_phone, p_name, p_lang, coalesce(p_reminders, false))
    on conflict (clinic_id, phone_e164) do nothing returning id into v;
    if v is null then select id into v from public.patients where clinic_id = p_clinic and phone_e164 = p_phone; end if;
  end if;
  return v;
end $$;
revoke all on function public.online_patient(uuid, text, text, text, boolean) from public;
revoke all on function public.online_booking_defaults() from public;
-- Supabase gives its API roles (anon, authenticated) every new table and function in public by default. The online page never
-- goes through Supabase's API, so take those away: otherwise the publishable key could call online_patient() directly.
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on function public.online_patient(uuid, text, text, text, boolean) from %I', r);
      execute format('revoke all on function public.online_booking_defaults() from %I', r);
      execute format('revoke all on table public.online_booking from %I', r);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- public_app (the online booking page)
do $$ begin
  if not exists (select from pg_roles where rolname = 'public_app') then create role public_app login; end if;
end $$;

grant usage on schema audit to public_app;
grant execute on function audit.set_actor(text, text, text, text, text, text, text, uuid) to public_app;
grant execute on function public.online_patient(uuid, text, text, text, boolean) to public_app;

grant select (id, slug, name_en, name_ar, timezone, phone, address_en, address_ar, maps_url, default_language, slot_step_minutes, week_start, active)
  on clinics to public_app;
grant select (id, clinic_id, name_en, name_ar, title_en, title_ar, gender, active, slot_minutes, buffer_minutes) on doctors to public_app;
grant select (id, clinic_id, name_en, name_ar, description_en, description_ar, duration_minutes, price_jod, price_is_from, active, sort) on services to public_app;
grant select on doctor_services, working_hours, clinic_hours, booking_rules, online_booking to public_app;
grant select (id, clinic_id, doctor_id, starts_at, ends_at) on time_off to public_app;              -- not the reason: it can be private
grant select (id, clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, status, source, needs_check, checked_at,
              manage_token_hash, booked_name, row_version, created_at) on appointments to public_app;
grant insert (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, source, online_from, booked_name, booked_for_other,
              needs_check, manage_token_hash) on appointments to public_app;
grant update (status, cancel_reason, starts_at, ends_at) on appointments to public_app;

create policy public_app_read on clinics         for select to public_app using (active);
create policy public_app_read on doctors         for select to public_app using (active);
create policy public_app_read on services        for select to public_app using (active);
create policy public_app_read on doctor_services for select to public_app using (true);
create policy public_app_read on working_hours   for select to public_app using (true);
create policy public_app_read on clinic_hours    for select to public_app using (true);
create policy public_app_read on time_off        for select to public_app using (true);
create policy public_app_read on booking_rules   for select to public_app using (audience = 'patient');
create policy public_app_read on online_booking  for select to public_app using (true);
create policy public_app_read on appointments    for select to public_app using (true);
-- New bookings only from this page, only while the clinic has the link on. Changes only to bookings made here.
create policy public_app_insert on appointments for insert to public_app
  with check (source = 'web' and exists (select 1 from online_booking o where o.clinic_id = appointments.clinic_id and o.enabled));
create policy public_app_update on appointments for update to public_app
  using (source = 'web') with check (source = 'web' and status in ('booked', 'confirmed', 'cancelled'));

-- ---------------------------------------------------------------- Booking (staff) reads and changes the settings
alter table online_booking enable row level security;
grant select, update on online_booking to booking_app;
create policy booking_app_access on online_booking for all to booking_app using (true) with check (true);
create trigger audit_online_booking after insert or update or delete on online_booking
  for each row execute function audit.capture('online_booking', 'updated_at');
