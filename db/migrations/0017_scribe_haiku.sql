-- Settings > AI Scribe > Model for the draft: Claude Haiku 5.5 as a third choice, so the draft test (plan step 3) compares all
-- three. Opus 5.5 stays the default. Undo: db/rollback/0017_down.sql
alter table scribe_settings drop constraint scribe_settings_draft_model_check;
alter table scribe_settings add constraint scribe_settings_draft_model_check
  check (draft_model in ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'));
