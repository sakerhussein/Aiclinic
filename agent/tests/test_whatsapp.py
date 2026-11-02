"""Steps 5-7 on the test database with fake WhatsApp and a scripted Claude: webhook, processing, reminders,
staff screen and server wiring. No network calls."""

import hashlib
import hmac
import json
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from limitsiz_agent.agent import build_agent
from limitsiz_agent.agent.safety import YES_PAYLOAD
from limitsiz_agent.staff import alert_new_handoffs, create_router
from limitsiz_agent.whatsapp import reminders
from limitsiz_agent.whatsapp.processor import FIXED, Processor
from limitsiz_agent.whatsapp.webhook import Inbound, parse, signature_ok
from test_agent import FakeClaude, msg, text, tool

TZ = ZoneInfo("Asia/Amman")
CLINIC = "00000000-0000-4000-8000-000000000001"
LINA = "00000000-0000-4000-8000-0000000000d1"
CONSULT = "00000000-0000-4000-8000-0000000000b1"
NOW = datetime.combine(date(2026, 12, 6), time(8), TZ)
PNID = "1234567890"
PHONE = "+962791234567"


class FakeWA:
    def __init__(self):
        self.sent: list[tuple] = []

    def _id(self):
        return f"wamid.out.{len(self.sent)}"

    def send_text(self, pnid, to, body):
        self.sent.append(("text", to, body))
        return self._id()

    def send_confirm_buttons(self, pnid, to, body, language):
        self.sent.append(("buttons", to, body, language))
        return self._id()

    def send_template(self, pnid, to, name, language, params, payloads):
        self.sent.append(("template", to, name, language, params, payloads))
        return self._id()

    def mark_read(self, pnid, message_id):
        pass


_n = 0


def inbound(text_="", kind="text", sender=PHONE, media=None, name="Sara"):
    global _n
    _n += 1
    return Inbound(PNID, f"wamid.in.{_n}", sender, name, kind, text_, media)


@pytest.fixture
def wired(conn):
    conn.execute("update clinics set wa_phone_number_id = %s where id = %s", (PNID, CLINIC))

    def make(*responses):
        fake, wa = FakeClaude(*responses), FakeWA()
        proc = Processor(conn, build_agent(conn, fake, now=lambda: NOW), wa, on_button=reminders.handle_button, now=lambda: NOW)
        return proc, wa, fake
    return make


# ---------------------------------------------------------------- webhook

def test_signature():
    body = b'{"x":1}'
    good = "sha256=" + hmac.new(b"secret", body, hashlib.sha256).hexdigest()
    assert signature_ok("secret", body, good)
    assert not signature_ok("secret", body + b" ", good)
    assert not signature_ok("secret", body, None) and not signature_ok("other", body, good)


def test_parse_payload_kinds():
    def m(**k):
        return {"from": "962791234567", "id": f"wamid.{k.pop('n')}", "timestamp": "1", **k}
    payload = {"object": "whatsapp_business_account", "entry": [{"id": "WABA", "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp", "metadata": {"display_phone_number": "962790000000", "phone_number_id": PNID},
        "contacts": [{"profile": {"name": "Sara"}, "wa_id": "962791234567"}],
        "messages": [
            m(n=1, type="text", text={"body": "مرحبا"}),
            m(n=2, type="interactive", interactive={"type": "button_reply", "button_reply": {"id": YES_PAYLOAD, "title": "نعم"}}),
            m(n=3, type="button", button={"payload": "REMIND_CONFIRM:abc", "text": "تأكيد الموعد"}),
            m(n=4, type="audio", audio={"id": "media-1", "voice": True}),
            m(n=5, type="image", image={"id": "media-2", "caption": "بطاقة التأمين"}),
            m(n=6, type="sticker", sticker={"id": "media-3"}),
        ]}}, {"field": "messages", "value": {"metadata": {"phone_number_id": PNID}, "statuses": [{"id": "wamid.x", "status": "read"}]}}]}]}
    got = parse(payload)
    assert [(g.kind, g.text, g.media_id) for g in got] == [
        ("text", "مرحبا", None), ("button", YES_PAYLOAD, None), ("button", "REMIND_CONFIRM:abc", None),
        ("audio", "", "media-1"), ("image", "بطاقة التأمين", "media-2"), ("other", "", None)]
    assert got[0].sender == PHONE and got[0].profile_name == "Sara" and got[0].phone_number_id == PNID


# ---------------------------------------------------------------- processing

