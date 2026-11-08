-- Undoes 0016 (AI Scribe). WARNING: this drops every visit note and addition. Run it only before real notes exist, or after
-- copying them out. The audit trail keeps its entries (it is append-only).
begin;
drop trigger if exists clinics_scribe_defaults on clinics;
drop function if exists public.scribe_settings_defaults();
drop table if exists visit_note_additions;
drop table if exists visit_notes;
drop function if exists public.visit_notes_guard();
drop function if exists audit.capture_note();
drop table if exists scribe_settings;
alter table doctors drop column if exists scribe_enabled;
delete from accounts.role_permissions where permission in ('booking.notes.read', 'booking.notes.write', 'booking.notes.sign');
delete from accounts.permissions where key in ('booking.notes.read', 'booking.notes.write', 'booking.notes.sign');
commit;
