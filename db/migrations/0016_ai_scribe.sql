-- AI Scribe, steps 4 and 5 (plan: scribe/PLAN_ai_scribe.md, design: booking/design/ai-scribe.html): the visit note on the
-- appointment, notes on the patient's page, additions, Settings > AI Scribe and the audit trail. Off by default.
-- Built before the speech and draft tests (plan steps 2 and 3): the speech service is a setting whose only choice for now is a
-- stand-in that returns a sample transcript, so no audio leaves the clinic. Undo: db/rollback/0016_down.sql

-- ---------------------------------------------------------------- Settings > AI Scribe, one row per clinic
create table scribe_settings (
  clinic_id                uuid primary key references clinics (id) on delete cascade,
  enabled                  boolean not null default false,          -- off: no visit note screen at all
  note_language            text not null default 'en' check (note_language in ('en', 'ar')),
  -- What the doctor reads to the patient before recording. To be checked by the clinic's lawyer before real patients.
  consent_en               text not null default 'We''d like to record our conversation to help the doctor write the visit note. The recording is deleted as soon as it becomes text, and the doctor reviews and signs the note. Is that OK?'
                           check (char_length(consent_en) between 1 and 1000),
  consent_ar               text not null default 'رح نسجّل الحديث خلال الزيارة عشان يساعد بكتابة ملاحظة الزيارة. التسجيل الصوتي بينحذف مباشرة بعد ما يتحوّل لنص، والطبيب بيراجع الملاحظة وبيوقّعها. موافق/ة؟'
                           check (char_length(consent_ar) between 1 and 1000),
  -- The note's sections in order. key: fixed once made; en/ar: the names; hint: what goes there, for the draft.
  sections                 jsonb not null default '[
    {"key": "reason",     "en": "Reason for visit",                     "ar": "سبب الزيارة",              "hint": "Why the patient came, in a sentence."},
    {"key": "history",    "en": "History of the complaint",             "ar": "تاريخ الشكوى",             "hint": "When it started, how it changed, what makes it better or worse, what was tried."},
    {"key": "relevant",   "en": "Relevant history",                     "ar": "التاريخ المرضي",           "hint": "Medicines, allergies, previous treatments, relevant family history."},
    {"key": "exam",       "en": "Examination",                          "ar": "الفحص",                    "hint": "Site, size, colour and distribution, as the doctor described them aloud."},
    {"key": "assessment", "en": "Assessment (as stated by the doctor)", "ar": "التقييم (كما قاله الطبيب)", "hint": "Only the diagnosis or impression the doctor said aloud."},
    {"key": "plan",       "en": "Plan",                                 "ar": "الخطة",                    "hint": "Treatment with medicine, strength, dose and duration as said; advice; tests."},
    {"key": "followup",   "en": "Follow-up",                            "ar": "المتابعة",                 "hint": "When to come back, and when to come sooner."}
  ]'::jsonb check (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) between 1 and 12),
  max_recording_minutes    int not null default 45 check (max_recording_minutes between 5 and 120),
  transcript_keep_days     int not null default 30 check (transcript_keep_days between 1 and 365),
  notes_per_doctor_per_day int not null default 40 check (notes_per_doctor_per_day between 1 and 500),   -- the cap on what the Scribe costs
  speech_service           text not null default 'stand_in' check (speech_service in ('stand_in')),      -- the speech test adds the real ones
  draft_model              text not null default 'claude-opus-5-5' check (draft_model in ('claude-opus-5-5', 'claude-sonnet-5-5')),
  updated_at               timestamptz not null default now()
);
insert into scribe_settings (clinic_id) select id from clinics;

create function public.scribe_settings_defaults() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.scribe_settings (clinic_id) values (new.id) on conflict do nothing;
  return null;
end $$;
create trigger clinics_scribe_defaults after insert on clinics for each row execute function public.scribe_settings_defaults();
create trigger scribe_settings_updated_at before update on scribe_settings for each row execute function public.set_updated_at();

-- Which doctors may record a visit (each is switched on in Settings > AI Scribe).
alter table doctors add column scribe_enabled boolean not null default false;

