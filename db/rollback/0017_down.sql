-- Undoes 0017: a clinic on Haiku 5.5 goes back to the default, Opus 5.5, and Haiku is no longer a choice.
begin;
update scribe_settings set draft_model = 'claude-opus-5-5' where draft_model = 'claude-haiku-5-5';
alter table scribe_settings drop constraint scribe_settings_draft_model_check;
alter table scribe_settings add constraint scribe_settings_draft_model_check check (draft_model in ('claude-opus-5-5', 'claude-sonnet-5-5'));
commit;
