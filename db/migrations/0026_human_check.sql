-- Human check on the online booking page (design: booking/design/human-check.html, approved 2026-11-13): Cloudflare Turnstile
-- on the final button of each form. Only adds; the code before it keeps working with it.
-- Undo: db/rollback/0026_down.sql

-- Settings › Online booking › Human check. It works only once the server has the Cloudflare keys (booking/.env); until then
-- these settings change nothing.
alter table online_booking
  add column human_check               boolean not null default true,
  add column human_check_forms         text[]  not null default '{book,chat_book,callback,find}'
    check (human_check_forms <@ array['book', 'chat_book', 'callback', 'find', 'chat_start']::text[]),
  -- When Cloudflare can't be reached: let the booking through, marked for a secretary's check, or stop it.
  add column human_check_down          text    not null default 'let_through' check (human_check_down in ('let_through', 'stop')),
  -- At most this many let through without the check per hour, for the whole clinic; then the next ones are stopped.
  add column human_check_skip_per_hour integer not null default 10 check (human_check_skip_per_hour between 0 and 500);

-- How it went: 'passed' (Cloudflare said a person), 'skipped' (Cloudflare couldn't be reached; let through and marked for a check).
-- Null: no check asked (booked by staff, switch off, keys not set, or made before this change).
alter table appointments  add column human_check text check (human_check in ('passed', 'skipped'));
alter table web_callbacks add column human_check text check (human_check in ('passed', 'skipped'));

-- web_callbacks: public_app already inserts every column. online_booking: public_app already reads it, booking_app already
-- updates it, and its audit trigger records every change.
grant insert (human_check) on appointments to public_app;

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on table public.online_booking, public.appointments, public.web_callbacks from %I', r);
    end if;
  end loop;
end $$;
