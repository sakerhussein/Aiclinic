-- The nightly audit job (design: booking/DESIGN.md §7.3, §7.4): integrity check, anchors, retention with checkpoints.
-- Removing old entries is the only way anything leaves audit.events, and it can only happen through audit.nightly, which obeys the
-- clinic's retention setting, never goes under 12 months, and refuses to remove anything from a chain that fails its check.

-- When old entries are removed, the last removed entry's hash is kept here, so the chain stays verifiable from that point on.
create table audit.checkpoints (
  chain_key  uuid not null,
  seq        bigint not null,        -- the last removed entry
  hash       text not null,
  removed    bigint not null,
  removed_to timestamptz not null,
  at         timestamptz not null default now(),
  primary key (chain_key, seq)
);

-- The newest hash each night. The same value goes out by email: that copy is the proof outside the system. This copy lets the next
-- night notice entries removed from the END of a chain, which the hashes alone cannot show.
create table audit.anchors (
  chain_key uuid not null,
  run_date  date not null,
  seq       bigint not null,
  hash      text not null,
  ok        boolean not null,
  at        timestamptz not null default now(),
  primary key (chain_key, run_date)
);

alter table audit.checkpoints enable row level security;
alter table audit.anchors     enable row level security;

-- Append-only, like the log. The one exception is the delete inside audit.purge_before, which sets audit.purge for its transaction.
-- Setting it does not help anyone else: the service logins have no DELETE right on audit.events.
create or replace function audit.forbid_change() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and tg_table_name = 'events' and current_setting('audit.purge', true) = 'on' then
    return old;
  end if;
  raise exception 'audit tables are append-only' using errcode = '42501';
end $$;

create trigger checkpoints_no_update_delete before update or delete on audit.checkpoints for each row execute function audit.forbid_change();
create trigger checkpoints_no_truncate before truncate on audit.checkpoints for each statement execute function audit.forbid_change();
create trigger anchors_no_update_delete before update or delete on audit.anchors for each row execute function audit.forbid_change();
create trigger anchors_no_truncate before truncate on audit.anchors for each statement execute function audit.forbid_change();

-- ---------------------------------------------------------------- checking: starts after the latest checkpoint

create or replace function audit.verify(p_clinic uuid default null)
returns table (ok boolean, checked bigint, broken_seq bigint) language plpgsql security definer set search_path = '' as $$
declare
  v_key uuid := coalesce(p_clinic, '00000000-0000-0000-0000-000000000000'::uuid);
  r audit.events; v_expect_seq bigint := 1; v_prev text := ''; v_n bigint := 0;
  v_cp audit.checkpoints;
begin
  select * into v_cp from audit.checkpoints c where c.chain_key = v_key order by c.seq desc limit 1;
  if found then
    v_expect_seq := v_cp.seq + 1;
    v_prev := v_cp.hash;
  end if;
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

-- ---------------------------------------------------------------- retention

-- Entries older than this may go; null = keep for ever. The floor is here, so no setting can get under it.
create function audit.retention_cutoff(p_clinic uuid) returns timestamptz language sql stable security definer set search_path = '' as $$
  select now() - make_interval(months => greatest(s.audit_retention_months, 12))
    from public.clinic_settings s where s.clinic_id = p_clinic and s.audit_retention_months is not null
$$;

