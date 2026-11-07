-- "Talk to the assistant" on the online booking page (plan: Feature 2, step 5, typing first; design booking/design/assistant-chat.html).
-- The same assistant as WhatsApp, in a web mode that can only BOOK: it proposes a time, and the booking itself is made by the
-- online page's own code when the patient presses Yes, with the name and number from a small form that never reaches the AI.
-- Undo: db/rollback/0014_down.sql

-- Settings > Online booking > Assistant on the page. Off by default; the limits cap what the assistant can cost.
alter table online_booking add column chat_enabled                     boolean not null default false;
alter table online_booking add column chat_messages_per_chat           int not null default 30  check (chat_messages_per_chat between 5 and 200);
alter table online_booking add column chat_chats_per_ip_per_day        int not null default 5   check (chat_chats_per_ip_per_day between 1 and 100);
alter table online_booking add column chat_messages_per_clinic_per_day int not null default 500 check (chat_messages_per_clinic_per_day between 10 and 100000);
alter table online_booking add column chat_keep_days                   int not null default 30  check (chat_keep_days between 1 and 365);

-- One row per chat. The conversation itself is in the assistant's memory (LangGraph checkpoints, thread "web:<id>"),
-- deleted with the row after chat_keep_days.
create table web_chats (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics (id) on delete cascade,
  ip          text,
  messages    int not null default 0,
  proposal    jsonb,                       -- the time the assistant proposed, waiting for the patient's Yes
  callback    jsonb,                       -- what the assistant passed on when it offered a call-back
  events      jsonb not null default '[]', -- what happened on the page, told to the assistant with the next message
  appointment_id uuid references appointments (id) on delete set null,   -- the booking made from this chat
  created_at  timestamptz not null default now(),
  last_at     timestamptz not null default now()
);
create index web_chats_clinic_day on web_chats (clinic_id, created_at);
create index web_chats_ip_day on web_chats (clinic_id, ip, created_at);

-- Call-back requests and emergencies from the page, emailed to the clinic like WhatsApp hand-offs.
create table web_callbacks (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics (id) on delete cascade,
  chat_id     uuid references web_chats (id) on delete set null,
  kind        text not null check (kind in ('call_back', 'emergency')),
  reason      text check (reason in ('patient_request', 'medical_question', 'complaint', 'emergency', 'agent_unsure')),
  summary     text check (char_length(summary) <= 600),
  full_name   text check (char_length(full_name) <= 120),
  phone_e164  text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  created_at  timestamptz not null default now(),
  alerted_at  timestamptz
);
create index web_callbacks_unalerted on web_callbacks (created_at) where alerted_at is null;

-- The online page (public_app) keeps the chat rows and adds call-backs; it never reads call-backs back.
alter table web_chats enable row level security;
alter table web_callbacks enable row level security;
grant select, insert, update (messages, proposal, callback, events, appointment_id, last_at) on web_chats to public_app;
grant insert on web_callbacks to public_app;
create policy public_app_chats on web_chats for all to public_app using (true) with check (true);
create policy public_app_callbacks on web_callbacks for insert to public_app with check (true);
grant select, update on online_booking to booking_app;   -- already there (0011); repeated so this file stands alone

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on table public.web_chats, public.web_callbacks from %I', r);
    end if;
  end loop;
end $$;
