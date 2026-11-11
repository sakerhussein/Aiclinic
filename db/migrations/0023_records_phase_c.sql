-- Records, phase C (design: booking/design/records-phase-c.html, approved by the owner 2026-11-10): treatment courses, printed
-- prescriptions, forms the patient fills before the visit, and an AI summary before the visit. Every part is off until the clinic
-- switches it on in Records › Settings › Before and after the visit, and every number is a setting there.
-- Nothing is deleted: a course is ended, a prescription or a form answer is marked in error or set aside. Patient answers are never
-- added to the chart by themselves: the lists get them as "patient-reported" until a doctor confirms each one.
-- The audit trail records kinds and actions, never medicine names, answers or summaries. Undo: db/rollback/0023_down.sql

-- ---------------------------------------------------------------- Booking: the doctor's licence number (Booking › Settings › Doctors)
alter table doctors add column licence_no text check (char_length(btrim(licence_no)) between 1 and 40);
grant select (title_en, title_ar, licence_no) on doctors to records_app;
grant select (phone, address_en, address_ar) on clinics to records_app;

-- ---------------------------------------------------------------- settings (Records › Settings › Before and after the visit)
alter table record_settings
  add column courses_on      boolean not null default false,
  -- [{serviceId, sessions, weeks}]: the usual course for a service; the doctor can change it for one patient.
  add column course_defaults jsonb not null default '[]'::jsonb check (jsonb_typeof(course_defaults) = 'array' and jsonb_array_length(course_defaults) <= 100),
  -- A course names the body areas it treats (the clinic's list in Settings › Photos and documents), for reports by area later.
  add column course_area_required boolean not null default true,
  add column rx_on           boolean not null default false,
  add column rx_valid_days   int  not null default 30 check (rx_valid_days between 1 and 365),
  add column rx_paper        text not null default 'A5' check (rx_paper in ('A5', 'A4')),
  -- [{name, how, days, qty}]: common medicines with their usual directions, one tap to add.
  add column rx_favourites   jsonb not null default '[]'::jsonb check (jsonb_typeof(rx_favourites) = 'array' and jsonb_array_length(rx_favourites) <= 60),
  add column rx_year         int,
  add column rx_next         int  not null default 1 check (rx_next between 1 and 99999999),
  add column forms_on        boolean not null default false,
  add column form_link_hours int  not null default 24 check (form_link_hours between 1 and 168),
  add column form_message_en text not null default '{clinic}: before your visit on {date}, please fill in these short forms (about {minutes} minutes): {link}'
    check (char_length(form_message_en) between 1 and 400),
  add column form_message_ar text not null default '{clinic}: قبل زيارتك يوم {date}، يرجى تعبئة هذه النماذج القصيرة (نحو {minutes} دقائق): {link}'
    check (char_length(form_message_ar) between 1 and 400),
  add column summary_model   text not null default 'off' check (summary_model in ('off', 'claude-haiku-5-5', 'claude-sonnet-5-5')),
  add column summary_daily   int  not null default 20 check (summary_daily between 1 and 200);

-- ---------------------------------------------------------------- treatment courses
-- A session counts when a booking for the service is completed in Booking, on or after the day the course starts; nothing is typed
-- twice. A course is ended (early, with a reason), never deleted.
create table treatment_courses (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null,
  patient_id        uuid not null,
  service_id        uuid not null,
  sessions          int  not null check (sessions between 1 and 50),
  every_weeks       int  not null check (every_weeks between 0 and 52),
  areas             text[] not null default '{}' check (cardinality(areas) <= 20),   -- keys from record_settings.photo_areas
  note              text check (char_length(btrim(note)) between 1 and 120),
  starts_on         date not null,
  created_at        timestamptz not null default now(),
  created_by        text not null,
  created_by_name   text not null,
  ended_at          timestamptz,
  ended_by_name     text,
  end_reason        text check (char_length(btrim(end_reason)) between 1 and 300),
  updated_at        timestamptz not null default now(),
  updated_by_name   text,
  row_version       int not null default 1,
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade,
  foreign key (clinic_id, service_id) references services (clinic_id, id),
  check ((ended_at is null) = (end_reason is null))
);
create index treatment_courses_patient on treatment_courses (clinic_id, patient_id, service_id, starts_on);

create function public.treatment_courses_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.ended_at is not null then
    raise exception 'treatment course % has ended and is locked', old.id using errcode = '42501';
  end if;
  if new.clinic_id is distinct from old.clinic_id or new.patient_id is distinct from old.patient_id or new.service_id is distinct from old.service_id
     or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by or new.created_by_name is distinct from old.created_by_name then
    raise exception 'treatment course %: what it is for, who started it and for whom never change', old.id using errcode = '42501';
  end if;
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end $$;
create trigger treatment_courses_guard before update on treatment_courses for each row execute function public.treatment_courses_guard();

-- ---------------------------------------------------------------- prescriptions: written, checked, printed (print only for now)
create table prescriptions (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null,
  patient_id        uuid not null,
  doctor_id         uuid not null,
  appointment_id    uuid references appointments (id),
  items             jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),   -- [{name, how, days, qty}]
  language          text not null default 'en' check (language in ('en', 'ar')),
  valid_days        int  not null check (valid_days between 1 and 365),
  status            text not null default 'draft' check (status in ('draft', 'printed')),
  rx_no             text check (rx_no ~ '^\d{4}-\d{5,8}$'),
  printed_at        timestamptz,
  printed           jsonb,                     -- what was on the paper (clinic, doctor and licence, patient, allergies), kept for copies
  print_count       int  not null default 0,
  created_at        timestamptz not null default now(),
  created_by        text not null,
  created_by_name   text not null,
  updated_at        timestamptz not null default now(),
  updated_by_name   text,
  error_at          timestamptz,
  error_by_name     text,
  error_reason      text check (char_length(btrim(error_reason)) between 1 and 300),
  row_version       int not null default 1,
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade,
  foreign key (clinic_id, doctor_id) references doctors (clinic_id, id),
  unique (clinic_id, rx_no),
  check ((status = 'printed') = (rx_no is not null and printed_at is not null and printed is not null)),
  check ((error_at is null) = (error_reason is null))
);
create index prescriptions_patient on prescriptions (clinic_id, patient_id, created_at desc);

