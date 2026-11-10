-- Undo 0022_records_files.sql. Roll the code back first. The files themselves stay in the storage bucket and in the VPS backup;
-- only the database's list of them goes, so take a copy of record_files first if any were added:
--   \copy (select * from record_files) to 'record_files_before_undo.csv' csv header
-- The emergency contact typed in two parts goes back into the single box (name, relationship, phone).
update patient_details set emergency_contact = left(concat_ws(' · ', emergency_name, emergency_relation, emergency_phone), 120)
 where coalesce(emergency_name, emergency_phone) is not null;

-- The audit function as 0021 left it (0020's version).
create or replace function audit.capture_chart() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_noise text[] := array['updated_at', 'updated_by_name', 'row_version'];
  v_shown text[] := array['kind', 'status', 'alert', 'source', 'sex'];
  v_changed text[]; v_action text; v_before jsonb; v_after jsonb; v_entity text; v_id text;
begin
  if tg_table_name = 'record_openings' then
    perform audit.log((v_new ->> 'clinic_id')::uuid, 'chart', v_new ->> 'patient_id', 'opened', null,
                      jsonb_build_object('role', v_new ->> 'role'), null, null);
    return null;
  end if;
  v_entity := case tg_table_name when 'chart_entries' then 'chart_entry' when 'patient_details' then 'patient_details' else 'chart_answer' end;
  v_id := case tg_table_name when 'chart_entries' then v_row ->> 'id' else v_row ->> 'patient_id' end;
  if tg_op = 'INSERT' then
    v_action := 'created';
    select jsonb_object_agg(k, v_new -> k) into v_after from unnest(v_shown || array['patient_id', 'field_key']) as k where jsonb_typeof(v_new -> k) is not null and jsonb_typeof(v_new -> k) <> 'null';
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
  else
    select array_agg(k order by k) into v_changed from jsonb_object_keys(v_new) as k
     where (v_new -> k) is distinct from (v_old -> k) and not (k = any (v_noise));
    if v_changed is null then
      return null;
    end if;
    v_action := case
      when 'error_at' = any (v_changed) then 'entered_in_error'
      when 'confirmed_at' = any (v_changed) then 'confirmed'
      else 'updated' end;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k) into v_before, v_after
      from unnest(v_changed) as k where k = any (v_shown);
  end if;
  perform audit.log((v_row ->> 'clinic_id')::uuid, v_entity, v_id, v_action, v_before, v_after, v_changed,
                    case when v_action = 'entered_in_error' then 'entered in error' end);
  return null;
end $$;

delete from accounts.role_permissions where permission in ('records.photos.view', 'records.files.add', 'records.backups.view', 'records.backups.edit');
delete from accounts.permissions where key in ('records.photos.view', 'records.files.add', 'records.backups.view', 'records.backups.edit');

delete from record_openings where file_id is not null or what <> 'chart';
alter table record_openings drop column if exists file_id, drop column if exists what;
drop table if exists backup_runs;
drop table if exists backup_settings;
drop table if exists phone_captures;
drop table if exists record_files;
drop function if exists public.record_files_guard();

alter table record_settings drop column if exists relations, drop column if exists photo_areas, drop column if exists doc_kinds,
  drop column if exists photo_consent_required, drop column if exists max_file_mb, drop column if exists link_minutes, drop column if exists phone_minutes;
alter table patient_details drop column if exists emergency_name, drop column if exists emergency_relation, drop column if exists emergency_phone,
  drop column if exists photo_consent, drop column if exists photo_consent_at, drop column if exists photo_consent_by_name;
-- The bucket 'records' on Supabase is left in place (it may hold files); remove it by hand only when it is empty.
