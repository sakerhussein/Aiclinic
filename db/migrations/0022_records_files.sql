-- Records, phase B (design: booking/design/records-phase-b.html, approved by the owner 2026-11-10): photos and documents in a
-- private storage bucket, taking photos with the clinic phone, the nightly encrypted backup on the VPS, and the emergency contact
-- in two parts. Files are never deleted: a wrong one is marked "entered in error". Every opening of a file is recorded.
-- The audit trail records the kind of file and the action, never the file or its title. Undo: db/rollback/0022_down.sql

-- ---------------------------------------------------------------- the emergency contact in two parts, and the photo consent
alter table patient_details
  add column emergency_name     text check (char_length(emergency_name) <= 80),
  add column emergency_relation text check (emergency_relation ~ '^[a-z][a-z0-9_]{0,39}$'),
  add column emergency_phone    text check (char_length(emergency_phone) <= 30),
  add column photo_consent      text check (photo_consent in ('record', 'teaching', 'refused')),
  add column photo_consent_at   timestamptz,
  add column photo_consent_by_name text;
-- What was typed in the single box becomes the name, so nothing is lost (the old column stays, unused, for the undo).
update patient_details set emergency_name = left(btrim(emergency_contact), 80) where nullif(btrim(emergency_contact), '') is not null;

-- ---------------------------------------------------------------- settings (Records › Settings › Photos and documents)
alter table record_settings
  add column relations jsonb not null default '[
    {"key": "spouse", "en": "Spouse", "ar": "زوج / زوجة"}, {"key": "parent", "en": "Parent", "ar": "أب / أم"},
    {"key": "child", "en": "Son or daughter", "ar": "ابن / ابنة"}, {"key": "sibling", "en": "Brother or sister", "ar": "أخ / أخت"},
    {"key": "other", "en": "Other", "ar": "أخرى"}]'::jsonb check (jsonb_typeof(relations) = 'array' and jsonb_array_length(relations) <= 20),
  -- The dermatology starter list; each clinic edits its own.
  add column photo_areas jsonb not null default '[
    {"key": "face", "en": "Face", "ar": "الوجه"}, {"key": "scalp", "en": "Scalp", "ar": "فروة الرأس"}, {"key": "neck", "en": "Neck", "ar": "الرقبة"},
    {"key": "chest", "en": "Chest", "ar": "الصدر"}, {"key": "back", "en": "Back", "ar": "الظهر"}, {"key": "arms", "en": "Arms", "ar": "الذراعان"},
    {"key": "hands", "en": "Hands", "ar": "اليدان"}, {"key": "underarms", "en": "Underarms", "ar": "تحت الإبط"}, {"key": "legs", "en": "Legs", "ar": "الساقان"},
    {"key": "feet", "en": "Feet", "ar": "القدمان"}]'::jsonb check (jsonb_typeof(photo_areas) = 'array' and jsonb_array_length(photo_areas) <= 40),
  -- secretary: secretaries (and administrators) may open this kind; review: the doctor marks it reviewed when someone else added it.
  add column doc_kinds jsonb not null default '[
    {"key": "lab_result", "en": "Lab result", "ar": "نتيجة مختبر", "secretary": false, "review": true},
    {"key": "referral", "en": "Referral letter", "ar": "رسالة تحويل", "secretary": false, "review": false},
    {"key": "report", "en": "Report", "ar": "تقرير", "secretary": false, "review": false},
    {"key": "insurance_card", "en": "Insurance card", "ar": "بطاقة التأمين", "secretary": true, "review": false},
    {"key": "national_id", "en": "National ID", "ar": "الهوية الوطنية", "secretary": true, "review": false},
    {"key": "consent_form", "en": "Consent form", "ar": "نموذج موافقة", "secretary": true, "review": false}]'::jsonb
    check (jsonb_typeof(doc_kinds) = 'array' and jsonb_array_length(doc_kinds) <= 30),
  add column photo_consent_required boolean not null default true,
  add column max_file_mb   int not null default 20 check (max_file_mb between 1 and 50),
  add column link_minutes  int not null default 5  check (link_minutes between 1 and 60),
  add column phone_minutes int not null default 10 check (phone_minutes between 2 and 60);

