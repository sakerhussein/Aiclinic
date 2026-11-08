-- Brochures (design: booking/design/brochures.html): Settings > Online booking > Brochures. The files are made in the staff
-- app from the clinic's own details; these are the clinic's choices for them. Undo: db/rollback/0015_down.sql
alter table online_booking add column brochure_colour text not null default '#2EE6B5' check (brochure_colour ~ '^#[0-9A-Fa-f]{6}$');
-- Which languages the business-size cards are printed in. The flyer and the table stand always carry both, Arabic first.
alter table online_booking add column brochure_card_languages text not null default 'ar_en' check (brochure_card_languages in ('ar_en', 'ar', 'en'));
-- The "chat with our AI assistant" line, shown only while Assistant on the page is on.
alter table online_booking add column brochure_show_ai boolean not null default true;
