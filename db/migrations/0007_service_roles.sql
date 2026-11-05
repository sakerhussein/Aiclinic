-- Least-privilege database logins for the new services (design: booking/DESIGN.md §6.1).
-- The roles are created without passwords; the owner sets each password out of band (never in git):
--   alter role booking_app password '…';
-- Row Level Security stays on everywhere; these roles get explicit policies, everybody else (the public API roles) none.

do $$
begin
  if not exists (select from pg_roles where rolname = 'accounts_app') then create role accounts_app login; end if;
  if not exists (select from pg_roles where rolname = 'booking_app')  then create role booking_app  login; end if;
  if not exists (select from pg_roles where rolname = 'audit_reader') then create role audit_reader login; end if;
end $$;

-- ---------------------------------------------------------------- accounts_app (the Accounts service)
grant usage on schema accounts, audit to accounts_app;
grant select, insert, update on all tables in schema accounts to accounts_app;
grant delete on accounts.sessions, accounts.app_sessions, accounts.sso_codes, accounts.invites,
                accounts.password_resets, accounts.recovery_codes to accounts_app;
-- It shows clinic and doctor names on the launcher and in invitations; nothing else of the clinic.
grant select (id, slug, name_en, name_ar, active, default_language, timezone) on public.clinics to accounts_app;
grant select (id, clinic_id, name_en, name_ar, active) on public.doctors to accounts_app;
grant execute on function audit.set_actor(text, text, text, text, text, text, text, uuid) to accounts_app;
grant execute on function audit.log(uuid, text, text, text, jsonb, jsonb, text[], text, text, text, text, text, text, text) to accounts_app;

-- ---------------------------------------------------------------- booking_app (the Booking service)
grant usage on schema audit to booking_app;
grant select on public.clinics, public.clinic_faqs, public.doctors, public.services, public.doctor_services,
                public.working_hours, public.time_off, public.patients, public.appointments,
                public.conversations, public.messages, public.handoffs to booking_app;
grant insert, update on public.patients, public.appointments to booking_app;      -- never DELETE: "delete" is a void
grant execute on function audit.set_actor(text, text, text, text, text, text, text, uuid) to booking_app;
grant execute on function audit.log(uuid, text, text, text, jsonb, jsonb, text[], text, text, text, text, text, text, text) to booking_app;
grant execute on function audit.verify(uuid), audit.head(uuid) to booking_app;

-- ---------------------------------------------------------------- audit_reader (the audit page)
grant usage on schema audit to audit_reader;
grant select on audit.events to audit_reader;

-- ---------------------------------------------------------------- policies
do $$
declare t text;
begin
  foreach t in array array['clinics', 'clinic_faqs', 'doctors', 'services', 'doctor_services', 'working_hours', 'time_off',
                           'patients', 'appointments', 'conversations', 'messages', 'handoffs'] loop
    execute format('create policy booking_app_access on public.%I for all to booking_app using (true) with check (true)', t);
  end loop;
  foreach t in array array['clinics', 'doctors'] loop
    execute format('create policy accounts_app_read on public.%I for select to accounts_app using (true)', t);
  end loop;
  foreach t in array array['apps', 'roles', 'permissions', 'role_permissions', 'extra_grants', 'users', 'memberships', 'sessions',
                           'app_sessions', 'sso_codes', 'invites', 'password_resets', 'recovery_codes'] loop
    execute format('create policy accounts_app_access on accounts.%I for all to accounts_app using (true) with check (true)', t);
  end loop;
end $$;

-- The audit page sees only the clinic the service names in the transaction (set with set_config('app.clinic_id', …, true)).
create policy audit_reader_clinic on audit.events for select to audit_reader
  using (clinic_id is not null and clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
