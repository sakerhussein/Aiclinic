-- Limitsiz website v3: lead fields for the redesigned assessment form.
-- Run once in the Supabase SQL Editor for the "Ai clinic" project,
-- after leads.sql (and leads_v2.sql, if you ran it). Safe to run more than once.

-- 1. Email is optional now: a lead needs an email OR a phone/WhatsApp number.
alter table public.leads alter column email drop not null;
alter table public.leads drop constraint if exists leads_email_check;
alter table public.leads add constraint leads_email_check
  check (email is null or (char_length(email) between 3 and 320 and email like '%_@_%._%'));
alter table public.leads drop constraint if exists leads_contact_check;
alter table public.leads add constraint leads_contact_check
  check (email is not null or phone is not null);

-- 2. Fields from v2, in case leads_v2.sql was never run.
alter table public.leads
  add column if not exists interest    text not null default 'clinic',
  add column if not exists clinic_size text;
alter table public.leads drop constraint if exists leads_interest_check;
alter table public.leads add constraint leads_interest_check
  check (interest in ('clinic', 'consulting'));
alter table public.leads drop constraint if exists leads_clinic_size_check;
alter table public.leads add constraint leads_clinic_size_check
  check (clinic_size is null or clinic_size in ('1', '2-5', '6-10', '10+'));

-- 3. New fields: several specialties, chosen package, and "what should we fix first".
alter table public.leads
  add column if not exists specialties text[],
  add column if not exists package     text,
  add column if not exists focus       text;

alter table public.leads drop constraint if exists leads_specialties_check;
alter table public.leads add constraint leads_specialties_check
  check (specialties is null or specialties <@ array['dermatology', 'dental', 'family', 'pediatrics', 'physiotherapy', 'mental', 'other']::text[]);
alter table public.leads drop constraint if exists leads_package_check;
alter table public.leads add constraint leads_package_check
  check (package is null or package in ('starter', 'pro', 'enterprise'));
alter table public.leads drop constraint if exists leads_focus_check;
alter table public.leads add constraint leads_focus_check
  check (focus is null or focus in ('missed_calls', 'scheduling', 'documentation', 'reports', 'finance'));

-- 4. Copy the old single "specialty" value (v2) into the new list, if that column exists.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'leads' and column_name = 'specialty') then
    update public.leads set specialties = array[specialty]
      where specialty is not null and specialties is null;
  end if;
end $$;

-- Make the API see the new columns immediately.
notify pgrst, 'reload schema';
