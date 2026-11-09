-- Undoes 0018: the "Reset two-step" permission and the recovery-code warning setting. Accounts then falls back to its
-- default (warn at 3 or fewer), and the Reset two-step button is refused for everyone.
-- Roll the code back first: Accounts from this change reads recovery_warn_at, and sign-in fails without it.
begin;
alter table clinic_settings drop column if exists recovery_warn_at;
delete from accounts.role_permissions where permission = 'accounts.users.reset_two_step';
delete from accounts.permissions where key = 'accounts.users.reset_two_step';
update accounts.apps set name_ar = 'الحجوزات' where key = 'booking';
commit;