-- ---------------------------------------------------------------- the visit note
-- One note per booking (a discarded one does not count). The content is for the treating doctor: a secretary sees only
-- whether the visit has a note and its state. Only a signed note is part of the patient's record, and it never changes again:
-- later changes are dated additions.
create table visit_notes (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null references clinics (id) on delete cascade,
  appointment_id        uuid not null references appointments (id) on delete cascade,
  patient_id            uuid not null references patients (id) on delete cascade,
  doctor_id             uuid not null references doctors (id),
  kind                  text not null check (kind in ('scribe', 'manual')),        -- recorded with the Scribe, or written by hand
  status                text not null check (status in ('recording', 'processing', 'draft', 'failed', 'signed', 'discarded')),
  language              text not null check (language in ('en', 'ar')),
  sections              jsonb not null,                  -- the clinic's sections when the note began, so later changes leave it alone
  content               jsonb not null default '{}',     -- {section key: text}
  flags                 jsonb not null default '[]',     -- [{section, text, kind: unsure | medicine}] for the doctor to check
  transcript            jsonb,                           -- [{t: seconds, who: doctor | patient | other, text}], deleted after the keep days
  transcript_deleted_at timestamptz,
  ai_drafted            boolean not null default false,  -- the content began as the Scribe's draft
  consent_at            timestamptz,                     -- the doctor ticked "The patient agreed to this visit being recorded"
  recording_started_at  timestamptz,
  recording_stopped_at  timestamptz,
  recording_seconds     int check (recording_seconds between 0 and 7200),
  last_chunk_at         timestamptz,
  audio_mime            text check (char_length(audio_mime) <= 100),
  audio_deleted_at      timestamptz,                     -- the audio is deleted as soon as it becomes text
  processing_started_at timestamptz,
  attempts              int not null default 0,
  error                 text check (char_length(error) <= 300),
  speech_service        text,
  model                 text,
  drafted_at            timestamptz,
  signed_at             timestamptz,
  signed_by             text,
  signed_name           text,
  created_by            text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  row_version           int not null default 1,
  constraint visit_notes_consent check (kind <> 'scribe' or consent_at is not null),     -- no recording without the agreement
  constraint visit_notes_signer check (status <> 'signed' or (signed_at is not null and signed_by is not null and signed_name is not null))
);
create unique index visit_notes_one_per_visit on visit_notes (appointment_id) where status <> 'discarded';
create index visit_notes_patient on visit_notes (clinic_id, patient_id);
create index visit_notes_doctor_day on visit_notes (clinic_id, doctor_id, created_at);
create index visit_notes_work on visit_notes (status, updated_at) where status in ('recording', 'processing');
create index visit_notes_transcripts on visit_notes (clinic_id, drafted_at) where transcript is not null;

-- Dated additions under a signed note. Never changed or removed: Booking may only add them.
create table visit_note_additions (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics (id) on delete cascade,
  note_id       uuid not null references visit_notes (id) on delete cascade,
  text          text not null check (char_length(btrim(text)) between 1 and 4000),
  added_at      timestamptz not null default now(),
  added_by      text not null,
  added_by_name text not null
);
create index visit_note_additions_note on visit_note_additions (note_id, added_at);

-- A signed note is locked, and a discarded one stays discarded. The transcript may still be deleted on time.
-- row_version goes up on every real change, so a save based on an old copy is refused.
create function public.visit_notes_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'signed' and (new.status is distinct from old.status or new.content is distinct from old.content
      or new.flags is distinct from old.flags or new.sections is distinct from old.sections or new.language is distinct from old.language
      or new.kind is distinct from old.kind or new.ai_drafted is distinct from old.ai_drafted
      or new.signed_at is distinct from old.signed_at or new.signed_by is distinct from old.signed_by or new.signed_name is distinct from old.signed_name
      or new.clinic_id is distinct from old.clinic_id or new.appointment_id is distinct from old.appointment_id
      or new.patient_id is distinct from old.patient_id or new.doctor_id is distinct from old.doctor_id) then
    raise exception 'visit note % is signed: add an addition instead', old.id using errcode = '42501';
  end if;
  if old.status = 'discarded' and new.status is distinct from old.status then
    raise exception 'visit note % was discarded', old.id using errcode = '42501';
  end if;
  new.updated_at := now();
  if new.status is distinct from old.status or new.content is distinct from old.content or new.flags is distinct from old.flags
     or new.kind is distinct from old.kind then
    new.row_version := old.row_version + 1;
  else
    new.row_version := old.row_version;
  end if;
  return new;
end $$;
create trigger visit_notes_guard before update on visit_notes for each row execute function public.visit_notes_guard();

