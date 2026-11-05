-- Clinic settings (design: booking/DESIGN.md §5, §6). Additive: today's values are copied in, so nothing changes for the running
-- WhatsApp assistant until a clinic changes a setting. Closures and leave stay in time_off (doctor_id null = closure, reason = name).

alter table clinics add column week_start smallint not null default 6 check (week_start between 0 and 6);   -- 6 = Saturday

alter table doctors add column slot_minutes   int check (slot_minutes in (5, 10, 15, 20, 30, 60));          -- null = the clinic's interval
alter table doctors add column buffer_minutes int not null default 0 check (buffer_minutes in (0, 5, 10, 15));

-- The clinic's opening hours. No rows at all = not set: the doctors' own hours apply alone.
create table clinic_hours (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics (id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time   time not null,
  check (end_time > start_time),
  exclude using gist (clinic_id with =, weekday with =, tsrange('2000-01-01'::date + start_time, '2000-01-01'::date + end_time) with &&)
);

create table booking_rules (
  clinic_id             uuid not null references clinics (id) on delete cascade,
  audience              text not null check (audience in ('patient', 'staff')),
  min_notice_minutes    int  not null default 0 check (min_notice_minutes >= 0),
  window_days           int  not null check (window_days between 1 and 730),
  change_notice_minutes int  not null default 0 check (change_notice_minutes >= 0),
  max_upcoming          int  check (max_upcoming > 0),                                  -- null = no limit
  -- Staff only (the assistant never books outside the free times).
  outside_hours         text not null default 'warn' check (outside_hours in ('block', 'warn', 'allow')),
  walkin_back_minutes   int  not null default 120 check (walkin_back_minutes >= 0),
  require_cancel_reason boolean not null default true,
  primary key (clinic_id, audience)
);

create table clinic_settings (
  clinic_id               uuid primary key references clinics (id) on delete cascade,
  idle_timeout_minutes    int  not null default 60 check (idle_timeout_minutes between 5 and 720),
  lock_after_minutes      int  not null default 10 check (lock_after_minutes between 0 and 120),      -- 0 = off
  require_2fa_all         boolean not null default false,
  conversation_visibility text not null default 'handoff' check (conversation_visibility in ('none', 'handoff', 'all')),
  audit_retention_months  int  check (audit_retention_months >= 12),                                  -- null = keep for ever
  reminders_enabled       boolean not null default true,
  -- Minutes before the appointment; at most two reminders.
  reminder_offsets_minutes int[] not null default '{1440,120}' check (cardinality(reminder_offsets_minutes) <= 2),
  quiet_start             time not null default '21:00',
  quiet_end               time not null default '08:00',
  assistant_enabled       boolean not null default true,
  after_hours_message_en  text check (char_length(after_hours_message_en) <= 500),
  after_hours_message_ar  text check (char_length(after_hours_message_ar) <= 500),
  handoff_alert_emails    text[] not null default '{}'
);

-- ---------------------------------------------------------------- every clinic has its rules and settings

create function public.clinic_defaults() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.booking_rules (clinic_id, audience, min_notice_minutes, window_days, change_notice_minutes, max_upcoming)
  values (new.id, 'patient', new.min_notice_minutes, new.booking_window_days, new.cancel_notice_minutes, 3),
         (new.id, 'staff', 0, 365, 0, null);
  insert into public.clinic_settings (clinic_id, handoff_alert_emails)
  values (new.id, case when new.staff_alert_email is null then '{}'::text[] else array[new.staff_alert_email] end);
  return null;
end $$;
create trigger clinics_defaults after insert on clinics for each row execute function public.clinic_defaults();

-- Existing clinics: the patient rules are today's values (the fixed limit of 3 upcoming included).
insert into booking_rules (clinic_id, audience, min_notice_minutes, window_days, change_notice_minutes, max_upcoming)
  select id, 'patient', min_notice_minutes, booking_window_days, cancel_notice_minutes, 3 from clinics;
insert into booking_rules (clinic_id, audience, min_notice_minutes, window_days, change_notice_minutes, max_upcoming)
  select id, 'staff', 0, 365, 0, null from clinics;
insert into clinic_settings (clinic_id, handoff_alert_emails)
  select id, case when staff_alert_email is null then '{}'::text[] else array[staff_alert_email] end from clinics;

-- ---------------------------------------------------------------- privileges

alter table clinic_hours    enable row level security;
alter table booking_rules   enable row level security;
alter table clinic_settings enable row level security;

grant select, insert, update, delete on clinic_hours, working_hours, time_off, doctor_services, clinic_faqs to booking_app;
grant insert, update on doctors, services to booking_app;
grant select, update on booking_rules, clinic_settings to booking_app;
grant update (name_en, name_ar, timezone, phone, address_en, address_ar, maps_url, default_language, slot_step_minutes, week_start)
  on clinics to booking_app;

create policy booking_app_access on clinic_hours    for all to booking_app using (true) with check (true);
create policy booking_app_access on booking_rules   for all to booking_app using (true) with check (true);
create policy booking_app_access on clinic_settings for all to booking_app using (true) with check (true);

-- Accounts needs only the session limits.
grant select (clinic_id, idle_timeout_minutes, lock_after_minutes, require_2fa_all) on clinic_settings to accounts_app;
create policy accounts_app_read on clinic_settings for select to accounts_app using (true);

-- ---------------------------------------------------------------- every change is audited, before and after

create trigger audit_clinics         after insert or update or delete on clinics         for each row execute function audit.capture('clinic', '', 'id');
create trigger audit_doctors         after insert or update or delete on doctors         for each row execute function audit.capture('doctor', '');
create trigger audit_services        after insert or update or delete on services        for each row execute function audit.capture('service', '');
create trigger audit_clinic_hours    after insert or update or delete on clinic_hours    for each row execute function audit.capture('clinic_hours', '');
create trigger audit_working_hours   after insert or update or delete on working_hours   for each row execute function audit.capture('doctor_hours', '');
create trigger audit_time_off        after insert or update or delete on time_off        for each row execute function audit.capture('time_off', '');
create trigger audit_doctor_services after insert or update or delete on doctor_services for each row execute function audit.capture('doctor_service', '');
create trigger audit_booking_rules   after insert or update or delete on booking_rules   for each row execute function audit.capture('booking_rules', '');
create trigger audit_clinic_settings after insert or update or delete on clinic_settings for each row execute function audit.capture('clinic_settings', '');
create trigger audit_clinic_faqs     after insert or update or delete on clinic_faqs     for each row execute function audit.capture('clinic_faq', '');