def test_text_reply_and_logging(conn, wired):
    proc, wa, _ = wired(msg(text("أهلاً سارة! كيف بقدر أساعدك؟")))
    proc.handle(inbound("مرحبا"))
    assert wa.sent == [("text", PHONE, "أهلاً سارة! كيف بقدر أساعدك؟")]
    rows = conn.execute("select direction, author, body from messages order by created_at").fetchall()
    assert rows == [("in", "patient", "مرحبا"), ("out", "agent", "أهلاً سارة! كيف بقدر أساعدك؟")]
    assert conn.execute("select profile_name, last_inbound_at from conversations").fetchone() == ("Sara", NOW)


def test_duplicate_webhook_is_handled_once(conn, wired):
    proc, wa, fake = wired(msg(text("hi")))
    m = inbound("hello")
    proc.handle(m)
    proc.handle(m)
    assert len(wa.sent) == 1 and len(fake.calls) == 1


def test_booking_with_yes_button(conn, wired):
    proc, wa, _ = wired(
        msg(tool("book_appointment", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="10:00"), stop="tool_use"),
        msg(text("استشارة الأحد 10:00 مع د. لينا. بتأكد؟")),
        msg(text("تم ✅")),
    )
    proc.handle(inbound("بدي استشارة اليوم الساعة 10 مع د. لينا"))
    assert wa.sent[-1] == ("buttons", PHONE, "استشارة الأحد 10:00 مع د. لينا. بتأكد؟", "ar")
    assert conn.execute("select count(*) from appointments").fetchone()[0] == 0
    proc.handle(inbound(YES_PAYLOAD, kind="button"))
    assert wa.sent[-1] == ("text", PHONE, "تم ✅")
    assert conn.execute("select status::text from appointments").fetchone()[0] == "booked"


def test_staff_handling_means_silence(conn, wired):
    proc, wa, fake = wired()
    conn.execute("insert into conversations (clinic_id, wa_phone, status) values (%s, %s, 'handed_off')", (CLINIC, PHONE))
    proc.handle(inbound("hello?"))
    assert wa.sent == [] and fake.calls == []
    assert conn.execute("select body from messages").fetchone()[0] == "hello?"


def test_voice_note_and_photo(conn, wired):
    proc, wa, fake = wired()
    proc.handle(inbound(kind="audio", media="media-1"))
    assert wa.sent[-1] == ("text", PHONE, FIXED["audio"]["ar"])
    proc.handle(inbound("my insurance card", kind="image", media="media-2"))
    assert wa.sent[-1] == ("text", PHONE, FIXED["image"]["en"])
    assert conn.execute("select reason from handoffs").fetchall() == [("patient_request",)]
    assert conn.execute("select media_type, media_id from messages where media_id is not null order by created_at").fetchall() == [
        ("audio", "media-1"), ("image", "media-2")]
    assert fake.calls == []


def test_unknown_whatsapp_number_is_ignored(conn, wired):
    proc, wa, _ = wired()
    proc.handle(Inbound("999", "wamid.x", PHONE, None, "text", "hi"))
    assert wa.sent == [] and conn.execute("select count(*) from messages").fetchone()[0] == 0


# ---------------------------------------------------------------- reminders

def make_appointment(conn, start, created, phone=PHONE, status="booked"):
    pid = conn.execute("""insert into patients (clinic_id, phone_e164, preferred_language) values (%s, %s, 'ar')
                          on conflict (clinic_id, phone_e164) do update set phone_e164 = excluded.phone_e164 returning id""",
                       (CLINIC, phone)).fetchone()[0]
    return conn.execute(
        """insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, status, created_at)
           values (%s, %s, %s, %s, %s, %s, %s, %s) returning id::text""",
        (CLINIC, LINA, CONSULT, pid, start, start + timedelta(minutes=20), status, created)).fetchone()[0]