-- Printed: locked (printing again only counts the copies). Marked in error: locked for good.
create function public.prescriptions_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.clinic_id is distinct from old.clinic_id or new.patient_id is distinct from old.patient_id or new.doctor_id is distinct from old.doctor_id
     or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by or new.created_by_name is distinct from old.created_by_name then
    raise exception 'prescription %: who wrote it and for whom never change', old.id using errcode = '42501';
  end if;
  if old.error_at is not null then
    raise exception 'prescription % was entered in error and is locked', old.id using errcode = '42501';
  end if;
  if old.status = 'printed' and (new.status is distinct from old.status or new.items is distinct from old.items or new.language is distinct from old.language
     or new.valid_days is distinct from old.valid_days or new.rx_no is distinct from old.rx_no or new.printed_at is distinct from old.printed_at
     or new.printed is distinct from old.printed or new.appointment_id is distinct from old.appointment_id) then
    raise exception 'prescription % was printed and is locked', old.id using errcode = '42501';
  end if;
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end $$;
create trigger prescriptions_guard before update on prescriptions for each row execute function public.prescriptions_guard();

-- ---------------------------------------------------------------- forms before the visit
-- The clinic's forms. questions: [{key, en, ar, kind: yesno | yesno_details | choice | text | date, options: [{en, ar}], required,
-- goesTo: null | allergy | medicine | condition | field:<specialty key>}]. A consent has a statement and a signature; changing a
-- form makes a new version, and every filled form keeps a copy of the version it was filled on. Hidden, never deleted.
create table form_templates (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references clinics (id) on delete cascade,
  title_en          text not null check (char_length(btrim(title_en)) between 1 and 80),
  title_ar          text not null check (char_length(btrim(title_ar)) between 1 and 80),
  questions         jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 40),
  consent           boolean not null default false,
  agree_en          text check (char_length(agree_en) <= 1000),
  agree_ar          text check (char_length(agree_ar) <= 1000),
  first_visit_only  boolean not null default false,
  service_ids       uuid[] not null default '{}',            -- empty: any service
  minutes           int  not null default 2 check (minutes between 1 and 30),
  version           int  not null default 1,
  hidden            boolean not null default false,
  sort              int  not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by_name   text,
  row_version       int not null default 1,
  check (not consent or (agree_en is not null and agree_ar is not null))
);
create index form_templates_clinic on form_templates (clinic_id, sort);
create trigger form_templates_updated_at before update on form_templates for each row execute function public.set_updated_at();

-- The private link for one booking: only its hash is kept; sending it again makes a new one (the old stops working).
create table form_links (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references clinics (id) on delete cascade,
  appointment_id    uuid not null unique references appointments (id) on delete cascade,
  patient_id        uuid not null,
  token_hash        text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  language          text not null check (language in ('en', 'ar')),
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now(),
  created_by_name   text not null,
  sent_count        int  not null default 1,
  opened_at         timestamptz,
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade
);

