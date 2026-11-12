-- Online visits on Microsoft Teams, phase 1 (design: booking/design/online-visits.html, approved by the owner 2026-11-12).
-- Off for every clinic until it is switched on in Booking › Settings › Online visits; every limit and text is a setting there.
-- Phase 1 uses each doctor's own Teams link (Settings › Doctors), or a link pasted on one booking. The patient never gets the
-- Teams address in a message: every message carries a "Join the visit" link of ours (book.limitsiz.si/<clinic>/j#<token>), which
-- opens Teams only for a confirmed visit, from a few minutes before until a little after it. Only its hash is stored.
-- Two different permissions, both set by the doctor or staff:
--   patients.online_allowed: "Can book online visits", a standing mark on the patient's profile;
--   appointments.next_online: "Next follow-up can be online (this time only)", ticked on a visit, used up by the next online one.
-- Payment (Settings › Payment): CliQ for now. Limitsiz only shows where to pay; the money goes to the clinic's bank.
-- Undo: db/rollback/0024_down.sql

-- ---------------------------------------------------------------- Settings › Online visits (one row per clinic)
create table online_visits (
  clinic_id           uuid primary key references clinics (id) on delete cascade,
  enabled             boolean not null default false,
  -- Video or audio: the clinic's default. The patient's profile and the "next follow-up" tick can set their own.
  mode                text not null default 'audio' check (mode in ('video', 'audio', 'patient')),
  staff_change_mode   boolean not null default true,
  -- Who may book an online visit themselves on the page: patients marked on their profile, patients seen before, or everyone.
  -- Staff can always book one; a doctor's "next follow-up can be online" tick lets that patient book that one, whatever this says.
  who_can_book        text not null default 'marked' check (who_can_book in ('marked', 'seen_before', 'everyone')),
  link_when           text not null default 'confirmed' check (link_when in ('confirmed', 'booked')),
  join_opens_minutes  int  not null default 10 check (join_opens_minutes between 0 and 120),
  join_closes_minutes int  not null default 15 check (join_closes_minutes between 0 and 240),
  channels            text[] not null default '{whatsapp,email,print}'
                      check (channels <@ '{whatsapp,sms,email,print}'::text[] and cardinality(channels) >= 1),
  patient_picks       boolean not null default true,
  default_channel     text not null default 'whatsapp' check (default_channel in ('whatsapp', 'sms', 'email', 'print')),
  sms_sender          text check (sms_sender ~ '^[A-Za-z0-9]{3,11}$'),
  print_size          text not null default 'a6' check (print_size in ('a6', 'a5')),
  print_languages     text not null default 'patient' check (print_languages in ('patient', 'ar_en')),
  -- "Book the next visit": the quick choices, in days.
  next_visit_days     int[] not null default '{7,14,30}' check (cardinality(next_visit_days) between 1 and 6 and 1 <= all(next_visit_days) and 365 >= all(next_visit_days)),
  consent_en          text not null default 'I agree to an online visit on Microsoft Teams. It is not recorded. The doctor may ask me to come to the clinic if an online visit isn''t enough. Not for emergencies.'
                      check (char_length(btrim(consent_en)) between 1 and 1000),
  consent_ar          text not null default 'أوافق على زيارة أونلاين عبر Microsoft Teams. لا تُسجَّل الزيارة. قد يطلب الطبيب حضوري للعيادة إذا لم تكفِ الزيارة أونلاين. ليست للطوارئ.'
                      check (char_length(btrim(consent_ar)) between 1 and 1000),
  consent_version     int  not null default 1,
  how_to_en           text not null default 'On a phone: install the free Microsoft Teams app and choose “Join as a guest”. On a computer: open the link in Chrome or Edge. Type your name and wait; the doctor will let you in.'
                      check (char_length(btrim(how_to_en)) between 1 and 1000),
  how_to_ar           text not null default 'على الهاتف: نزّل تطبيق Microsoft Teams المجاني واختر «الانضمام كضيف». على الكمبيوتر: افتح الرابط في Chrome أو Edge. اكتب اسمك وانتظر، وسيُدخلك الطبيب.'
                      check (char_length(btrim(how_to_ar)) between 1 and 1000),
  message_en          text not null default '{clinic}: your online visit with {doctor} on {when}. Join: {link}'
                      check (char_length(btrim(message_en)) between 1 and 600 and position('{link}' in message_en) > 0),
  message_ar          text not null default '{clinic}: زيارتك أونلاين مع {doctor} {when}. ادخل من: {link}'
                      check (char_length(btrim(message_ar)) between 1 and 600 and position('{link}' in message_ar) > 0),
  email_subject_en    text not null default 'Your online visit link – {clinic}' check (char_length(btrim(email_subject_en)) between 1 and 200),
  email_subject_ar    text not null default 'رابط زيارتك أونلاين – {clinic}' check (char_length(btrim(email_subject_ar)) between 1 and 200),
  updated_at          timestamptz not null default now(),
  row_version         int not null default 1
);
insert into online_visits (clinic_id) select id from clinics;

-- ---------------------------------------------------------------- Settings › Payment (one row per clinic)
create table clinic_payment (
  clinic_id     uuid primary key references clinics (id) on delete cascade,
  cliq_enabled  boolean not null default false,
  cliq_alias    text check (cliq_alias ~ '^[A-Za-z0-9]{1,20}$'),           -- the CliQ name registered with the clinic's bank
  cliq_name     text check (char_length(btrim(cliq_name)) between 1 and 80), -- the name the patient should see in their bank app
  pay_when      text not null default 'before' check (pay_when in ('before', 'after')),
  for_online    boolean not null default true,                              -- online visits now; in-clinic visits pay at the desk
  note_en       text not null default 'Send {price} JOD by CliQ to {alias} ({name}) before the visit, with your name in the note.'
                check (char_length(btrim(note_en)) between 1 and 500),
  note_ar       text not null default 'حوّل {price} دينار عبر CliQ إلى {alias} ({name}) قبل الزيارة، واكتب اسمك في الملاحظة.'
                check (char_length(btrim(note_ar)) between 1 and 500),
  updated_at    timestamptz not null default now(),
  row_version   int not null default 1,
  check (not cliq_enabled or (cliq_alias is not null and cliq_name is not null))
);
insert into clinic_payment (clinic_id) select id from clinics;

create function public.online_visits_defaults() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.online_visits (clinic_id) values (new.id) on conflict do nothing;
  insert into public.clinic_payment (clinic_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger clinics_online_visits_defaults after insert on clinics for each row execute function public.online_visits_defaults();
create trigger online_visits_updated_at before update on online_visits for each row execute function public.set_updated_at();
create trigger clinic_payment_updated_at before update on clinic_payment for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- doctors, services, patients
alter table doctors add column online_enabled boolean not null default false;
-- "Earliest online booking", counted from now: patients can't book an online visit sooner; staff get a warning.
alter table doctors add column online_min_notice_minutes int not null default 60 check (online_min_notice_minutes between 0 and 10080);
alter table doctors add column teams_link text check (teams_link ~ '^https://teams\.(microsoft|live)\.com/' and char_length(teams_link) <= 2000);
alter table services add column online_allowed boolean not null default false;

alter table patients add column online_allowed    boolean not null default false;     -- "Can book online visits" (profile)
alter table patients add column online_allowed_by uuid references accounts.users (id);
alter table patients add column online_allowed_at timestamptz;
alter table patients add column online_allowed_by_name text;
alter table patients add column online_mode text check (online_mode in ('video', 'audio', 'patient'));   -- null = the clinic's default
alter table patients add column email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 120);

-- ---------------------------------------------------------------- the booking
alter table appointments add column visit_type text not null default 'in_clinic' check (visit_type in ('in_clinic', 'online'));
alter table appointments add column online_mode text check (online_mode in ('video', 'audio'));
alter table appointments add column link_channel text check (link_channel in ('whatsapp', 'sms', 'email', 'print'));
alter table appointments add column link_email text check (link_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(link_email) <= 120);
-- This booking's own Teams link (pasted by staff); otherwise the doctor's.
alter table appointments add column meeting_url text check (meeting_url ~ '^https://teams\.(microsoft|live)\.com/' and char_length(meeting_url) <= 2000);
alter table appointments add column online_consent_at timestamptz;
alter table appointments add column online_consent_version int;
alter table appointments add column identity_checked_at timestamptz;
alter table appointments add column identity_checked_by uuid references accounts.users (id);
alter table appointments add column identity_checked_by_name text;
-- "Next follow-up can be online (this time only)": set on the visit where the doctor decided it; staff can change it.
alter table appointments add column next_online boolean not null default false;
alter table appointments add column next_online_mode text check (next_online_mode in ('video', 'audio', 'patient'));
alter table appointments add column next_online_by uuid references accounts.users (id);
alter table appointments add column next_online_at timestamptz;
alter table appointments add column next_online_by_name text;
alter table appointments add column next_online_used_by uuid references appointments (id);
alter table appointments add constraint appointments_online_mode check ((visit_type = 'online') = (online_mode is not null));
create index appointments_next_online on appointments (patient_id) where next_online and next_online_used_by is null;

-- ---------------------------------------------------------------- "Join the visit" links: one per send
create table join_links (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics (id) on delete cascade,
  appointment_id  uuid not null references appointments (id) on delete cascade,
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  channel         text not null check (channel in ('whatsapp', 'sms', 'email', 'print', 'copy')),
  sent_to         text check (char_length(sent_to) <= 120),          -- the email address, for "sent to"
  sent_at         timestamptz not null default now(),
  sent_by         uuid references accounts.users (id),
  sent_by_name    text,
  first_opened_at timestamptz,
  last_opened_at  timestamptz,
  opens           int not null default 0,
  stopped_at      timestamptz
);
create index on join_links (appointment_id);

-- ---------------------------------------------------------------- what the patient page may learn, without reading patients
-- Whether this number may book an online visit itself, and how (video / audio / patient chooses). The same "no" for an unknown
-- number and a known one that is not allowed, so the page cannot tell them apart.
create function public.online_visit_check(p_clinic uuid, p_phone text)
returns table (allowed boolean, mode text, next_from uuid) language plpgsql stable security definer set search_path = '' as $$
declare v_pat public.patients; v_set public.online_visits; v_next public.appointments;
begin
  select * into v_set from public.online_visits where clinic_id = p_clinic;
  if v_set is null or not v_set.enabled then return query select false, null::text, null::uuid; return; end if;
  select * into v_pat from public.patients where clinic_id = p_clinic and phone_e164 = p_phone;
  if v_pat.id is not null then
    select * into v_next from public.appointments a where a.clinic_id = p_clinic and a.patient_id = v_pat.id
       and a.next_online and a.next_online_used_by is null and a.status <> 'voided' order by a.next_online_at desc nulls last limit 1;
  end if;
  return query select
    v_next.id is not null
      or v_set.who_can_book = 'everyone'
      or (v_set.who_can_book = 'marked' and coalesce(v_pat.online_allowed, false))
      or (v_set.who_can_book = 'seen_before' and v_pat.id is not null and exists (
            select 1 from public.appointments a where a.clinic_id = p_clinic and a.patient_id = v_pat.id and a.status = 'completed')),
    coalesce(v_next.next_online_mode, v_pat.online_mode, v_set.mode),
    v_next.id;
end $$;

-- The one-time tick is used up by the online booking that it allowed.
create function public.online_visit_use(p_from uuid, p_new uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.appointments a set next_online_used_by = p_new
   where a.id = p_from and a.next_online and a.next_online_used_by is null
     and exists (select 1 from public.appointments n where n.id = p_new and n.patient_id = a.patient_id and n.visit_type = 'online');
end $$;

-- The way into Teams, from the private link (manage token) or a Join link: only for an online visit that is confirmed (or booked,
-- when the clinic sends the link right away), and the address only inside the joining window. Opening a Join link is counted.
-- p_now: the server's clock (the same clock as every other rule of the page).
create function public.online_join(p_hash text, p_count boolean default false, p_now timestamptz default now())
returns table (appointment_id uuid, clinic_id uuid, state text, opens_at timestamptz, closes_at timestamptz, url text)
language plpgsql security definer set search_path = '' as $$
declare v_link public.join_links; v_a public.appointments; v_set public.online_visits; v_url text; v_open timestamptz; v_close timestamptz; v_state text;
begin
  select * into v_link from public.join_links where token_hash = p_hash;
  if v_link.id is not null then
    if v_link.stopped_at is not null then return; end if;
    select * into v_a from public.appointments where id = v_link.appointment_id;
  else
    select * into v_a from public.appointments where manage_token_hash = p_hash;
  end if;
  if v_a.id is null or v_a.visit_type <> 'online' then return; end if;
  select * into v_set from public.online_visits o where o.clinic_id = v_a.clinic_id;
  v_open := v_a.starts_at - make_interval(mins => v_set.join_opens_minutes);
  v_close := v_a.ends_at + make_interval(mins => v_set.join_closes_minutes);
  v_state := case
    when v_a.status not in ('booked', 'confirmed') then 'not_active'
    when not v_set.enabled then 'off'
    when v_set.link_when = 'confirmed' and v_a.status <> 'confirmed' then 'waiting'
    when p_now < v_open then 'early'
    when p_now > v_close then 'over'
    else 'open' end;
  if v_state = 'open' then
    v_url := coalesce(v_a.meeting_url, (select d.teams_link from public.doctors d where d.id = v_a.doctor_id));
    if v_url is null then v_state := 'no_link'; end if;
  end if;
  if p_count and v_link.id is not null then
    update public.join_links set opens = opens + 1, first_opened_at = coalesce(first_opened_at, now()), last_opened_at = now() where id = v_link.id;
  end if;
  return query select v_a.id, v_a.clinic_id, v_state, v_open, v_close, v_url;
end $$;

revoke all on function public.online_visit_check(uuid, text) from public;
revoke all on function public.online_visit_use(uuid, uuid) from public;
revoke all on function public.online_join(text, boolean, timestamptz) from public;
revoke all on function public.online_visits_defaults() from public;
-- Supabase gives its API roles every new table and function in public by default; nothing here goes through that API.
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on function public.online_visit_check(uuid, text) from %I', r);
      execute format('revoke all on function public.online_visit_use(uuid, uuid) from %I', r);
      execute format('revoke all on function public.online_join(text, boolean, timestamptz) from %I', r);
      execute format('revoke all on function public.online_visits_defaults() from %I', r);
      execute format('revoke all on table public.online_visits from %I', r);
      execute format('revoke all on table public.clinic_payment from %I', r);
      execute format('revoke all on table public.join_links from %I', r);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- Booking (staff)
alter table online_visits enable row level security;
alter table clinic_payment enable row level security;
alter table join_links enable row level security;
grant select, update on online_visits, clinic_payment to booking_app;
grant select, insert, update on join_links to booking_app;
create policy booking_app_access on online_visits  for all to booking_app using (true) with check (true);
create policy booking_app_access on clinic_payment for all to booking_app using (true) with check (true);
create policy booking_app_access on join_links     for all to booking_app using (true) with check (true);

-- ---------------------------------------------------------------- the online booking page (public_app)
grant execute on function public.online_visit_check(uuid, text), public.online_visit_use(uuid, uuid), public.online_join(text, boolean, timestamptz) to public_app;
grant select on online_visits, clinic_payment to public_app;
create policy public_app_read on online_visits  for select to public_app using (true);
create policy public_app_read on clinic_payment for select to public_app using (true);
grant select (online_enabled, online_min_notice_minutes) on doctors to public_app;      -- never teams_link: online_join() hands it out
grant select (online_allowed) on services to public_app;
grant select (visit_type, online_mode, link_channel) on appointments to public_app;
grant insert (visit_type, online_mode, link_channel, link_email, online_consent_at, online_consent_version) on appointments to public_app;

-- ---------------------------------------------------------------- the audit trail
create trigger audit_online_visits  after insert or update or delete on online_visits  for each row execute function audit.capture('online_visits', 'updated_at,row_version');
create trigger audit_clinic_payment after insert or update or delete on clinic_payment for each row execute function audit.capture('clinic_payment', 'updated_at,row_version');
-- Sends are recorded with who, when and how, never the token. Opening counts are noise.
create trigger audit_join_links after insert or update on join_links for each row execute function audit.capture('join_link', 'first_opened_at,last_opened_at,opens,token_hash');