def test_reminders_24h_and_2h_once_each(conn, wired):
    _, wa, _ = wired()
    tomorrow = make_appointment(conn, NOW + timedelta(hours=20), NOW - timedelta(days=2))
    just_booked = make_appointment(conn, NOW + timedelta(hours=20, minutes=30), NOW - timedelta(minutes=10), phone="+962797777777")
    soon = make_appointment(conn, NOW + timedelta(minutes=90), NOW - timedelta(days=1), phone="+962798888888")
    make_appointment(conn, NOW + timedelta(hours=5), NOW - timedelta(days=1), phone="+962799999999", status="cancelled")

    assert reminders.send_due_reminders(conn, wa, "appointment_reminder", NOW) == 2
    kinds = {(s[1], s[5][0].split(":")[0]) for s in wa.sent}
    assert kinds == {(PHONE, "REMIND_CONFIRM"), ("+962798888888", "REMIND_CONFIRM")}
    first = next(s for s in wa.sent if s[1] == PHONE)
    assert first[2:5] == ("appointment_reminder", "ar", ["استشارة جلدية", "د. لينا حداد", "الاثنين 07/12", "04:00"])
    assert first[5] == [f"REMIND_CONFIRM:{tomorrow}", f"REMIND_CHANGE:{tomorrow}"]
    assert reminders.send_due_reminders(conn, wa, "appointment_reminder", NOW) == 0  # never twice
    later = NOW + timedelta(hours=18, minutes=30)  # tomorrow's appointment is now < 2 h away
    assert reminders.send_due_reminders(conn, wa, "appointment_reminder", later) == 2  # its 2 h one, and just_booked's 24 h one
    assert conn.execute("select count(*) from messages where author = 'reminder'").fetchone()[0] == 4
    assert just_booked and soon


def test_reminder_confirm_and_change_buttons(conn, wired):
    proc, wa, fake = wired(msg(text("أكيد، أي يوم بناسبك؟")))
    appt = make_appointment(conn, NOW + timedelta(hours=20), NOW - timedelta(days=2))
    proc.handle(inbound(f"REMIND_CONFIRM:{appt}", kind="button"))
    assert conn.execute("select status::text, confirmed_at from appointments").fetchone() == ("confirmed", NOW)
    assert "تم تأكيد موعدك" in wa.sent[-1][2] and "04:00" in wa.sent[-1][2]
    proc.handle(inbound(f"REMIND_CONFIRM:{appt}", kind="button", sender="+962700000001"))  # not their appointment
    assert wa.sent[-1][2] == reminders.REPLIES["not_found"]["ar"]
    proc.handle(inbound(f"REMIND_CHANGE:{appt}", kind="button"))
    assert fake.calls[-1]["messages"][-2]["content"][0]["text"] == "بدي أغيّر موعدي"
    assert wa.sent[-1] == ("text", PHONE, "أكيد، أي يوم بناسبك؟")


# ---------------------------------------------------------------- staff screen

@pytest.fixture
def staff(db_url, conn):
    import psycopg
    from fastapi import FastAPI
    wa = FakeWA()
    app = FastAPI()
    app.include_router(create_router(lambda: psycopg.connect(db_url, autocommit=True), wa, "pw", now=lambda: NOW))
    return TestClient(app), wa


AUTH = ("staff", "pw")
SAME = {"origin": "http://testserver"}


def test_staff_needs_password(staff):
    client, _ = staff
    assert client.get("/staff").status_code == 401
    assert client.get("/staff", auth=("staff", "wrong")).status_code == 401
    assert client.get("/staff", auth=AUTH).status_code == 200


def test_staff_today_and_inbox_escape_patient_text(conn, staff):
    client, _ = staff
    appt = make_appointment(conn, NOW + timedelta(hours=3), NOW - timedelta(days=1))
    conn.execute("update patients set full_name = '<script>x</script>'")
    conn.execute("insert into conversations (clinic_id, wa_phone, status) values (%s, %s, 'handed_off')", (CLINIC, PHONE))
    conn.execute("""insert into handoffs (clinic_id, conversation_id, reason, summary)
                    select %s, id, 'emergency', 'Swelling <b>now</b>' from conversations""", (CLINIC,))
    page = client.get("/staff", auth=AUTH).text
    assert "11:00" in page and "&lt;script&gt;" in page and "<script>x" not in page and "1 open hand-off" in page
    inbox = client.get("/staff/inbox", auth=AUTH).text
    assert "Emergency" in inbox and "Swelling &lt;b&gt;now&lt;/b&gt;" in inbox
    r = client.post(f"/staff/appointment/{appt}/status", data={"status": "no_show"}, auth=AUTH, headers=SAME, follow_redirects=False)
    assert r.status_code == 303 and conn.execute("select status::text from appointments").fetchone()[0] == "no_show"