-- Removes a chain's entries older than the cutoff, keeping the newest one so the chain always has a head. No service may call this.
create function audit.purge_before(p_clinic uuid, p_cutoff timestamptz) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_last audit.events; v_head bigint; v_removed bigint;
begin
  perform audit.chain_lock(p_clinic);
  select max(seq) into v_head from audit.events where chain_key = p_clinic;
  select * into v_last from audit.events
   where chain_key = p_clinic and at < p_cutoff and seq < v_head order by seq desc limit 1;
  if not found then return 0; end if;
  perform set_config('audit.purge', 'on', true);
  delete from audit.events where chain_key = p_clinic and seq <= v_last.seq;
  get diagnostics v_removed = row_count;
  perform set_config('audit.purge', 'off', true);
  insert into audit.checkpoints (chain_key, seq, hash, removed, removed_to) values (p_clinic, v_last.seq, v_last.hash, v_removed, v_last.at);
  perform audit.log(p_clinic, 'audit', null, 'retention_purged', null,
    jsonb_build_object('removed', v_removed, 'up_to_seq', v_last.seq, 'up_to', v_last.at, 'checkpoint_hash', v_last.hash),
    null, null, 'system', 'nightly', 'Nightly audit job');
  return v_removed;
end $$;

-- ---------------------------------------------------------------- the nightly run for one chain (p_clinic null = the platform's)

create function audit.nightly(p_clinic uuid, p_run_date date)
returns table (already boolean, ok boolean, checked bigint, broken_seq bigint, anchor_ok boolean, removed bigint, head_seq bigint, head_hash text)
language plpgsql security definer set search_path = '' as $$
declare
  v_key uuid := coalesce(p_clinic, '00000000-0000-0000-0000-000000000000'::uuid);
  v_ok boolean; v_checked bigint; v_broken bigint; v_anchor_ok boolean := true; v_removed bigint := 0;
  v_prev audit.anchors; v_cp_seq bigint; v_cut timestamptz; v_seq bigint; v_hash text; v_done audit.anchors;
begin
  perform audit.chain_lock(v_key);
  select * into v_done from audit.anchors a where a.chain_key = v_key and a.run_date = p_run_date;
  if found then
    return query select true, v_done.ok, 0::bigint, null::bigint, true, 0::bigint, v_done.seq, v_done.hash;
    return;
  end if;

  select v.ok, v.checked, v.broken_seq into v_ok, v_checked, v_broken from audit.verify(p_clinic) v;

  -- Is last night's newest entry still there, unchanged? Entries since removed by retention are accounted for by a checkpoint.
  select * into v_prev from audit.anchors a where a.chain_key = v_key order by a.run_date desc limit 1;
  if found then
    select coalesce(max(c.seq), 0) into v_cp_seq from audit.checkpoints c where c.chain_key = v_key;
    if v_prev.seq > v_cp_seq and not exists (select 1 from audit.events e where e.chain_key = v_key and e.seq = v_prev.seq and e.hash = v_prev.hash) then
      v_anchor_ok := false;
    end if;
  end if;

  -- A chain that fails is evidence: nothing is removed from it.
  if v_ok and v_anchor_ok and p_clinic is not null then
    v_cut := audit.retention_cutoff(p_clinic);
    if v_cut is not null then v_removed := audit.purge_before(p_clinic, v_cut); end if;
  end if;

  perform audit.log(p_clinic, 'audit', null, 'integrity_checked', null,
    jsonb_build_object('ok', v_ok and v_anchor_ok, 'checked', v_checked, 'broken_seq', v_broken, 'anchor_ok', v_anchor_ok, 'removed', v_removed, 'nightly', true),
    null, null, 'system', 'nightly', 'Nightly audit job');

  select e.seq, e.hash into v_seq, v_hash from audit.events e where e.chain_key = v_key order by e.seq desc limit 1;
  insert into audit.anchors (chain_key, run_date, seq, hash, ok) values (v_key, p_run_date, v_seq, v_hash, v_ok and v_anchor_ok);
  return query select false, v_ok, v_checked, v_broken, v_anchor_ok, v_removed, v_seq, v_hash;
end $$;

-- New functions can be run by anyone with access to the schema unless this is said. Only the nightly run is open, to Booking.
revoke execute on function audit.purge_before(uuid, timestamptz) from public;
revoke execute on function audit.retention_cutoff(uuid) from public;
revoke execute on function audit.nightly(uuid, date) from public;
grant execute on function audit.nightly(uuid, date) to booking_app;
