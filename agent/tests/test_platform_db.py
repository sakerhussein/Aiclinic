"""Phase A database layer on the throw-away Postgres: accounts and permissions, the audit trail and its hash chain,
the booking additions, and the least-privilege database roles (design: booking/DESIGN.md §2, §6, §7)."""

import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import psycopg
import pytest
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from limitsiz_agent.booking import book, cancel, reschedule

TZ = ZoneInfo("Asia/Amman")
DEMO = "00000000-0000-4000-8000-000000000001"
LINA = "00000000-0000-4000-8000-0000000000d1"
OMAR = "00000000-0000-4000-8000-0000000000d2"
CONSULT = "00000000-0000-4000-8000-0000000000b1"
NOW = datetime.combine(date(2026, 12, 6), time(8), TZ)
ZERO = "00000000-0000-0000-0000-000000000000"


# ---------------------------------------------------------------- helpers

def new_clinic(conn, slug=None) -> str:
    slug = slug or "t-" + uuid.uuid4().hex[:8]
    return str(conn.execute("insert into clinics (slug, name_en, name_ar) values (%s, 'T', 'ت') returning id", (slug,)).fetchone()[0])


def new_user(conn, name="Test User", status="active") -> str:
    email = f"{uuid.uuid4().hex[:10]}@example.test"
    return str(conn.execute(
        "insert into accounts.users (email, password_hash, full_name, status) values (%s, 'argon2id$x', %s, %s) returning id",
        (email, name, status)).fetchone()[0])


def member(conn, user, clinic, role, **kw) -> str:
    return str(conn.execute(
        "insert into accounts.memberships (user_id, clinic_id, role_key, doctor_id, can_manage_bookings, active) "
        "values (%s, %s, %s, %s, %s, %s) returning id",
        (user, clinic, role, kw.get("doctor"), kw.get("manage", False), kw.get("active", True))).fetchone()[0])


def perms(conn, user, clinic) -> set:
    return {r[0] for r in conn.execute(
        "select permission from accounts.effective_permissions where user_id = %s and clinic_id is not distinct from %s",
        (user, clinic)).fetchall()}


def events(conn, clinic, entity=None) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("select * from audit.events where chain_key = %s and (%s::text is null or entity = %s) order by seq",
                    (clinic, entity, entity))
        return cur.fetchall()


def actions(conn, clinic, entity=None) -> list[str]:
    return [e["action"] for e in events(conn, clinic, entity)]


def act(conn, clinic, label="Rana Q.", actor_id=None, reason=None):
    conn.execute("select audit.set_actor('user', %s, %s, '192.0.2.14', 'Chrome', 'req-1', %s, %s)",
                 (actor_id or "u-1", label, reason, clinic))


def demo_appointment(conn, start_hour=10, minute=0, phone="+962791110001") -> tuple[str, str]:
    pid = conn.execute("insert into patients (clinic_id, phone_e164, full_name) values (%s, %s, 'P') returning id",
                       (DEMO, phone)).fetchone()[0]
    start = datetime.combine(date(2026, 12, 7), time(start_hour, minute), TZ)
    aid = conn.execute(
        "insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at) "
        "values (%s, %s, %s, %s, %s, %s) returning id", (DEMO, LINA, CONSULT, pid, start, start + timedelta(minutes=20))).fetchone()[0]
    return str(aid), str(pid)


# ---------------------------------------------------------------- accounts and permissions

def test_roles_apps_and_permissions_are_seeded(conn):
    roles = {r[0] for r in conn.execute("select key from accounts.roles").fetchall()}
    assert roles == {"clinic_admin", "secretary", "doctor", "readonly", "platform_admin"}
    assert {r[0] for r in conn.execute("select key from accounts.apps").fetchall()} == {"accounts", "booking", "records"}
    # Up to migration 0023: Booking 14 + visit notes (0016); Accounts 6 + reset two-step (0018); Records 7 (0020) + 4 (0022) + 4 (0023).
    counts = dict(conn.execute("select app_key, count(*)::int from accounts.permissions group by app_key").fetchall())
    assert counts == {"accounts": 7, "booking": 17, "records": 15}


