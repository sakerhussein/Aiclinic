"""Find my booking (migration 0013 + whatsapp/links.py) on the test database with a fake WhatsApp: the page queues, the
agent sends a NEW link once, the old one is recorded as replaced, and nothing is said about numbers without bookings."""

import hashlib
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from limitsiz_agent.whatsapp import links
from test_whatsapp import CLINIC, CONSULT, LINA, PNID, FakeWA

PHONE = "+962791234567"
SITE = "https://book.example"
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()  # noqa: E731


@pytest.fixture
def find_on(conn):
    conn.execute("update clinics set wa_phone_number_id = %s where id = %s", (PNID, CLINIC))
    conn.execute("update online_booking set enabled = true, find_enabled = true, find_per_phone_per_day = 3 where clinic_id = %s", (CLINIC,))
    conn.execute("delete from link_requests")
    yield
    conn.execute("update online_booking set enabled = false, find_enabled = false, find_per_phone_per_day = 3 where clinic_id = %s", (CLINIC,))


def web_booking(conn, start, token="old-link", phone=PHONE, source="web", status="booked"):
    pid = conn.execute("""insert into patients (clinic_id, phone_e164, preferred_language) values (%s, %s, 'en')
                          on conflict (clinic_id, phone_e164) do update set phone_e164 = excluded.phone_e164 returning id""",
                       (CLINIC, phone)).fetchone()[0]
    return conn.execute(
        """insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, status, source, manage_token_hash)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id::text""",
        (CLINIC, LINA, CONSULT, pid, start, start + timedelta(minutes=20), status, source,
         sha(token) if source == "web" else None)).fetchone()[0]


def ask(conn, phone=PHONE):
    conn.execute("select public.online_find(%s, %s, '203.0.113.9')", (CLINIC, phone))


def test_new_link_sent_once_and_old_one_replaced(conn, find_on):
    now = datetime.now(timezone.utc)
    appt = web_booking(conn, now + timedelta(days=2))
    web_booking(conn, now + timedelta(days=3), phone="+962790000000", token="someone-else")
    web_booking(conn, now + timedelta(days=4), source="phone")            # made by phone: has no private link
    ask(conn)
    wa = FakeWA()
    assert links.send_due_links(conn, wa, "booking_link", now, SITE) == 1
    (kind, to, name, lang, params, buttons), = wa.sent
    assert (kind, to, name, lang, buttons) == ("template", PHONE, "booking_link", "en", [])
    assert params[0] == "Limitsiz Demo Dermatology" and params[2].startswith("Dr")
    link = params[3]
    assert link.startswith(f"{SITE}/demo-derma/manage#") and len(link.split("#")[1]) == 43
    new_hash = conn.execute("select manage_token_hash from appointments where id = %s", (appt,)).fetchone()[0]
    assert new_hash == sha(link.split("#")[1]) != sha("old-link")
    assert conn.execute("select public.online_link_replaced('demo-derma', %s)", (sha("old-link"),)).fetchone()[0]
    assert not conn.execute("select public.online_link_replaced('demo-derma', %s)", (new_hash,)).fetchone()[0]
    assert links.send_due_links(conn, wa, "booking_link", now, SITE) == 0                     # never twice
    # The audit trail says who changed the booking and why.
    who = conn.execute("""select actor_type, reason from audit.events where entity = 'appointment' and entity_id = %s
                          order by id desc limit 1""", (appt,)).fetchone()
    assert who[0] == "agent" and "Find my booking" in who[1]


def test_unknown_number_limits_and_switch(conn, find_on):
    now = datetime.now(timezone.utc)
    ask(conn, "+962781111111")                                              # no booking: nothing queued, no error
    assert conn.execute("select count(*) from link_requests").fetchone()[0] == 0
    web_booking(conn, now + timedelta(days=2))
    conn.execute("update online_booking set find_per_phone_per_day = 1 where clinic_id = %s", (CLINIC,))
    ask(conn); ask(conn)
    assert conn.execute("select count(*) from link_requests").fetchone()[0] == 1           # one a day for this number
    # Switched off before it was sent: skipped, nothing goes out.
    conn.execute("update online_booking set find_enabled = false where clinic_id = %s", (CLINIC,))
    wa = FakeWA()
    assert links.send_due_links(conn, wa, "booking_link", now, SITE) == 0 and wa.sent == []
    assert conn.execute("select status from link_requests").fetchone()[0] == "skipped"
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        ask(conn)
    # Without the clinic's WhatsApp number the page cannot offer it either.
    conn.execute("update online_booking set find_enabled = true where clinic_id = %s", (CLINIC,))
    conn.execute("update clinics set wa_phone_number_id = null where id = %s", (CLINIC,))
    assert not conn.execute("select public.online_find_available(%s)", (CLINIC,)).fetchone()[0]


def test_old_requests_are_forgotten_after_the_visit(conn, find_on):
    now = datetime.now(timezone.utc)
    web_booking(conn, now + timedelta(days=2))
    ask(conn)
    assert links.forget_old_requests(conn, now) == 0
    assert links.forget_old_requests(conn, now + timedelta(days=4)) == 1


def test_template_text_for_meta():
    t = links.template_text("At {clinic}: {when}, {doctor}. {link}", "في {clinic}: {when}، {doctor}. {link}")
    assert t["en"]["body"] == "At {{1}}: {{2}}, {{3}}. {{4}}" and t["ar"]["body"].endswith("{{4}}")
