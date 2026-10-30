-- Limitsiz website v2: new lead fields (area of interest, clinic size, specialty).
-- Run once in the Supabase SQL Editor for the "Ai clinic" project,
-- after the original leads.sql. Safe to run more than once.

alter table public.leads
  add column if not exists interest    text not null default 'clinic',
  add column if not exists clinic_size text,
  add column if not exists specialty   text;

alter table public.leads drop constraint if exists leads_interest_check;
alter table public.leads add constraint leads_interest_check
  check (interest in ('clinic', 'consulting'));

alter table public.leads drop constraint if exists leads_clinic_size_check;
alter table public.leads add constraint leads_clinic_size_check
  check (clinic_size is null or clinic_size in ('1', '2-5', '6-10', '10+'));

alter table public.leads drop constraint if exists leads_specialty_check;
alter table public.leads add constraint leads_specialty_check
  check (specialty is null or specialty in ('dental', 'dermatology', 'family', 'pediatrics', 'physiotherapy', 'mental', 'other'));

-- Make the API see the new columns immediately.
notify pgrst, 'reload schema';
