-- Booking app additions to the existing tables (design: booking/DESIGN.md §6). Compatible with the running WhatsApp agent.

-- "Delete" in the Booking app is a void: the booking stays on record. (Used from migration 0006 on: a new enum value
-- cannot be used in the transaction that adds it.)
alter type appointment_status add value if not exists 'voided';

alter table appointments drop constraint appointments_source_check;
alter table appointments add constraint appointments_source_check
  check (source in ('whatsapp', 'staff', 'web', 'phone', 'walkin'));

alter table appointments add column created_by    uuid references accounts.users (id);
alter table appointments add column updated_by    uuid references accounts.users (id);
alter table appointments add column internal_note text check (char_length(internal_note) <= 500);
alter table appointments add column row_version   int not null default 1;
alter table appointments add column voided_at     timestamptz;
alter table appointments add column voided_by     uuid references accounts.users (id);
alter table appointments add column void_reason   text;

-- A walk-in may refuse to give a number; the number stays unique within a clinic when present.
alter table patients alter column phone_e164 drop not null;
alter table patients add column whatsapp_reminders boolean not null default false;
-- Patients who wrote to the assistant started the conversation: they have agreed to its messages.
update patients p set whatsapp_reminders = true
 where exists (select 1 from conversations c where c.clinic_id = p.clinic_id and c.wa_phone = p.phone_e164);

-- row_version goes up on every real change by anyone (staff, the WhatsApp assistant, SQL), so a save based on an old
-- copy can be refused. Reminder bookkeeping and updated_at do not count as a change.
create function public.appointments_bump_version() returns trigger language plpgsql set search_path = '' as $$
declare
  v_noise text[] := array['updated_at', 'row_version', 'reminder_24h_at', 'reminder_2h_at'];
begin
  if (to_jsonb(new) - v_noise) is distinct from (to_jsonb(old) - v_noise) then
    new.row_version := old.row_version + 1;
  else
    new.row_version := old.row_version;
  end if;
  return new;
end $$;

create trigger appointments_row_version before update on appointments
  for each row execute function public.appointments_bump_version();
