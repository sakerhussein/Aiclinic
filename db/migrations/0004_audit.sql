-- Audit trail (design: booking/DESIGN.md §7). Written by the database, append-only, hash-chained per clinic.
--
-- Who is acting is told to the database inside each transaction with audit.set_actor(). A change made without it is still
-- recorded, as actor "database" with the login name, which is itself a red flag.

create schema if not exists audit;

create table audit.events (
  id           bigserial primary key,
  chain_key    uuid not null,                 -- the clinic, or the all-zero id for platform-level events
  seq          bigint not null,               -- 1, 2, 3 … within the chain
  at           timestamptz not null,
  clinic_id    uuid,
  actor_type   text not null check (actor_type in ('user', 'agent', 'system', 'database')),
  actor_id     text,
  actor_label  text,
  db_role      text not null,                 -- the database login that wrote it
  ip           text,
  user_agent   text,
  request_id   text,
  entity       text not null,
  entity_id    text,
  action       text not null,
  before       jsonb,
  after        jsonb,
  changed_fields text[],
  reason       text,
  prev_hash    text not null,
  hash         text not null,
  unique (chain_key, seq)
);
create index on audit.events (chain_key, at desc);
create index on audit.events (chain_key, entity, entity_id, seq);
create index on audit.events (chain_key, actor_id, at desc);

-- ---------------------------------------------------------------- hashing

create function audit.row_text(
  p_key uuid, p_seq bigint, p_at timestamptz, p_actor_type text, p_actor_id text, p_actor_label text, p_db_role text,
  p_ip text, p_user_agent text, p_request_id text, p_entity text, p_entity_id text, p_action text,
  p_before jsonb, p_after jsonb, p_changed text[], p_reason text, p_prev_hash text
) returns text language sql stable set search_path = '' as $$
  select concat_ws(E'\x1f',
    p_key::text, p_seq::text, to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(p_actor_type, ''), coalesce(p_actor_id, ''), coalesce(p_actor_label, ''), coalesce(p_db_role, ''),
    coalesce(p_ip, ''), coalesce(p_user_agent, ''), coalesce(p_request_id, ''),
    coalesce(p_entity, ''), coalesce(p_entity_id, ''), coalesce(p_action, ''),
    coalesce(p_before::text, ''), coalesce(p_after::text, ''), coalesce(array_to_string(p_changed, ','), ''),
    coalesce(p_reason, ''), coalesce(p_prev_hash, ''))
$$;

create function audit.hash_of(p text) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;

create function audit.chain_lock(p_clinic uuid) returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended(coalesce(p_clinic, '00000000-0000-0000-0000-000000000000'::uuid)::text, 42))
$$;

-- ---------------------------------------------------------------- who is acting

-- Call first in every write transaction. Takes the clinic's chain lock early, so concurrent transactions never wait
-- on each other in opposite order (no deadlocks between row locks and the chain).
create function audit.set_actor(
  p_type text, p_id text, p_label text,
  p_ip text default null, p_user_agent text default null, p_request_id text default null,
  p_reason text default null, p_clinic uuid default null
) returns void language plpgsql set search_path = '' as $$
begin
  if p_type not in ('user', 'agent', 'system') then
    raise exception 'audit.set_actor: type must be user, agent or system' using errcode = '22023';
  end if;
  perform set_config('app.actor_type', p_type, true), set_config('app.actor_id', coalesce(p_id, ''), true),
          set_config('app.actor_label', coalesce(p_label, ''), true), set_config('app.ip', coalesce(p_ip, ''), true),
          set_config('app.user_agent', coalesce(p_user_agent, ''), true), set_config('app.request_id', coalesce(p_request_id, ''), true),
          set_config('app.reason', coalesce(p_reason, ''), true);
  if p_clinic is not null then
    perform audit.chain_lock(p_clinic);
  end if;
end $$;

-- ---------------------------------------------------------------- writing an entry