-- ---------------------------------------------------------------- the audit trail: every step, never the words
-- Started (with the agreement), stopped, draft made, edited, signed, additions, transcript deleted. The note, its flags and
-- the transcript are never copied into the audit log: administrators read that log, and a deleted transcript must stay deleted.
create function audit.capture_note() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_shown text[] := array['kind', 'status', 'language', 'appointment_id', 'patient_id', 'doctor_id', 'consent_at', 'recording_seconds',
                          'speech_service', 'model', 'ai_drafted', 'signed_at', 'signed_name', 'error'];
  v_noise text[] := array['updated_at', 'row_version', 'last_chunk_at', 'audio_mime', 'processing_started_at', 'attempts'];
  v_changed text[]; v_action text; v_before jsonb; v_after jsonb;
begin
  if tg_table_name = 'visit_note_additions' then
    perform audit.log((v_new ->> 'clinic_id')::uuid, 'visit_note', v_new ->> 'note_id', 'addition_added', null,
                      jsonb_build_object('added_by_name', v_new ->> 'added_by_name', 'characters', char_length(v_new ->> 'text')), null, null);
    return null;
  end if;
  if tg_op = 'INSERT' then
    v_action := case when v_new ->> 'kind' = 'scribe' then 'consent_recorded' else 'started_by_hand' end;
    select jsonb_object_agg(k, v_new -> k) into v_after from unnest(v_shown) as k where jsonb_typeof(v_new -> k) <> 'null';
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
    select jsonb_object_agg(k, v_old -> k) into v_before from unnest(v_shown) as k where jsonb_typeof(v_old -> k) <> 'null';
  else
    select array_agg(k order by k) into v_changed from jsonb_object_keys(v_new) as k
     where (v_new -> k) is distinct from (v_old -> k) and not (k = any (v_noise));
    if v_changed is null then
      return null;
    end if;
    v_action := case
      when 'status' = any (v_changed) then case v_new ->> 'status'
        when 'processing' then case when v_old ->> 'status' = 'failed' then 'retried' else 'recording_stopped' end
        when 'draft' then case when (v_new ->> 'ai_drafted')::boolean then 'draft_made' else 'switched_to_hand' end
        when 'failed' then 'draft_failed'
        when 'signed' then 'signed'
        when 'discarded' then 'discarded'
        else 'status_changed' end
      when 'content' = any (v_changed) or 'flags' = any (v_changed) then 'edited'
      when 'transcript' = any (v_changed) then case when jsonb_typeof(v_new -> 'transcript') = 'null' then 'transcript_deleted' else 'transcribed' end
      when 'audio_deleted_at' = any (v_changed) then 'audio_deleted'
      else 'updated' end;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k) into v_before, v_after
      from unnest(v_changed) as k where k = any (v_shown);
  end if;
  perform audit.log((v_row ->> 'clinic_id')::uuid, 'visit_note', v_row ->> 'id', v_action, v_before, v_after, v_changed, null);
  return null;
end $$;
create trigger audit_visit_notes after insert or update or delete on visit_notes for each row execute function audit.capture_note();
create trigger audit_visit_note_additions after insert on visit_note_additions for each row execute function audit.capture_note();
create trigger audit_scribe_settings after insert or update or delete on scribe_settings
  for each row execute function audit.capture('scribe_settings', 'updated_at');

-- ---------------------------------------------------------------- who may do what
insert into accounts.permissions (key, app_key, description) values
  ('booking.notes.read',  'booking', 'Read visit notes (a doctor: their own patients only)'),
  ('booking.notes.write', 'booking', 'Write visit notes and record visits with the AI Scribe'),
  ('booking.notes.sign',  'booking', 'Sign visit notes');
insert into accounts.role_permissions (role_key, permission) values
  ('doctor', 'booking.notes.read'), ('doctor', 'booking.notes.write'), ('doctor', 'booking.notes.sign');

alter table scribe_settings enable row level security;
alter table visit_notes enable row level security;
alter table visit_note_additions enable row level security;
grant select, update on scribe_settings to booking_app;
grant select, insert, update on visit_notes to booking_app;             -- never DELETE: a note is discarded, a signed one stays
grant select, insert on visit_note_additions to booking_app;            -- additions are never changed or removed
create policy booking_app_access on scribe_settings for all to booking_app using (true) with check (true);
create policy booking_app_access on visit_notes for all to booking_app using (true) with check (true);
create policy booking_app_access on visit_note_additions for all to booking_app using (true) with check (true);

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on table public.scribe_settings, public.visit_notes, public.visit_note_additions from %I', r);
    end if;
  end loop;
end $$;