-- What the patient sent: a copy of the form as it was (version, questions) and the answers. Never changed afterwards, except the
-- doctor's going through it (pending: the answers still to confirm or set aside).
create table form_responses (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null,
  patient_id        uuid not null,
  appointment_id    uuid not null references appointments (id) on delete cascade,
  template_id       uuid not null references form_templates (id),
  version           int  not null,
  title_en          text not null,
  title_ar          text not null,
  questions         jsonb not null,
  answers           jsonb not null,                -- {question key: {value, details}}
  consent           boolean not null default false,
  agree_text        text,
  signature         text check (char_length(signature) <= 200000),   -- the signature as a PNG data address
  signed_name       text check (char_length(btrim(signed_name)) between 1 and 120),
  language          text not null check (language in ('en', 'ar')),
  submitted_at      timestamptz not null default now(),
  copy_file_id      uuid references record_files (id),                  -- the locked copy in Documents (kind "Consent form")
  pending           jsonb not null default '[]'::jsonb,                 -- [question key]: still to confirm
  reviewed_at       timestamptz,
  reviewed_by_name  text,
  updated_at        timestamptz not null default now(),
  row_version       int not null default 1,
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade,
  unique (appointment_id, template_id)
);
create index form_responses_patient on form_responses (clinic_id, patient_id, submitted_at desc);
-- A list answer (allergy, medicine, condition) goes on the chart as "patient-reported", pointing back at the form it came from.
alter table chart_entries add column form_response_id uuid references form_responses (id);
-- A signed consent's locked copy is a document added by the form.
alter table record_files drop constraint record_files_source_check, add constraint record_files_source_check check (source in ('upload', 'phone', 'form'));

create function public.form_responses_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'pending' - 'reviewed_at' - 'reviewed_by_name' - 'copy_file_id' - 'updated_at' - 'row_version')
     is distinct from (to_jsonb(old) - 'pending' - 'reviewed_at' - 'reviewed_by_name' - 'copy_file_id' - 'updated_at' - 'row_version') then
    raise exception 'form response %: what the patient sent never changes', old.id using errcode = '42501';
  end if;
  if old.copy_file_id is not null and new.copy_file_id is distinct from old.copy_file_id then
    raise exception 'form response %: its copy never changes', old.id using errcode = '42501';
  end if;
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end $$;
create trigger form_responses_guard before update on form_responses for each row execute function public.form_responses_guard();

-- ---------------------------------------------------------------- the AI summary before the visit
create table record_summaries (
  id                uuid primary key default gen_random_uuid(),
  seq               bigint generated always as identity,          -- the newest is the last made, even within the same moment
  clinic_id         uuid not null,
  patient_id        uuid not null,
  made_at           timestamptz not null default now(),
  made_by           text not null,
  made_by_name      text not null,
  model             text not null,
  language          text not null check (language in ('en', 'ar')),
  lines             jsonb not null check (jsonb_typeof(lines) = 'array'),   -- [{text, source: {kind: note | result | chart, id, at}}]
  basis             jsonb not null,                                        -- how many notes, results and chart entries it read
  basis_at          timestamptz,                                           -- the newest signed note it read
  input_tokens      int,
  output_tokens     int,
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade
);
create index record_summaries_patient on record_summaries (clinic_id, patient_id, made_at desc);
create index record_summaries_maker on record_summaries (clinic_id, made_by, made_at);

-- Records may read the words of SIGNED visit notes only (for the summary), through this function; drafts stay in Booking.
create function public.records_signed_notes(p_clinic uuid, p_patient uuid, p_limit int)
returns table (id uuid, appointment_id uuid, doctor_id uuid, language text, sections jsonb, content jsonb, signed_at timestamptz, additions jsonb)
language sql stable security definer set search_path = '' as $$
  select n.id, n.appointment_id, n.doctor_id, n.language, n.sections, n.content, n.signed_at,
         coalesce((select jsonb_agg(jsonb_build_object('text', a.text, 'at', a.added_at) order by a.added_at)
                     from public.visit_note_additions a where a.note_id = n.id), '[]'::jsonb)
    from public.visit_notes n
   where n.clinic_id = p_clinic and n.patient_id = p_patient and n.status = 'signed'
   order by n.signed_at desc
   limit least(greatest(p_limit, 0), 50)
$$;
revoke all on function public.records_signed_notes(uuid, uuid, int) from public;
grant execute on function public.records_signed_notes(uuid, uuid, int) to records_app;

-- ---------------------------------------------------------------- who may do what
insert into accounts.permissions (key, app_key, description) values
  ('records.courses.view', 'records', 'See a patient''s treatment courses (to book the next session)'),
  ('records.courses.edit', 'records', 'Start, change and end treatment courses'),
  ('records.rx.write',     'records', 'Write and print prescriptions'),
  ('records.forms.send',   'records', 'Send the forms link for a booking');