create function audit.log(
  p_clinic uuid, p_entity text, p_entity_id text, p_action text,
  p_before jsonb default null, p_after jsonb default null, p_changed text[] default null, p_reason text default null,
  p_actor_type text default null, p_actor_id text default null, p_actor_label text default null,
  p_ip text default null, p_user_agent text default null, p_request_id text default null
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_key uuid := coalesce(p_clinic, '00000000-0000-0000-0000-000000000000'::uuid);
  v_type text := coalesce(p_actor_type, nullif(current_setting('app.actor_type', true), ''));
  v_id text; v_label text;
  v_prev_seq bigint; v_prev_hash text; v_seq bigint; v_at timestamptz; v_hash text; v_row bigint;
  v_ip text; v_ua text; v_req text; v_reason text;
begin
  if v_type is null then
    v_type := 'database';
    v_id := session_user;
    v_label := 'direct database access';
  else
    v_id := coalesce(p_actor_id, nullif(current_setting('app.actor_id', true), ''));
    v_label := coalesce(p_actor_label, nullif(current_setting('app.actor_label', true), ''));
  end if;
  v_ip := coalesce(p_ip, nullif(current_setting('app.ip', true), ''));
  v_ua := coalesce(p_user_agent, nullif(current_setting('app.user_agent', true), ''));
  v_req := coalesce(p_request_id, nullif(current_setting('app.request_id', true), ''));
  v_reason := coalesce(p_reason, nullif(current_setting('app.reason', true), ''));

  perform audit.chain_lock(p_clinic);
  select seq, hash into v_prev_seq, v_prev_hash from audit.events where chain_key = v_key order by seq desc limit 1;
  v_seq := coalesce(v_prev_seq, 0) + 1;
  v_prev_hash := coalesce(v_prev_hash, '');
  v_at := clock_timestamp();
  v_hash := audit.hash_of(audit.row_text(v_key, v_seq, v_at, v_type, v_id, v_label, session_user, v_ip, v_ua, v_req,
                                        p_entity, p_entity_id, p_action, p_before, p_after, p_changed, v_reason, v_prev_hash));
  insert into audit.events (chain_key, seq, at, clinic_id, actor_type, actor_id, actor_label, db_role, ip, user_agent, request_id,
                            entity, entity_id, action, before, after, changed_fields, reason, prev_hash, hash)
  values (v_key, v_seq, v_at, p_clinic, v_type, v_id, v_label, session_user, v_ip, v_ua, v_req,
          p_entity, p_entity_id, p_action, p_before, p_after, p_changed, v_reason, v_prev_hash, v_hash)
  returning id into v_row;
  return v_row;
end $$;

-- ---------------------------------------------------------------- checking the chain

-- Recomputes every hash of a chain. ok = false and broken_seq name the first entry that does not fit.
create function audit.verify(p_clinic uuid default null)
returns table (ok boolean, checked bigint, broken_seq bigint) language plpgsql security definer set search_path = '' as $$
declare
  v_key uuid := coalesce(p_clinic, '00000000-0000-0000-0000-000000000000'::uuid);
  r audit.events; v_expect_seq bigint := 1; v_prev text := ''; v_n bigint := 0;
begin
  for r in select * from audit.events where chain_key = v_key order by seq loop
    v_n := v_n + 1;
    if r.seq <> v_expect_seq or r.prev_hash <> v_prev
       or r.hash <> audit.hash_of(audit.row_text(r.chain_key, r.seq, r.at, r.actor_type, r.actor_id, r.actor_label, r.db_role,
            r.ip, r.user_agent, r.request_id, r.entity, r.entity_id, r.action, r.before, r.after, r.changed_fields, r.reason, r.prev_hash))
    then
      return query select false, v_n, r.seq;
      return;
    end if;
    v_expect_seq := v_expect_seq + 1;
    v_prev := r.hash;
  end loop;
  return query select true, v_n, null::bigint;
end $$;

-- The newest hash of a chain: emailed daily to the owner as an anchor outside the database.
create function audit.head(p_clinic uuid default null)
returns table (seq bigint, hash text, at timestamptz) language sql security definer set search_path = '' as $$
  select seq, hash, at from audit.events
   where chain_key = coalesce(p_clinic, '00000000-0000-0000-0000-000000000000'::uuid) order by seq desc limit 1
$$;

-- ---------------------------------------------------------------- append-only

create function audit.forbid_change() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit.events is append-only' using errcode = '42501';
end $$;
create trigger events_no_update_delete before update or delete on audit.events for each row execute function audit.forbid_change();
create trigger events_no_truncate before truncate on audit.events for each statement execute function audit.forbid_change();

alter table audit.events enable row level security;

-- ---------------------------------------------------------------- capturing row changes

create function audit.redact(j jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select case when j is null then null else
    (select coalesce(jsonb_object_agg(key, case when key in ('password_hash', 'mfa_secret_enc') then '"[hidden]"'::jsonb else value end), '{}'::jsonb)
       from jsonb_each(j)) end
$$;

-- Trigger for tables whose changes must be audited. Arguments: entity name, columns whose change alone is not worth an
-- entry (comma separated), the column holding the clinic id (default clinic_id).
create function audit.capture() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_entity text := tg_argv[0];
  v_noise text[] := string_to_array(coalesce(tg_argv[1], ''), ',');
  v_clinic_col text := coalesce(nullif(tg_argv[2], ''), 'clinic_id');
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[]; v_before jsonb; v_after jsonb; v_action text; v_reason text;
begin
  if tg_op = 'INSERT' then
    v_action := 'created'; v_after := v_new;
  elsif tg_op = 'DELETE' then
    v_action := 'deleted'; v_before := v_old;
  else
    select array_agg(k order by k) into v_changed from jsonb_object_keys(v_new) as k
     where (v_new -> k) is distinct from (v_old -> k) and not (k = any (v_noise));
    if v_changed is null then
      return null;                                    -- only noise changed: nothing to record
    end if;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k) into v_before, v_after from unnest(v_changed) as k;
    v_action := 'updated';
    if v_entity = 'appointment' then
      if 'status' in (select unnest(v_changed)) then
        v_action := case
          when v_new ->> 'status' = 'voided' then 'voided'
          when v_old ->> 'status' = 'voided' then 'restored'
          when v_new ->> 'status' = 'cancelled' then 'cancelled'
          else 'status_changed' end;
      elsif v_changed && array['starts_at', 'ends_at', 'doctor_id', 'service_id'] then
        v_action := 'rescheduled';
      end if;
      if v_action = 'voided' then v_reason := v_new ->> 'void_reason';
      elsif v_action = 'cancelled' then v_reason := v_new ->> 'cancel_reason'; end if;
    elsif v_entity = 'membership' then
      v_action := case
        when 'role_key' = any (v_changed) then 'role_changed'
        when 'can_manage_bookings' = any (v_changed) then 'permissions_changed'
        when 'active' = any (v_changed) then case when (v_new ->> 'active')::boolean then 'access_restored' else 'access_removed' end
        else 'updated' end;
    elsif v_entity = 'user' then
      v_action := case
        when 'password_hash' = any (v_changed) then 'password_changed'
        when 'mfa_enabled' = any (v_changed) then case when (v_new ->> 'mfa_enabled')::boolean then 'two_step_on' else 'two_step_off' end
        when 'status' = any (v_changed) then 'status_' || (v_new ->> 'status')
        else 'updated' end;
    end if;
  end if;
  perform audit.log(nullif(v_row ->> v_clinic_col, '')::uuid, v_entity, v_row ->> 'id', v_action,
                    audit.redact(v_before), audit.redact(v_after), v_changed, v_reason);
  return null;
end $$;

create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function audit.capture('appointment', 'updated_at,row_version,reminder_24h_at,reminder_2h_at');
create trigger audit_patients after insert or update or delete on public.patients
  for each row execute function audit.capture('patient', '');
create trigger audit_memberships after insert or update or delete on accounts.memberships
  for each row execute function audit.capture('membership', 'granted_at');
create trigger audit_users after insert or update or delete on accounts.users
  for each row execute function audit.capture('user', 'failed_logins,locked_until,last_login_at', 'none');