def test_permission_matrix(conn):
    c = new_clinic(conn)
    sec, doc, doc_plus, admin, ro, gone = (new_user(conn) for _ in range(6))
    member(conn, sec, c, "secretary")
    member(conn, doc, c, "doctor")
    member(conn, doc_plus, c, "doctor", manage=True)
    member(conn, admin, c, "clinic_admin")
    member(conn, ro, c, "readonly")
    member(conn, gone, c, "secretary", active=False)

    def of(user, app):                                   # one service's part of a person's permissions
        return {p for p in perms(conn, user, c) if p.startswith(app + ".")}

    notes = {"booking.notes.read", "booking.notes.write", "booking.notes.sign"}             # visit notes: doctors only (0016)
    assert of(sec, "booking") == {
        "booking.appointments.view", "booking.appointments.create", "booking.appointments.edit", "booking.appointments.cancel",
        "booking.appointments.void", "booking.patients.view", "booking.patients.edit", "booking.settings.view",
        "booking.conversations.view"}
    assert of(doc, "booking") == {"booking.appointments.view", "booking.patients.view"} | notes
    assert of(doc_plus, "booking") == {
        "booking.appointments.view", "booking.appointments.create", "booking.appointments.edit", "booking.appointments.cancel",
        "booking.appointments.void", "booking.patients.view", "booking.patients.edit"} | notes
    assert perms(conn, ro, c) == {"booking.appointments.view", "booking.patients.view"}
    assert perms(conn, gone, c) == set()
    every = {r[0] for r in conn.execute("select key from accounts.permissions where key like 'booking.%' or key like 'accounts.users.%'").fetchall()}
    assert of(admin, "booking") | of(admin, "accounts") == every - notes
    # Records (0020, 0022, 0023): doctors the chart; secretaries and administrators the details; Read-only nothing.
    front = {"records.details.view", "records.details.edit", "records.files.add", "records.courses.view", "records.forms.send"}
    assert of(sec, "records") == front
    assert of(doc, "records") == of(doc_plus, "records") == front | {
        "records.chart.read", "records.chart.write", "records.photos.view", "records.courses.edit", "records.rx.write"}
    assert of(admin, "records") == front | {"records.settings.view", "records.settings.edit", "records.openings.view", "records.backups.view"}
    # Only an administrator may restore, read the audit log or manage users.
    for p in ("booking.appointments.restore", "booking.audit.view", "booking.settings.edit", "accounts.users.invite"):
        assert all(p not in perms(conn, u, c) for u in (sec, doc, doc_plus, ro))


def test_platform_administrator_manages_users_not_clinic_data(conn):
    u = new_user(conn)
    conn.execute("insert into accounts.memberships (user_id, clinic_id, role_key) values (%s, null, 'platform_admin')", (u,))
    p = perms(conn, u, None)
    assert "platform.clinics.manage" in p and "accounts.users.invite" in p
    assert not [x for x in p if x.startswith("booking.")]
    with pytest.raises(psycopg.errors.UniqueViolation):
        conn.execute("insert into accounts.memberships (user_id, clinic_id, role_key) values (%s, null, 'platform_admin')", (u,))


def test_membership_rules(conn):
    a, b = new_clinic(conn), new_clinic(conn)
    u = new_user(conn)
    member(conn, u, a, "secretary")
    with pytest.raises(psycopg.errors.UniqueViolation):
        member(conn, u, a, "readonly")                       # one membership per user and clinic
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        member(conn, u, b, "doctor", doctor=LINA)            # a doctor record of another clinic
    assert member(conn, u, DEMO, "doctor", doctor=LINA)      # the clinic's own doctor


def test_user_rules(conn):
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("insert into accounts.users (email, full_name) values ('Upper@Example.test', 'x')")   # lower-case only
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("insert into accounts.users (email, full_name, status) values ('a@example.test', 'x', 'active')")  # no password
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("insert into accounts.users (email, full_name) values ('not-an-email', 'x')")


# ---------------------------------------------------------------- booking additions

