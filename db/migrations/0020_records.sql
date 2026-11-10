-- Records, phase A (design: booking/design/emr.html, owner's decisions 2026-11-09): the patient's chart as its own service at
-- records.limitsiz.si, signed in through Accounts. Same database as Booking, its own login (records_app), created here WITHOUT a
-- password; deploy/setup-records.sh sets it on the VPS:  alter role records_app password '…';
--
-- The chart: details (date of birth, sex, file number…), allergies, medicines, conditions, procedures, family history, and the
-- clinic's specialty fields. Nothing is ever deleted: a wrong entry is marked "entered in error" with a reason and a name.
-- Every opening of a chart is recorded, and goes into the audit trail. The audit trail never holds clinical words, only what
-- kind of entry changed and which fields (administrators read that log).
-- Booking reads only the alert line (chart_entries) for the doctor's visit note. Records reads signed visit notes' dates and
-- states, never their words (those stay in Booking, under today's rule). Undo: db/rollback/0020_down.sql

-- ---------------------------------------------------------------- the service in Accounts, and who may do what
-- No address yet: the launcher shows a service only once it has one, and deploy/setup-records.sh sets it when Records is running.
insert into accounts.apps (key, name_en, name_ar, url) values ('records', 'Records', 'السجلات الطبية', null);

insert into accounts.permissions (key, app_key, description) values
  ('records.details.view',  'records', 'See a patient''s details in Records (date of birth, file number, insurance…)'),
  ('records.details.edit',  'records', 'Change a patient''s details in Records'),
  ('records.chart.read',    'records', 'Open the chart: allergies, medicines, conditions, history'),
  ('records.chart.write',   'records', 'Add to and correct the chart'),
  ('records.settings.view', 'records', 'See Records settings'),
  ('records.settings.edit', 'records', 'Change Records settings'),
  ('records.openings.view', 'records', 'See who opened a patient''s record');
insert into accounts.role_permissions (role_key, permission) values
  ('doctor', 'records.details.view'), ('doctor', 'records.details.edit'), ('doctor', 'records.chart.read'), ('doctor', 'records.chart.write'),
  ('secretary', 'records.details.view'), ('secretary', 'records.details.edit'),
  ('clinic_admin', 'records.details.view'), ('clinic_admin', 'records.details.edit'), ('clinic_admin', 'records.settings.view'),
  ('clinic_admin', 'records.settings.edit'), ('clinic_admin', 'records.openings.view');

-- ---------------------------------------------------------------- settings (Records > Settings > Chart)
create table record_settings (
  clinic_id         uuid primary key references clinics (id) on delete cascade,
  doctors_scope     text not null default 'all' check (doctors_scope in ('all', 'treated')),   -- treated: only patients booked with them
  show_allergies    boolean not null default true,
  show_medicines    boolean not null default true,
  show_conditions   boolean not null default true,
  show_procedures   boolean not null default true,
  show_family       boolean not null default false,
  -- [{key, en, ar, kind: yesno | choice | text, options: [{en, ar}]}]: the dermatology starter set; each clinic edits its own.
  specialty_fields  jsonb not null default '[
    {"key": "skin_type", "en": "Skin type (Fitzpatrick)", "ar": "نوع البشرة (فيتزباتريك)", "kind": "choice",
     "options": [{"en": "I", "ar": "I"}, {"en": "II", "ar": "II"}, {"en": "III", "ar": "III"}, {"en": "IV", "ar": "IV"}, {"en": "V", "ar": "V"}, {"en": "VI", "ar": "VI"}]},
    {"key": "pregnant", "en": "Pregnant or breastfeeding", "ar": "حامل أو مرضعة", "kind": "yesno"},
    {"key": "keloid", "en": "Keloid scarring", "ar": "ندب جدرية", "kind": "yesno"}
  ]'::jsonb check (jsonb_typeof(specialty_fields) = 'array' and jsonb_array_length(specialty_fields) <= 30),
  file_numbers      text not null default 'auto' check (file_numbers in ('auto', 'manual')),
  next_file_no      int  not null default 1 check (next_file_no between 1 and 99999999),
  file_no_digits    int  not null default 5 check (file_no_digits between 3 and 8),
  required_details  text[] not null default '{}' check (required_details <@ array['birth_date', 'sex', 'national_id', 'emergency_contact']),
  updated_at        timestamptz not null default now()
);
insert into record_settings (clinic_id) select id from clinics;
create function public.record_settings_defaults() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.record_settings (clinic_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger clinics_record_defaults after insert on clinics for each row execute function public.record_settings_defaults();
create trigger record_settings_updated_at before update on record_settings for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- the patient's details (name, phone, language stay in Booking)
create table patient_details (
  patient_id        uuid primary key,
  clinic_id         uuid not null,
  file_no           text check (char_length(btrim(file_no)) between 1 and 20),
  birth_date        date check (birth_date between '1900-01-01' and '2100-01-01'),
  sex               text check (sex in ('female', 'male')),
  national_id       text check (char_length(national_id) <= 20),
  insurance         text check (char_length(insurance) <= 120),
  emergency_contact text check (char_length(emergency_contact) <= 120),
  updated_at        timestamptz not null default now(),
  updated_by_name   text,
  row_version       int not null default 1,
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade,
  unique (clinic_id, file_no)
);

-- ---------------------------------------------------------------- the chart's lists
create table chart_entries (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null,
  patient_id        uuid not null,
  kind              text not null check (kind in ('allergy', 'medicine', 'condition', 'procedure', 'family')),
  title             text not null check (char_length(btrim(title)) between 1 and 200),
  detail            text check (char_length(detail) <= 1000),
  status            text not null default 'active' check (status in ('active', 'past')),
  alert             boolean not null default false,          -- shown under the name on every tab (allergies always are)
  source            text not null default 'staff' check (source in ('staff', 'patient')),   -- patient: what they wrote, until confirmed
  confirmed_at      timestamptz,
  confirmed_by_name text,
  created_at        timestamptz not null default now(),
  created_by        text not null,
  created_by_name   text not null,
  updated_at        timestamptz not null default now(),
  updated_by_name   text,
  error_at          timestamptz,                              -- "entered in error": struck through, kept for ever
  error_by_name     text,
  error_reason      text check (char_length(btrim(error_reason)) between 1 and 300),
  row_version       int not null default 1,
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade,
  check ((error_at is null) = (error_reason is null))
);
create index chart_entries_patient on chart_entries (clinic_id, patient_id, kind);

-- An entry marked in error never changes again; the mark is never taken off. row_version goes up on every real change, so a save
-- based on an old copy is refused.
create function public.chart_entries_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.error_at is not null then
    raise exception 'chart entry % was entered in error and is locked', old.id using errcode = '42501';
  end if;
  if new.clinic_id is distinct from old.clinic_id or new.patient_id is distinct from old.patient_id or new.kind is distinct from old.kind
     or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by
     or new.created_by_name is distinct from old.created_by_name then
    raise exception 'chart entry %: who wrote it, when, and for whom never change', old.id using errcode = '42501';
  end if;
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end $$;
create trigger chart_entries_guard before update on chart_entries for each row execute function public.chart_entries_guard();

create function public.patient_details_version() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.clinic_id is distinct from old.clinic_id or new.patient_id is distinct from old.patient_id then
    raise exception 'patient details belong to one patient' using errcode = '42501';
  end if;
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end $$;
create trigger patient_details_version before update on patient_details for each row execute function public.patient_details_version();

-- The clinic's specialty fields (skin type, …): one answer per field.
create table chart_answers (
  patient_id        uuid not null,
  clinic_id         uuid not null,
  field_key         text not null check (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  value             text not null check (char_length(value) <= 200),
  updated_at        timestamptz not null default now(),
  updated_by_name   text not null,
  primary key (patient_id, field_key),
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade
);

-- Who opened which chart, and when ("Who opened this record"). Only ever added to.
create table record_openings (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references clinics (id) on delete cascade,
  patient_id        uuid not null,
  user_id           text not null,
  user_name         text not null,
  role              text,
  opened_at         timestamptz not null default now(),
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade
);
create index record_openings_patient on record_openings (clinic_id, patient_id, opened_at desc);

-- ---------------------------------------------------------------- the audit trail: what changed, never the clinical words
create function audit.capture_chart() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_noise text[] := array['updated_at', 'updated_by_name', 'row_version'];
  v_shown text[] := array['kind', 'status', 'alert', 'source', 'sex'];        -- safe to show; titles, details and numbers are not
  v_changed text[]; v_action text; v_before jsonb; v_after jsonb; v_entity text; v_id text;
begin
  if tg_table_name = 'record_openings' then
    perform audit.log((v_new ->> 'clinic_id')::uuid, 'chart', v_new ->> 'patient_id', 'opened', null,
                      jsonb_build_object('role', v_new ->> 'role'), null, null);
    return null;
  end if;
  v_entity := case tg_table_name when 'chart_entries' then 'chart_entry' when 'patient_details' then 'patient_details' else 'chart_answer' end;
  v_id := case tg_table_name when 'chart_entries' then v_row ->> 'id' else v_row ->> 'patient_id' end;
  if tg_op = 'INSERT' then
    v_action := 'created';
    select jsonb_object_agg(k, v_new -> k) into v_after from unnest(v_shown || array['patient_id', 'field_key']) as k where jsonb_typeof(v_new -> k) is not null and jsonb_typeof(v_new -> k) <> 'null';
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
  else
    select array_agg(k order by k) into v_changed from jsonb_object_keys(v_new) as k
     where (v_new -> k) is distinct from (v_old -> k) and not (k = any (v_noise));
    if v_changed is null then
      return null;
    end if;
    v_action := case
      when 'error_at' = any (v_changed) then 'entered_in_error'
      when 'confirmed_at' = any (v_changed) then 'confirmed'
      else 'updated' end;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k) into v_before, v_after
      from unnest(v_changed) as k where k = any (v_shown);
  end if;
  perform audit.log((v_row ->> 'clinic_id')::uuid, v_entity, v_id, v_action, v_before, v_after, v_changed,
                    case when v_action = 'entered_in_error' then 'entered in error' end);
  return null;
end $$;
create trigger audit_chart_entries after insert or update or delete on chart_entries for each row execute function audit.capture_chart();
create trigger audit_patient_details after insert or update or delete on patient_details for each row execute function audit.capture_chart();
create trigger audit_chart_answers after insert or update or delete on chart_answers for each row execute function audit.capture_chart();
create trigger audit_record_openings after insert on record_openings for each row execute function audit.capture_chart();
create trigger audit_record_settings after insert or update or delete on record_settings
  for each row execute function audit.capture('record_settings', 'updated_at,next_file_no');   -- a file number handed out is not a settings change

-- ---------------------------------------------------------------- records_app: the Records service's own login
do $$ begin
  if not exists (select from pg_roles where rolname = 'records_app') then create role records_app login; end if;
end $$;
grant usage on schema audit to records_app;
grant execute on function audit.set_actor(text, text, text, text, text, text, text, uuid) to records_app;

-- What it reads from Booking's tables: no notes' words, no conversations, no WhatsApp numbers' history.
grant select (id, slug, name_en, name_ar, timezone, default_language, active) on clinics to records_app;
grant select (id, clinic_id, name_en, name_ar, active) on doctors to records_app;
grant select (id, clinic_id, name_en, name_ar) on services to records_app;
grant select (id, clinic_id, full_name, phone_e164, preferred_language, created_at) on patients to records_app;
grant select (id, clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, status, source) on appointments to records_app;
grant select (id, clinic_id, appointment_id, patient_id, doctor_id, kind, status, ai_drafted, signed_at, signed_name, created_at) on visit_notes to records_app;
create policy records_app_read on clinics      for select to records_app using (true);
create policy records_app_read on doctors      for select to records_app using (true);
create policy records_app_read on services     for select to records_app using (true);
create policy records_app_read on patients     for select to records_app using (true);
create policy records_app_read on appointments for select to records_app using (true);
create policy records_app_read on visit_notes  for select to records_app using (true);

-- Its own tables: never DELETE (an entry is marked in error instead; openings are only ever added).
alter table record_settings enable row level security;
alter table patient_details enable row level security;
alter table chart_entries   enable row level security;
alter table chart_answers   enable row level security;
alter table record_openings enable row level security;
grant select, insert, update on record_settings, patient_details, chart_entries, chart_answers to records_app;
grant select, insert on record_openings to records_app;
create policy records_app_access on record_settings for all to records_app using (true) with check (true);
create policy records_app_access on patient_details for all to records_app using (true) with check (true);
create policy records_app_access on chart_entries   for all to records_app using (true) with check (true);
create policy records_app_access on chart_answers   for all to records_app using (true) with check (true);
create policy records_app_access on record_openings for all to records_app using (true) with check (true);

-- Booking: only the alert line, for the doctor's visit note card. Not the details, not who opened what.
grant select (id, clinic_id, patient_id, kind, title, status, alert, error_at, created_at) on chart_entries to booking_app;
create policy booking_app_read on chart_entries for select to booking_app using (true);

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on table public.record_settings, public.patient_details, public.chart_entries, public.chart_answers, public.record_openings from %I', r);
    end if;
  end loop;
end $$;
