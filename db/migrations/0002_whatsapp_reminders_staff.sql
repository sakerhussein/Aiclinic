-- Limitsiz Clinic booking agent: WhatsApp (step 5), reminders (step 6) and the staff screen (step 7).
-- Only adds columns; nothing existing changes. Undo: drop the added columns.

-- Step 5: who wrote each message, and media the agent cannot read (voice notes, photos) for staff to see.
alter table messages add column author text check (author in ('patient', 'agent', 'staff', 'reminder', 'system'));
alter table messages add column media_type text;
alter table messages add column media_id text;
-- The name the patient shows on WhatsApp, for the staff screen.
alter table conversations add column profile_name text;

-- Step 6: reminder bookkeeping and the patient's own confirmation.
alter table appointments add column confirmed_at timestamptz;
alter table appointments add column reminder_24h_at timestamptz;
alter table appointments add column reminder_2h_at timestamptz;
create index on appointments (starts_at) where status in ('booked', 'confirmed');

-- Step 7: where hand-off alerts go, and which hand-offs were already alerted.
alter table clinics add column staff_alert_email text;
alter table handoffs add column alerted_at timestamptz;
alter table handoffs add column resolved_by text;