def test_booking_additions(conn):
    # Sources used by the Booking app, and patients without a phone number.
    aid, _ = demo_appointment(conn)
    conn.execute("update appointments set source = 'phone' where id = %s", (aid,))
    conn.execute("update appointments set source = 'walkin' where id = %s", (aid,))
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("update appointments set source = 'carrier-pigeon' where id = %s", (aid,))
    conn.execute("insert into patients (clinic_id, full_name) values (%s, 'No phone 1')", (DEMO,))
    conn.execute("insert into patients (clinic_id, full_name) values (%s, 'No phone 2')", (DEMO,))
    conn.execute("insert into patients (clinic_id, phone_e164) values (%s, '+962791110009')", (DEMO,))
    with pytest.raises(psycopg.errors.UniqueViolation):
        conn.execute("insert into patients (clinic_id, phone_e164) values (%s, '+962791110009')", (DEMO,))
    assert conn.execute("select whatsapp_reminders from patients where phone_e164 = '+962791110009'").fetchone()[0] is False


def test_row_version_counts_real_changes_only(conn):
    aid, _ = demo_appointment(conn)
    version = lambda: conn.execute("select row_version from appointments where id = %s", (aid,)).fetchone()[0]
    assert version() == 1
    conn.execute("update appointments set reminder_24h_at = now() where id = %s", (aid,))     # bookkeeping: no new version
    conn.execute("update appointments set reminder_2h_at = now() where id = %s", (aid,))
    assert version() == 1
    conn.execute("update appointments set internal_note = 'prefers a female doctor' where id = %s", (aid,))
    assert version() == 2
    conn.execute("update appointments set status = 'confirmed' where id = %s", (aid,))
    assert version() == 3


def test_void_frees_the_slot_keeps_the_record_and_needs_a_reason(conn):
    a1, _ = demo_appointment(conn, phone="+962791110011")
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("update appointments set status = 'voided' where id = %s", (a1,))          # no reason, no time
    conn.execute("update appointments set status = 'voided', void_reason = 'Entered by mistake', voided_at = now() where id = %s", (a1,))
    a2, _ = demo_appointment(conn, phone="+962791110012")                                         # same doctor and time: free again
    with pytest.raises(psycopg.errors.ExclusionViolation):                                        # restoring clashes with the new one
        conn.execute("update appointments set status = 'booked', voided_at = null, void_reason = null where id = %s", (a1,))
    conn.execute("update appointments set status = 'cancelled' where id = %s", (a2,))
    conn.execute("update appointments set status = 'booked', voided_at = null, void_reason = null where id = %s", (a1,))
    assert conn.execute("select status::text from appointments where id = %s", (a1,)).fetchone()[0] == "booked"


# ---------------------------------------------------------------- the audit trail

def test_audit_records_who_from_where_and_what_changed(conn):
    c = new_clinic(conn)
    with conn.transaction():
        act(conn, c, "Rana Q.", "user-rana")
        pid = conn.execute("insert into patients (clinic_id, phone_e164, full_name) values (%s, '+962791110020', 'Sara') returning id", (c,)).fetchone()[0]
    with conn.transaction():
        act(conn, c, "Rana Q.", "user-rana", reason="Corrected the number")
        conn.execute("update patients set phone_e164 = '+962791110021' where id = %s", (pid,))
    ev = events(conn, c, "patient")
    assert [e["action"] for e in ev] == ["created", "updated"]
    first, second = ev
    assert (first["actor_type"], first["actor_id"], first["actor_label"], first["ip"], first["user_agent"], first["request_id"]) == \
           ("user", "user-rana", "Rana Q.", "192.0.2.14", "Chrome", "req-1")
    assert first["after"]["full_name"] == "Sara" and first["entity_id"] == str(pid) and first["db_role"]
    assert second["changed_fields"] == ["phone_e164"]
    assert second["before"] == {"phone_e164": "+962791110020"} and second["after"] == {"phone_e164": "+962791110021"}
    assert second["reason"] == "Corrected the number"


def test_change_without_an_actor_is_recorded_as_database_access(conn):
    c = new_clinic(conn)
    conn.execute("insert into patients (clinic_id, phone_e164) values (%s, '+962791110022')", (c,))
    e = events(conn, c, "patient")[0]
    assert (e["actor_type"], e["actor_label"]) == ("database", "direct database access")
    assert e["actor_id"] == e["db_role"]