def test_staff_reply_and_hand_back(conn, staff):
    client, wa = staff
    conv = conn.execute("""insert into conversations (clinic_id, wa_phone, status, last_inbound_at)
                           values (%s, %s, 'handed_off', %s) returning id::text""", (CLINIC, PHONE, NOW - timedelta(hours=1))).fetchone()[0]
    conn.execute("insert into handoffs (clinic_id, conversation_id, reason) values (%s, %s, 'complaint')", (CLINIC, conv))
    conn.execute("update clinics set wa_phone_number_id = %s", (PNID,))
    assert client.post(f"/staff/chat/{conv}/reply", data={"text": "hi"}, auth=AUTH).status_code == 403  # no origin
    r = client.post(f"/staff/chat/{conv}/reply", data={"text": "مرحبا، معك فريق العيادة"}, auth=AUTH, headers=SAME, follow_redirects=False)
    assert r.status_code == 303 and wa.sent == [("text", PHONE, "مرحبا، معك فريق العيادة")]
    assert conn.execute("select author from messages").fetchone()[0] == "staff"
    assert "مرحبا، معك فريق العيادة" in client.get(f"/staff/chat/{conv}", auth=AUTH).text
    client.post(f"/staff/chat/{conv}/hand-back", auth=AUTH, headers=SAME)
    assert conn.execute("select status from conversations").fetchone()[0] == "active"
    assert conn.execute("select status, resolved_by from handoffs").fetchone() == ("resolved", "staff")


def test_staff_cannot_reply_after_24_hours(conn, staff):
    client, wa = staff
    conv = conn.execute("""insert into conversations (clinic_id, wa_phone, status, last_inbound_at)
                           values (%s, %s, 'handed_off', %s) returning id::text""", (CLINIC, PHONE, NOW - timedelta(hours=30))).fetchone()[0]
    conn.execute("update clinics set wa_phone_number_id = %s", (PNID,))
    r = client.post(f"/staff/chat/{conv}/reply", data={"text": "hi"}, auth=AUTH, headers=SAME, follow_redirects=False)
    assert "outside" in r.headers["location"] and wa.sent == []
    assert "more than 24 hours old" in client.get(f"/staff/chat/{conv}", auth=AUTH).text


def test_handoff_alert_email_once(conn, monkeypatch):
    sent = []

    class FakeSMTP:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def login(self, *a): pass
        def send_message(self, m): sent.append(m)
    monkeypatch.setattr("limitsiz_agent.staff.smtplib.SMTP_SSL", FakeSMTP)
    conv = conn.execute("insert into conversations (clinic_id, wa_phone) values (%s, %s) returning id", (CLINIC, PHONE)).fetchone()[0]
    conn.execute("insert into handoffs (clinic_id, conversation_id, reason, summary) values (%s, %s, 'emergency', 'help')", (CLINIC, conv))
    smtp = {"host": "smtp.example.com", "port": "465", "user": "u", "password": "p", "sender": "alerts@example.com"}
    assert alert_new_handoffs(conn, smtp, "https://agent.example.com", "team@example.com") == 1
    assert alert_new_handoffs(conn, smtp, "https://agent.example.com", "team@example.com") == 0
    assert sent[0]["To"] == "team@example.com" and f"/staff/chat/{conv}" in sent[0].get_content()


# ---------------------------------------------------------------- server wiring

ENV = {"DATABASE_URL": "postgresql://unused", "ANTHROPIC_API_KEY": "x", "WA_TOKEN": "t", "WA_APP_SECRET": "secret",
       "WA_VERIFY_TOKEN": "verify-me", "STAFF_PASSWORD": "pw"}


def test_server_requires_settings():
    from limitsiz_agent.server import create_app
    with pytest.raises(SystemExit):
        create_app({**ENV, "WA_APP_SECRET": ""})


def test_server_webhook_verify_and_signature():
    from limitsiz_agent.server import create_app
    app = create_app(ENV)
    client = TestClient(app)  # not used as a context manager, so the worker threads do not start
    assert client.get("/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42"}).text == "42"
    assert client.get("/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42"}).status_code == 403
    body = json.dumps({"entry": [{"changes": [{"field": "messages", "value": {"metadata": {"phone_number_id": PNID},
                       "messages": [{"from": "962791234567", "id": "wamid.1", "type": "text", "text": {"body": "hi"}}]}}]}]}).encode()
    assert client.post("/whatsapp/webhook", content=body, headers={"x-hub-signature-256": "sha256=bad"}).status_code == 401
    sig = "sha256=" + hmac.new(b"secret", body, hashlib.sha256).hexdigest()
    assert client.post("/whatsapp/webhook", content=body, headers={"x-hub-signature-256": sig, "content-type": "application/json"}).status_code == 200
    assert app.state.inbox.get_nowait().text == "hi"


def test_checkpointer_tables_get_row_level_security(db_url, conn):
    from limitsiz_agent.server import open_checkpointer
    open_checkpointer(db_url)
    rows = conn.execute("select tablename, rowsecurity from pg_tables where tablename like 'checkpoint%' order by 1").fetchall()
    assert rows and all(rls for _, rls in rows), rows
