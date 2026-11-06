-- Undoes 0010. Run as the database owner. Nothing but the permission is removed: the audit log keeps its record of past exports.

begin;
delete from accounts.role_permissions where permission = 'booking.data.export';
delete from accounts.permissions where key = 'booking.data.export';
commit;