def test_actor_does_not_leak_into_the_next_transaction(conn):
    c = new_clinic(conn)
    with conn.transaction():
        act(conn, c)
        conn.execute("insert into patients (clinic_id, phone_e164) values (%s, '+962791110023')", (c,))
    conn.execute("insert into patients (clinic_id, phone_e164) values (%s, '+962791110024')", (c,))
    assert [e["actor_type"] for e in events(conn, c, "patient")] == ["user", "database"]


def test_set_actor_rejects_a_made_up_type(conn):
    with pytest.raises(psycopg.errors.InvalidParameterValue):
        conn.execute("select audit.set_actor('database', 'x', 'x')")


def test_bookkeeping_changes_are_not_audited(conn):
    aid, _ = demo_appointment(conn)
    before = len(events(conn, DEMO, "appointment"))
    conn.execute("update appointments set reminder_24h_at = now(), reminder_2h_at = now(), updated_at = now() where id = %s", (aid,))
    assert len(events(conn, DEMO, "appointment")) == before


def test_appointment_lifecycle_actions(conn):
    aid, _ = demo_appointment(conn)
    run = lambda sql, *a: conn.execute(sql, (*a, aid))
    run("update appointments set status = 'confirmed' where id = %s")
    run("update appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = %s")
    run("update appointments set status = 'cancelled', cancel_reason = 'Travelling' where id = %s")
    run("update appointments set status = 'booked' where id = %s")
    run("update appointments set status = 'voided', void_reason = 'Duplicate booking', voided_at = now() where id = %s")
    run("update appointments set status = 'booked', void_reason = null, voided_at = null where id = %s")
    run("update appointments set internal_note = 'ring first' where id = %s")
    ev = [e for e in events(conn, DEMO, "appointment") if e["entity_id"] == aid]
    assert [e["action"] for e in ev] == ["created", "status_changed", "rescheduled", "cancelled", "status_changed",
                                         "voided", "restored", "updated"]
    assert ev[3]["reason"] == "Travelling" and ev[5]["reason"] == "Duplicate booking"
    assert ev[2]["changed_fields"] == ["ends_at", "starts_at"]


def test_secrets_never_reach_the_log(conn):
    u = new_user(conn)
    conn.execute("update accounts.users set password_hash = 'argon2id$new', mfa_secret_enc = 'enc', mfa_enabled = true where id = %s", (u,))
    conn.execute("update accounts.users set failed_logins = 3, last_login_at = now() where id = %s", (u,))   # noise
    ev = [e for e in events(conn, ZERO, "user") if e["entity_id"] == u]
    assert [e["action"] for e in ev] == ["created", "password_changed"]
    text = str(ev[0]["after"]) + str(ev[1]["before"]) + str(ev[1]["after"])
    assert "argon2id" not in text and "enc" not in str(ev[1]["after"].get("mfa_secret_enc")) and "[hidden]" in text


def test_membership_changes_are_recorded_on_the_clinics_chain(conn):
    c = new_clinic(conn)
    u = new_user(conn)
    m = member(conn, u, c, "secretary")
    conn.execute("update accounts.memberships set role_key = 'readonly' where id = %s", (m,))
    conn.execute("update accounts.memberships set can_manage_bookings = true where id = %s", (m,))
    conn.execute("update accounts.memberships set active = false where id = %s", (m,))
    conn.execute("update accounts.memberships set active = true where id = %s", (m,))
    assert actions(conn, c, "membership") == ["created", "role_changed", "permissions_changed", "access_removed", "access_restored"]


# ---------------------------------------------------------------- tamper evidence

