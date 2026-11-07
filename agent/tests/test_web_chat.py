"""The assistant on the online booking page (agent/web.py, web_chat.py) with a scripted Claude: it can only propose
bookings, never sees a phone number, never reaches existing bookings, and the page's events reach it."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from limitsiz_agent import web_chat
from limitsiz_agent.agent.web import WEB_TOOLS, build_web_agent, build_web_prompt, run_web_turn
from limitsiz_agent.booking import clinic_info
from test_agent import CLINIC, CONSULT, LINA, NOW, FakeClaude, msg, text, tool

CHAT = "11111111-1111-4111-8111-111111111111"


@pytest.fixture
def web(conn):
    def make(*responses):
        fake = FakeClaude(*responses)
        return build_web_agent(conn, fake, now=lambda: NOW), fake
    return make


def test_only_booking_tools_and_web_rules(conn):
    names = {t["name"] for t in WEB_TOOLS}
    assert names == {"find_available_times", "propose_booking", "request_call_back", "show_buttons"}
    assert not names & {"list_my_appointments", "cancel_appointment", "reschedule_appointment", "book_appointment"}
    p = build_web_prompt(clinic_info(conn, CLINIC))
    assert "cannot see, move or cancel existing appointments" in p and "Never ask for the patient's name or phone" in p
    assert "Clinic details" in p and "WhatsApp booking assistant" not in p


def test_propose_shows_a_card_and_books_nothing(conn, web):
    graph, fake = web(
        msg(tool("find_available_times", service_id=CONSULT, date_from="2026-12-06", days=1), stop="tool_use"),
        msg(tool("show_buttons", labels=["10:00", "10:20"]), text("Dr. Lina has 10:00 or 10:20."), stop="tool_use"),
        msg(text("Dr. Lina has 10:00 or 10:20 today.")),
        msg(tool("propose_booking", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="10:00"), stop="tool_use"),
        msg(text("Please check the card and press Yes.")),
    )
    before = conn.execute("select count(*) from appointments").fetchone()[0]
    out = run_web_turn(graph, CLINIC, CHAT, "I'd like a consultation today")
    assert out["buttons"] == ["10:00", "10:20"] and out["proposal"] is None
    out = run_web_turn(graph, CLINIC, CHAT, "10:00")
    p = out["proposal"]
    assert p["serviceId"] == CONSULT and p["doctorId"] == LINA
    assert datetime.fromisoformat(p["startsAt"]) == NOW + timedelta(hours=2)
    assert out["buttons"] is None, "buttons belong to the turn that showed them"
    assert conn.execute("select count(*) from appointments").fetchone()[0] == before, "nothing is booked by the AI"
    # No phone number reaches Claude: the tools have no field for one, and the page's events carry none.
    fields = {f for t in WEB_TOOLS for f in t["input_schema"]["properties"]}
    assert not any("phone" in f or "name" in f for f in fields), fields


def test_a_busy_time_is_refused_and_events_reach_the_assistant(conn, web):
    graph, fake = web(
        msg(tool("propose_booking", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="10:05"), stop="tool_use"),
        msg(text("That time isn't free.")),
        msg(text("Your booking is in.")),
    )
    out = run_web_turn(graph, CLINIC, CHAT, "10:05 please")
    assert out["proposal"] is None
    result = fake.calls[1]["messages"][-1]["content"][0]
    assert result.get("is_error") and "slot_not_available" in result["content"]
    run_web_turn(graph, CLINIC, CHAT, "done?", events=["The booking was made: Consultation, Sunday 10:00."])
    notes = [m for m in fake.calls[2]["messages"] if m["role"] == "system"]
    assert "On the page: The booking was made" in notes[-1]["content"]


def test_call_back_and_emergency(conn, web):
    graph, fake = web(msg(tool("request_call_back", reason="medical_question", summary="Asks about a cream in pregnancy."), stop="tool_use"),
                      msg(text("Leave your number and the clinic will call you.")))
    out = run_web_turn(graph, CLINIC, CHAT, "Is this cream safe in pregnancy?")
    assert out["callback"] == {"reason": "medical_question", "summary": "Asks about a cream in pregnancy."}
    out = run_web_turn(graph, CLINIC, CHAT, "I have chest pain and can't breathe")
    assert out["emergency"] and "911" in out["reply"] and len(fake.calls) == 2, "no AI for an emergency"


def test_turn_endpoint_needs_the_secret(db_url, monkeypatch):
    from limitsiz_agent import server
    env = {"DATABASE_URL": db_url, "ANTHROPIC_API_KEY": "x", "STAFF_PASSWORD": "x", "REMINDERS_ENABLED": "false",
           "WEB_CHAT_SECRET": "s" * 40}
    app = server.create_app(env)
    calls = []
    monkeypatch.setattr(server, "build_web_agent", lambda *a, **k: "graph")
    monkeypatch.setattr(server, "open_checkpointer", lambda url: None)
    monkeypatch.setattr(server, "run_web_turn", lambda g, c, ch, t, e: calls.append((c, ch, t, e)) or
                        {"reply": "hi", "buttons": None, "proposal": None, "callback": None, "emergency": False, "language": "en"})
    with TestClient(app) as http:
        body = {"clinic_id": CLINIC, "chat_id": CHAT, "text": "hello", "events": ["x"]}
        assert http.post("/web/turn", json=body).status_code == 401
        assert http.post("/web/turn", json=body, headers={"x-web-secret": "wrong"}).status_code == 401
        r = http.post("/web/turn", json=body, headers={"x-web-secret": "s" * 40})
        assert r.status_code == 200 and r.json()["reply"] == "hi" and calls == [(CLINIC, CHAT, "hello", ["x"])]
    env["WEB_CHAT_SECRET"] = ""
    with TestClient(server.create_app(env)) as http:
        assert http.post("/web/turn", json=body, headers={"x-web-secret": ""}).status_code == 503


def test_callbacks_are_emailed_once_and_old_chats_forgotten(conn, monkeypatch):
    conn.execute("delete from web_callbacks; delete from web_chats")
    chat = conn.execute("insert into web_chats (clinic_id, ip, last_at) values (%s, '203.0.113.5', %s) returning id::text",
                        (CLINIC, NOW - timedelta(days=40))).fetchone()[0]
    conn.execute("insert into web_callbacks (clinic_id, chat_id, kind, reason, summary, full_name, phone_e164) values (%s, %s, 'call_back', 'complaint', 'Unhappy', 'Sara', '+962791234567')",
                 (CLINIC, chat))
    web_chat.record_emergency(conn, CLINIC, chat, "chest pain")
    sent = []

    class FakeSMTP:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def login(self, *a): pass
        def starttls(self): pass
        def send_message(self, m): sent.append(m)
    monkeypatch.setattr(web_chat.smtplib, "SMTP_SSL", FakeSMTP)
    smtp = {"host": "smtp.example", "port": "465", "user": "u", "password": "p", "sender": "a@example.com"}
    assert web_chat.alert_web_callbacks(conn, smtp, "clinic@example.com") == 2
    assert web_chat.alert_web_callbacks(conn, smtp, "clinic@example.com") == 0
    subjects = sorted(m["Subject"] for m in sent)
    assert subjects[0].startswith("Complaint") and subjects[1].startswith("POSSIBLE EMERGENCY")
    assert "+962791234567" in sent[[m["Subject"] for m in sent].index(subjects[0])].get_content()
    assert web_chat.forget_old_chats(conn, NOW - timedelta(days=20)) == 0          # 20 days old: kept (30 by default)
    assert web_chat.forget_old_chats(conn, NOW) == 1
    assert conn.execute("select count(*) from web_chats").fetchone()[0] == 0
    assert conn.execute("select count(*) from web_callbacks").fetchone()[0] == 0