-- ---------------------------------------------------------------- photos and documents
create table record_files (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null,
  patient_id        uuid not null,
  kind              text not null check (kind in ('photo', 'document')),
  area_key          text check (area_key ~ '^[a-z][a-z0-9_]{0,39}$'),        -- photos: the body area
  doc_kind          text check (doc_kind ~ '^[a-z][a-z0-9_]{0,39}$'),        -- documents: lab_result, referral, …
  title             text check (char_length(btrim(title)) between 1 and 200),
  doc_date          date,
  mime              text not null check (mime in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes        int not null check (size_bytes between 1 and 52428800),
  sha256            text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path      text not null unique,                                     -- <clinic>/<patient>/<file id>: numbers, never names
  source            text not null default 'upload' check (source in ('upload', 'phone')),
  created_at        timestamptz not null default now(),
  created_by        text not null,
  created_by_name   text not null,
  created_by_role   text,
  reviewed_at       timestamptz,
  reviewed_by_name  text,
  error_at          timestamptz,
  error_by_name     text,
  error_reason      text check (char_length(btrim(error_reason)) between 1 and 300),
  backed_up_at      timestamptz,                                              -- copied to the VPS (encrypted)
  updated_at        timestamptz not null default now(),
  row_version       int not null default 1,
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade,
  check ((kind = 'photo' and area_key is not null and doc_kind is null) or (kind = 'document' and doc_kind is not null and title is not null)),
  check ((error_at is null) = (error_reason is null))
);
create index record_files_patient on record_files (clinic_id, patient_id, kind, created_at desc);
create index record_files_backup on record_files (backed_up_at) where backed_up_at is null;

-- The file itself never changes. Marked in error: locked (the nightly backup may still note that it copied it).
create function public.record_files_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.clinic_id is distinct from old.clinic_id or new.patient_id is distinct from old.patient_id or new.kind is distinct from old.kind
     or new.storage_path is distinct from old.storage_path or new.sha256 is distinct from old.sha256 or new.size_bytes is distinct from old.size_bytes
     or new.mime is distinct from old.mime or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by
     or new.created_by_name is distinct from old.created_by_name or new.source is distinct from old.source then
    raise exception 'record file %: the file, who added it and for whom never change', old.id using errcode = '42501';
  end if;
  if old.error_at is not null and (to_jsonb(new) - 'backed_up_at' - 'updated_at' - 'row_version') is distinct from (to_jsonb(old) - 'backed_up_at' - 'updated_at' - 'row_version') then
    raise exception 'record file % was entered in error and is locked', old.id using errcode = '42501';
  end if;
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end $$;
create trigger record_files_guard before update on record_files for each row execute function public.record_files_guard();

-- Taking photos with the clinic phone: a one-time code for one patient, for a few minutes. Only its hash is kept.
create table phone_captures (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null,
  patient_id        uuid not null,
  area_key          text not null check (area_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  token_hash        text not null unique,
  created_by        text not null,
  created_by_name   text not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  opened_at         timestamptz,                                              -- the phone used the code (once)
  done_at           timestamptz,
  photos            int not null default 0,
  foreign key (clinic_id, patient_id) references patients (clinic_id, id) on delete cascade
);

-- "Who opened this record" also lists the files opened, and each time the photos were looked at (once per look, not per photo).
alter table record_openings
  add column file_id uuid references record_files (id) on delete cascade,
  add column what text not null default 'chart' check (what in ('chart', 'photos', 'file'));

-- ---------------------------------------------------------------- the nightly backup (one VPS serves every clinic)
create table backup_settings (
  id                boolean primary key default true check (id),
  run_at            time not null default '03:00',
  timezone          text not null default 'Asia/Amman' check (char_length(timezone) between 1 and 60),
  keep_daily        int  not null default 30 check (keep_daily between 1 and 365),
  keep_monthly      int  not null default 12 check (keep_monthly between 0 and 120),
  restore_weekday   int  not null default 0 check (restore_weekday between 0 and 6),   -- 0 Sunday … 6 Saturday
  restore_sample    int  not null default 20 check (restore_sample between 1 and 500),
  min_free_gb       int  not null default 5 check (min_free_gb between 1 and 500),
  retry_minutes     int  not null default 60 check (retry_minutes between 5 and 600),
  alert_emails      text check (char_length(alert_emails) <= 500),
  updated_at        timestamptz not null default now(),
  updated_by_name   text
);
insert into backup_settings default values;
create trigger backup_settings_updated_at before update on backup_settings for each row execute function public.set_updated_at();

create table backup_runs (
  id                bigserial primary key,
  kind              text not null check (kind in ('nightly', 'retry', 'manual')),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  state             text not null default 'running' check (state in ('running', 'done', 'failed')),
  files             int not null default 0,
  bytes             bigint not null default 0,
  restore_checked   int,                                                      -- a restore check ran: how many files matched
  message           text check (char_length(message) <= 1000),
  alerted           boolean not null default false
);
create index backup_runs_started on backup_runs (started_at desc);

-- ---------------------------------------------------------------- who may do what
insert into accounts.permissions (key, app_key, description) values
  ('records.photos.view',   'records', 'See and take patient photos'),
  ('records.files.add',     'records', 'Add documents to a patient''s record'),
  ('records.backups.view',  'records', 'See the state of the nightly backup'),
  ('records.backups.edit',  'records', 'Change when backups run and how long they are kept');
insert into accounts.role_permissions (role_key, permission) values
  ('doctor', 'records.photos.view'), ('doctor', 'records.files.add'),
  ('secretary', 'records.files.add'), ('clinic_admin', 'records.files.add'),
  ('clinic_admin', 'records.backups.view'), ('platform_admin', 'records.backups.view'), ('platform_admin', 'records.backups.edit');

-- ---------------------------------------------------------------- the audit trail: kinds and actions, never files or titles
create or replace function audit.capture_chart() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_noise text[] := array['updated_at', 'updated_by_name', 'row_version', 'backed_up_at'];
  v_shown text[] := array['kind', 'status', 'alert', 'source', 'sex', 'insurance_status', 'photo_consent'];   -- safe to show; titles, details and numbers are not
  v_changed text[]; v_action text; v_before jsonb; v_after jsonb; v_entity text; v_id text;
begin
  if tg_table_name = 'record_openings' then
    if v_new ->> 'what' = 'photos' then
      perform audit.log((v_new ->> 'clinic_id')::uuid, 'chart', v_new ->> 'patient_id', 'photos_viewed', null,
                        jsonb_build_object('role', v_new ->> 'role'), null, null);
    elsif v_new ->> 'file_id' is not null then
      perform audit.log((v_new ->> 'clinic_id')::uuid, 'record_file', v_new ->> 'file_id', 'opened', null,
                        jsonb_build_object('role', v_new ->> 'role', 'patient_id', v_new ->> 'patient_id'), null, null);
    else
      perform audit.log((v_new ->> 'clinic_id')::uuid, 'chart', v_new ->> 'patient_id', 'opened', null,
                        jsonb_build_object('role', v_new ->> 'role'), null, null);
    end if;
    return null;
  end if;
  v_entity := case tg_table_name when 'chart_entries' then 'chart_entry' when 'patient_details' then 'patient_details'
                                 when 'record_files' then 'record_file' else 'chart_answer' end;
  v_id := case when tg_table_name in ('chart_entries', 'record_files') then v_row ->> 'id' else v_row ->> 'patient_id' end;
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
      when 'reviewed_at' = any (v_changed) then 'reviewed'
      else 'updated' end;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k) into v_before, v_after
      from unnest(v_changed) as k where k = any (v_shown);
  end if;
  perform audit.log((v_row ->> 'clinic_id')::uuid, v_entity, v_id, v_action, v_before, v_after, v_changed,
                    case when v_action = 'entered_in_error' then 'entered in error' end);
  return null;
end $$;
create trigger audit_record_files after insert or update or delete on record_files for each row execute function audit.capture_chart();
create trigger audit_backup_settings after update on backup_settings for each row execute function audit.capture('backup_settings', 'updated_at,updated_by_name', 'none');

-- ---------------------------------------------------------------- records_app: never DELETE
alter table record_files    enable row level security;
alter table phone_captures  enable row level security;
alter table backup_settings enable row level security;
alter table backup_runs     enable row level security;
grant select, insert, update on record_files, phone_captures, backup_settings, backup_runs to records_app;
grant usage on sequence backup_runs_id_seq to records_app;
create policy records_app_access on record_files    for all to records_app using (true) with check (true);
create policy records_app_access on phone_captures  for all to records_app using (true) with check (true);
create policy records_app_access on backup_settings for all to records_app using (true) with check (true);
create policy records_app_access on backup_runs     for all to records_app using (true) with check (true);

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on table public.record_files, public.phone_captures, public.backup_settings, public.backup_runs from %I', r);
      execute format('revoke all on sequence public.backup_runs_id_seq from %I', r);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- the private bucket (on Supabase; not on the test database)
do $$ begin
  if exists (select from pg_namespace where nspname = 'storage') and exists (select from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('records', 'records', false, 52428800, array['image/jpeg', 'image/png', 'application/pdf'])
    on conflict (id) do nothing;
  end if;
end $$;
