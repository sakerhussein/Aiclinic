-- Undoes 0014. Bookings made from chats stay; the chats, call-back requests and the assistant settings are removed.
-- The assistant's memory of web chats (checkpoints with thread ids "web:…") is left; delete it with the agent if wanted.
begin;
drop table if exists web_callbacks;
drop table if exists web_chats;
alter table online_booking drop column if exists chat_enabled, drop column if exists chat_messages_per_chat,
  drop column if exists chat_chats_per_ip_per_day, drop column if exists chat_messages_per_clinic_per_day, drop column if exists chat_keep_days;
commit;
