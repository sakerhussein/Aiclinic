-- Two-step recovery (design: booking/design/two-step.html, approved 2026-11-09).
-- 1. A new permission: reset another person's two-step (their authenticator app and recovery codes), for clinic administrators
--    and Limitsiz administrators only. Nobody resets their own.
-- 2. Booking > Settings > Security: warn about recovery codes when this many or fewer are left (1 to 5, default 3).
-- 3. The Booking service's Arabic name is now "المواعيد" (the owner's wording, 2026-11-09), as in the apps.
-- Undo: db/rollback/0018_down.sql
insert into accounts.permissions (key, app_key, description) values
  ('accounts.users.reset_two_step', 'accounts', 'Reset another person''s two-step verification');
insert into accounts.role_permissions (role_key, permission) values
  ('clinic_admin', 'accounts.users.reset_two_step'), ('platform_admin', 'accounts.users.reset_two_step');

update accounts.apps set name_ar = 'المواعيد' where key = 'booking';

alter table clinic_settings add column recovery_warn_at int not null default 3 check (recovery_warn_at between 1 and 5);
grant select (recovery_warn_at) on clinic_settings to accounts_app;

do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on table public.clinic_settings from %I', r);
    end if;
  end loop;
end $$;