def test_hash_chain_verifies_and_detects_tampering(conn):
    c = new_clinic(conn)
    base = len(events(conn, c))              # creating a clinic writes its set-up entries
    for i in range(5):
        conn.execute("insert into patients (clinic_id, phone_e164) values (%s, %s)", (c, f"+96279111003{i}"))
    ev = events(conn, c)
    total = base + 5
    assert [e["seq"] for e in ev] == list(range(1, total + 1)) and ev[0]["prev_hash"] == ""
    assert all(ev[i]["prev_hash"] == ev[i - 1]["hash"] for i in range(1, total))
    assert conn.execute("select ok, checked, broken_seq from audit.verify(%s)", (c,)).fetchone() == (True, total, None)
    head = conn.execute("select seq, hash from audit.head(%s)", (c,)).fetchone()
    assert head == (total, ev[-1]["hash"])

    conn.execute("alter table audit.events disable trigger events_no_update_delete")
    try:
        conn.execute("update audit.events set after = '{\"phone_e164\": \"+962700000000\"}' where chain_key = %s and seq = %s", (c, base + 3))
        assert conn.execute("select ok, broken_seq from audit.verify(%s)", (c,)).fetchone() == (False, base + 3)
        conn.execute("update audit.events set after = %s where chain_key = %s and seq = %s", (Jsonb(ev[base + 2]["after"]), c, base + 3))
        assert conn.execute("select ok from audit.verify(%s)", (c,)).fetchone()[0] is True       # put back: fine again
        conn.execute("delete from audit.events where chain_key = %s and seq = %s", (c, base + 2))   # a missing entry shows too
        assert conn.execute("select ok, broken_seq from audit.verify(%s)", (c,)).fetchone() == (False, base + 3)
    finally:
        conn.execute("alter table audit.events enable trigger events_no_update_delete")


def test_each_clinic_has_its_own_chain(conn):
    a, b = new_clinic(conn), new_clinic(conn)
    base_a, base_b = len(events(conn, a)), len(events(conn, b))
    conn.execute("insert into patients (clinic_id, phone_e164) values (%s, '+962791110040')", (a,))
    conn.execute("insert into patients (clinic_id, phone_e164) values (%s, '+962791110041')", (b,))
    conn.execute("insert into patients (clinic_id, phone_e164) values (%s, '+962791110042')", (b,))
    assert len(events(conn, a)) == base_a + 1 and len(events(conn, b)) == base_b + 2
    assert [e["seq"] for e in events(conn, b)] == list(range(1, base_b + 3))
    assert events(conn, a)[0]["hash"] != events(conn, b)[0]["hash"]


