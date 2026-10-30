-- Limitsiz Clinic: leads table for the website demo/contact form.
-- Run this in the Supabase SQL Editor for the "Ai clinic" project.

create extension if not exists pgcrypto;

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 1 and 200),
  clinic      text check (clinic is null or char_length(clinic) <= 200),
  email       text not null check (char_length(email) between 3 and 320 and email like '%_@_%._%'),
  phone       text check (phone is null or char_length(phone) <= 40),
  message     text check (message is null or char_length(message) <= 2000),
  language    text not null default 'en' check (language in ('en', 'ar')),
  source      text not null default 'website',
  page        text
);

alter table public.leads enable row level security;

-- Website visitors (role "anon") may only INSERT new leads.
-- They cannot read, change, or delete leads.
drop policy if exists "Public can submit leads" on public.leads;
create policy "Public can submit leads"
  on public.leads
  for insert
  to anon
  with check (true);

-- Only signed-in team members (role "authenticated") may read leads.
drop policy if exists "Team can read leads" on public.leads;
create policy "Team can read leads"
  on public.leads
  for select
  to authenticated
  using (true);

-- Index for listing newest leads first.
create index if not exists leads_created_at_idx on public.leads (created_at desc);
