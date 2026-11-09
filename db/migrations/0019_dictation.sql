-- Dictation into the visit note (design: booking/design/dictation.html, 2026-11-09). The doctor records only their own voice into
-- one field, or into the whole note, and the words are added to the draft. Off by default; every limit is a setting.
-- The audio is never stored; the words dictated are not kept apart from the note either. A row per dictation (no content) is kept
-- for the daily cap and to see what it costs. Undo: db/rollback/0019_down.sql
alter table scribe_settings
  add column dictation_enabled boolean not null default false,
  add column dictation_model text not null default 'claude-haiku-5-5'
    check (dictation_model in ('none', 'claude-haiku-5-5', 'claude-sonnet-5-5')),
  add column dictation_translate boolean not null default true,
  add column dictation_field_seconds int not null default 120 check (dictation_field_seconds between 30 and 300),
  add column dictation_note_minutes int not null default 5 check (dictation_note_minutes between 2 and 15),
  add column dictations_per_doctor_per_day int not null default 200 check (dictations_per_doctor_per_day between 1 and 2000);

create table visit_note_dictations (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics (id) on delete cascade,
  note_id    uuid not null references visit_notes (id) on delete cascade,
  doctor_id  uuid not null references doctors (id),
  scope      text not null check (scope in ('field', 'note')),
  section    text,                                   -- the field's key; null for the whole note
  seconds    int  not null check (seconds between 0 and 1200),
  model      text not null,                          -- 'none' or the Claude model that tidied the words
  outcome    text not null check (outcome in ('inserted', 'nothing_heard', 'failed')),
  created_at timestamptz not null default now()
);
create index visit_note_dictations_daily on visit_note_dictations (clinic_id, doctor_id, created_at);

alter table visit_note_dictations enable row level security;
grant select, insert on visit_note_dictations to booking_app;
create policy booking_app_access on visit_note_dictations for all to booking_app using (true) with check (true);

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on table public.visit_note_dictations, public.scribe_settings from %I', r);
    end if;
  end loop;
end $$;
