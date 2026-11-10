-- Insurance in Records (design: booking/design/insurance.html, approved by the owner 2026-11-10).
-- The patient's insurance becomes a clear answer (not asked yet / no insurance / insured) and, when insured, a company from the
-- clinic's own list. Each company keeps its telephone, email, address, a contact person and notes for staff. Companies are hidden,
-- never deleted. The old free-text box (patient_details.insurance) stays as the name of a company that is not on the list, so
-- nothing typed before is lost. Two settings for the clinic administrator: show the insurance line in Booking (on at the start),
-- and insurance must be answered (off at the start). Booking reads only the insurance line and the company's card.
-- Undo: db/rollback/0021_down.sql

-- ---------------------------------------------------------------- the clinic's insurance companies
create table insurance_companies (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references clinics (id) on delete cascade,
  name_en           text not null check (char_length(btrim(name_en)) between 1 and 80),
  name_ar           text not null check (char_length(btrim(name_ar)) between 1 and 80),
  phone             text check (char_length(phone) <= 30),
  email             text check (char_length(email) <= 120),
  address           text check (char_length(address) <= 200),
  contact_name      text check (char_length(contact_name) <= 80),
  contact_title     text check (char_length(contact_title) <= 80),
  contact_phone     text check (char_length(contact_phone) <= 30),
  contact_email     text check (char_length(contact_email) <= 120),
  notes             text check (char_length(notes) <= 500),
  hidden            boolean not null default false,          -- hidden, never deleted: patients who have it keep it
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by_name   text,
  row_version       int not null default 1,
  unique (clinic_id, id)
);
create unique index insurance_companies_name on insurance_companies (clinic_id, lower(btrim(name_en)));
create function public.insurance_companies_version() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.clinic_id is distinct from old.clinic_id or new.created_at is distinct from old.created_at then
    raise exception 'an insurance company stays with its clinic' using errcode = '42501';
  end if;
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end $$;
create trigger insurance_companies_version before update on insurance_companies for each row execute function public.insurance_companies_version();
create trigger audit_insurance_companies after insert or update or delete on insurance_companies
  for each row execute function audit.capture('insurance_company', 'updated_at,updated_by_name,row_version');

-- ---------------------------------------------------------------- the patient's insurance
alter table patient_details
  add column insurance_status     text not null default 'unknown' check (insurance_status in ('unknown', 'none', 'insured')),
  add column insurance_company_id uuid;
alter table patient_details
  add constraint patient_details_insurance_company foreign key (clinic_id, insurance_company_id) references insurance_companies (clinic_id, id);
-- What was typed before becomes "insured", with the text as the name of a company not on the list.
update patient_details set insurance = nullif(btrim(insurance), '');
update patient_details set insurance_status = 'insured' where insurance is not null;
-- Insured: a company from the list or a typed name. Otherwise neither.
alter table patient_details add constraint patient_details_insurance_answer check (
  case insurance_status when 'insured' then insurance_company_id is not null or insurance is not null
                        else insurance_company_id is null and insurance is null end);

-- ---------------------------------------------------------------- the two settings
alter table record_settings
  add column insurance_in_booking boolean not null default true,
  add column insurance_required   boolean not null default false;

-- ---------------------------------------------------------------- who reads and writes what
alter table insurance_companies enable row level security;
grant select, insert, update on insurance_companies to records_app;
create policy records_app_access on insurance_companies for all to records_app using (true) with check (true);

-- Booking: the insurance line on the booking and patient pages, and the company's card. Nothing else from the record.
grant select (id, clinic_id, name_en, name_ar, phone, email, address, contact_name, contact_title, contact_phone, contact_email, notes, hidden)
  on insurance_companies to booking_app;
grant select (patient_id, clinic_id, insurance_status, insurance_company_id, insurance) on patient_details to booking_app;
grant select (clinic_id, insurance_in_booking) on record_settings to booking_app;
create policy booking_app_read on insurance_companies for select to booking_app using (true);
create policy booking_app_read on patient_details     for select to booking_app using (true);
create policy booking_app_read on record_settings     for select to booking_app using (true);

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on table public.insurance_companies from %I', r);
    end if;
  end loop;
end $$;
