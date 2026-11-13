-- Undo 0026_human_check.sql. Roll the code back first (the booking page server and Settings read these columns).
-- Lost on undo: each clinic's human-check choices, and which bookings and call-backs passed or skipped the check.
revoke insert (human_check) on appointments from public_app;
alter table web_callbacks  drop column if exists human_check;
alter table appointments   drop column if exists human_check;
alter table online_booking drop column if exists human_check_skip_per_hour, drop column if exists human_check_down,
                           drop column if exists human_check_forms, drop column if exists human_check;