insert into accounts.role_permissions (role_key, permission) values
  ('doctor', 'records.courses.view'), ('doctor', 'records.courses.edit'), ('doctor', 'records.rx.write'), ('doctor', 'records.forms.send'),
  ('secretary', 'records.courses.view'), ('secretary', 'records.forms.send'),
  ('clinic_admin', 'records.courses.view'), ('clinic_admin', 'records.forms.send');

-- ---------------------------------------------------------------- the audit trail: kinds and actions, never the words
create or replace function audit.capture_phase_c() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_noise text[] := array['updated_at', 'updated_by_name', 'row_version'];
  v_shown text[] := array['status', 'sessions', 'every_weeks', 'version', 'hidden', 'consent', 'print_count', 'model', 'language'];
  v_changed text[]; v_action text; v_before jsonb; v_after jsonb; v_entity text;
begin
  v_entity := case tg_table_name when 'treatment_courses' then 'treatment_course' when 'prescriptions' then 'prescription'
                                 when 'form_templates' then 'form' when 'form_responses' then 'form_response' else 'record_summary' end;
  if tg_op = 'INSERT' then
    v_action := 'created';
    select jsonb_object_agg(k, v_new -> k) into v_after from unnest(v_shown || array['patient_id']) as k
     where jsonb_typeof(v_new -> k) is not null and jsonb_typeof(v_new -> k) <> 'null';
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
      when 'ended_at' = any (v_changed) then 'ended'
      when 'printed_at' = any (v_changed) then 'printed'
      when 'print_count' = any (v_changed) then 'printed_copy'
      when 'reviewed_at' = any (v_changed) then 'reviewed'
      else 'updated' end;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k) into v_before, v_after
      from unnest(v_changed) as k where k = any (v_shown);
  end if;
  perform audit.log((v_row ->> 'clinic_id')::uuid, v_entity, v_row ->> 'id', v_action, v_before, v_after, v_changed,
                    case when v_action = 'entered_in_error' then 'entered in error' end);
  return null;
end $$;
create trigger audit_treatment_courses after insert or update or delete on treatment_courses for each row execute function audit.capture_phase_c();
create trigger audit_prescriptions     after insert or update or delete on prescriptions     for each row execute function audit.capture_phase_c();
create trigger audit_form_templates    after insert or update or delete on form_templates    for each row execute function audit.capture_phase_c();
create trigger audit_form_responses    after insert or update or delete on form_responses    for each row execute function audit.capture_phase_c();
create trigger audit_record_summaries  after insert on record_summaries for each row execute function audit.capture_phase_c();

-- ---------------------------------------------------------------- records_app: never DELETE
alter table treatment_courses enable row level security;
alter table prescriptions     enable row level security;
alter table form_templates    enable row level security;
alter table form_links        enable row level security;
alter table form_responses    enable row level security;
alter table record_summaries  enable row level security;
grant select, insert, update on treatment_courses, prescriptions, form_templates, form_links, form_responses to records_app;
grant select, insert on record_summaries to records_app;
create policy records_app_access on treatment_courses for all to records_app using (true) with check (true);
create policy records_app_access on prescriptions     for all to records_app using (true) with check (true);
create policy records_app_access on form_templates    for all to records_app using (true) with check (true);
create policy records_app_access on form_links        for all to records_app using (true) with check (true);
create policy records_app_access on form_responses    for all to records_app using (true) with check (true);
create policy records_app_access on record_summaries  for all to records_app using (true) with check (true);

-- ---------------------------------------------------------------- Booking: the course line, the forms line and sending the link
-- Booking reads which course a booking belongs to, whether the booking's forms are filled (not the answers), and makes the link.
grant select (id, clinic_id, patient_id, service_id, sessions, every_weeks, areas, starts_on, ended_at) on treatment_courses to booking_app;
grant select (id, clinic_id, title_en, title_ar, first_visit_only, service_ids, minutes, hidden, sort) on form_templates to booking_app;
grant select (id, clinic_id, appointment_id, template_id, submitted_at) on form_responses to booking_app;
grant select, insert, update on form_links to booking_app;
grant select (clinic_id, courses_on, forms_on, form_link_hours, form_message_en, form_message_ar, rx_on, photo_areas) on record_settings to booking_app;
create policy booking_app_read on treatment_courses for select to booking_app using (true);
create policy booking_app_read on form_templates    for select to booking_app using (true);
create policy booking_app_read on form_responses    for select to booking_app using (true);
create policy booking_app_access on form_links      for all to booking_app using (true) with check (true);

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on table public.treatment_courses, public.prescriptions, public.form_templates, public.form_links, public.form_responses, public.record_summaries from %I', r);
      execute format('revoke all on function public.records_signed_notes(uuid, uuid, int) from %I', r);
    end if;
  end loop;
end $$;