def test_audit_events_are_append_only_even_for_the_owner(conn):
    c = new_clinic(conn)
    base = len(events(conn, c))
    conn.execute("insert into patients (clinic_id, phone_e164) values (%s, '+962791110050')", (c,))
    for sql in ("update audit.events set action = 'x'", "delete from audit.events", "truncate audit.events"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(sql)
    assert len(events(conn, c)) == base + 1


# ---------------------------------------------------------------- database roles

def as_role(conn, role):
    """Runs the block as a service's login (SET LOCAL ROLE inside a transaction)."""
    class _Ctx:
        def __enter__(self_inner):
            self_inner.tx = conn.transaction(force_rollback=True)
            self_inner.tx.__enter__()
            conn.execute(psycopg.sql.SQL("set local role {}").format(psycopg.sql.Identifier(role)))
            return conn

        def __exit__(self_inner, *exc):
            return self_inner.tx.__exit__(*exc)
    return _Ctx()


def denied(conn, role, sql, params=()):
    # Each attempt in its own rolled-back transaction, so one refusal does not poison the next.
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with as_role(conn, role):
            conn.execute(sql, params)


def test_booking_app_can_work_but_not_delete_or_touch_the_audit_log(conn):
    aid, _ = demo_appointment(conn)
    with as_role(conn, "booking_app"):
        assert conn.execute("select count(*) from appointments").fetchone()[0] >= 1       # the RLS policy lets it in
        conn.execute("select audit.set_actor('user', 'u-9', 'Rana Q.', null, null, null, null, %s)", (DEMO,))
        conn.execute("update appointments set internal_note = 'from booking_app' where id = %s", (aid,))
        assert conn.execute("select ok from audit.verify(%s)", (DEMO,)).fetchone()[0] is True
    denied(conn, "booking_app", "delete from appointments where id = %s", (aid,))
    denied(conn, "booking_app", "delete from patients")
    denied(conn, "booking_app", "select * from audit.events")
    denied(conn, "booking_app", "insert into audit.events (chain_key, seq, at, actor_type, db_role, entity, action, prev_hash, hash) "
                                "values (gen_random_uuid(), 1, now(), 'user', 'x', 'x', 'x', '', 'x')")
    denied(conn, "booking_app", "select * from accounts.users")
    denied(conn, "booking_app", "update clinics set wa_phone_number_id = 'x'")      # profile fields yes, WhatsApp wiring and active no
    denied(conn, "booking_app", "update clinics set active = false")
    denied(conn, "booking_app", "delete from doctors")
    denied(conn, "booking_app", "delete from services")
    # What it did was audited, as the database login it used.
    with as_role(conn, "booking_app"):
        conn.execute("select audit.set_actor('user', 'u-9', 'Rana Q.', null, null, null, null, %s)", (DEMO,))
        conn.execute("update appointments set internal_note = 'again' where id = %s", (aid,))
        conn.execute("set local role postgres")
        last = conn.execute("select actor_label, db_role, actor_type from audit.events where chain_key = %s order by seq desc limit 1", (DEMO,)).fetchone()
    assert last[0] == "Rana Q." and last[2] == "user"


def test_accounts_app_is_confined_to_accounts(conn):
    u = new_user(conn)
    with as_role(conn, "accounts_app"):
        assert conn.execute("select count(*) from accounts.users where id = %s", (u,)).fetchone()[0] == 1
        assert conn.execute("select name_en from clinics where slug = 'demo-derma'").fetchone()
    denied(conn, "accounts_app", "delete from accounts.users")
    denied(conn, "accounts_app", "update appointments set status = 'cancelled'")
    denied(conn, "accounts_app", "select phone from clinics")
    denied(conn, "accounts_app", "select * from patients")
    denied(conn, "accounts_app", "select * from audit.events")


def test_audit_reader_sees_only_the_clinic_it_was_told(conn):
    a, b = new_clinic(conn), new_clinic(conn)
    conn.execute("insert into patients (clinic_id, phone_e164) values (%s, '+962791110060')", (a,))
    conn.execute("insert into patients (clinic_id, phone_e164) values (%s, '+962791110061')", (b,))
    with as_role(conn, "audit_reader"):
        assert conn.execute("select count(*) from audit.events").fetchone()[0] == 0           # no clinic named: nothing
        conn.execute("select set_config('app.clinic_id', %s, true)", (a,))
        rows = conn.execute("select distinct clinic_id::text from audit.events").fetchall()
        assert rows == [(a,)]
    denied(conn, "audit_reader", "select * from patients")
    denied(conn, "audit_reader", "delete from audit.events")


def test_a_role_without_a_policy_sees_nothing(conn):
    if not conn.execute("select 1 from pg_roles where rolname = 'rls_stranger'").fetchone():
        conn.execute("create role rls_stranger")
    conn.execute("grant select on appointments, patients to rls_stranger")
    demo_appointment(conn)
    with as_role(conn, "rls_stranger"):
        assert conn.execute("select count(*) from appointments").fetchone()[0] == 0
        assert conn.execute("select count(*) from patients").fetchone()[0] == 0


# ---------------------------------------------------------------- the WhatsApp assistant is audited too

def test_agent_writes_are_audited_as_the_assistant(conn):
    start = datetime.combine(date(2026, 12, 7), time(10, 0), TZ)
    a = book(conn, DEMO, "+962791110070", CONSULT, LINA, start, full_name="Sara", now=NOW)
    pat = conn.execute("select whatsapp_reminders from patients where phone_e164 = '+962791110070'").fetchone()[0]
    assert pat is True                                                                       # they started the conversation
    reschedule(conn, DEMO, "+962791110070", a["id"], start + timedelta(hours=1), now=NOW)
    cancel(conn, DEMO, "+962791110070", a["id"], reason="Travelling", now=NOW)
    ev = [e for e in events(conn, DEMO) if e["entity_id"] in (str(a["id"]),) or e["entity"] == "patient"][-4:]
    assert [(e["entity"], e["action"]) for e in ev] == [("patient", "created"), ("appointment", "created"),
                                                         ("appointment", "rescheduled"), ("appointment", "cancelled")]
    assert all((e["actor_type"], e["actor_id"], e["actor_label"]) == ("agent", "whatsapp", "WhatsApp assistant") for e in ev)
    assert ev[-1]["reason"] == "Travelling"
    assert conn.execute("select ok from audit.verify(%s)", (DEMO,)).fetchone()[0] is True
