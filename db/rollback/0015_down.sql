-- Undoes 0015: the brochure settings go back to the defaults built into the staff app.
begin;
alter table online_booking drop column if exists brochure_colour, drop column if exists brochure_card_languages,
  drop column if exists brochure_show_ai;
commit;
