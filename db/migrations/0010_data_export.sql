-- Export to Excel on the Bookings and Patients pages. A permission of its own, so it can later be given to someone without also
-- giving them the audit log. Clinic administrators only. Undo: db/rollback/0010_down.sql

insert into accounts.permissions (key, app_key, description) values
  ('booking.data.export', 'booking', 'Export bookings and patients to Excel');

insert into accounts.role_permissions (role_key, permission) values
  ('clinic_admin', 'booking.data.export');
