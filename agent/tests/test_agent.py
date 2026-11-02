"""The agent graph, end to end on the test database, with a scripted stand-in for Claude (no API calls)."""

import copy
import json
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import anthropic
import httpx
import pytest
from anthropic.types.beta import BetaMessage

from limitsiz_agent.agent import build_agent, handle_message
from limitsiz_agent.agent.graph import PASSED_TO_TEAM, SORRY
from limitsiz_agent.agent.safety import confirmation_answer, is_emergency
from limitsiz_agent.agent.tools import TOOLS

TZ = ZoneInfo("Asia/Amman")
CLINIC = "00000000-0000-4000-8000-000000000001"
LINA = "00000000-0000-4000-8000-0000000000d1"
CONSULT = "00000000-0000-4000-8000-0000000000b1"
NOW = datetime.combine(date(2026, 12, 6), time(8), TZ)  # Sunday 08:00
PHONE = "+962791234567"


# ---------------------------------------------------------------- scripted Claude

def msg(*blocks, stop="end_turn"):
    return BetaMessage.model_validate({
        "id": "msg_test", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
        "content": list(blocks), "stop_reason": stop, "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 10},
    })


def text(t):
    return {"type": "text", "text": t}


def thinking(sig):
    return {"type": "thinking", "thinking": "", "signature": sig}


_n = 0


def tool(name, **inp):
    global _n
    _n += 1
    return {"type": "tool_use", "id": f"toolu_{_n}", "name": name, "input": inp}


class FakeClaude:
    """Returns scripted responses in order and records every request."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[dict] = []
        self.beta = self
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(copy.deepcopy(kwargs))
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture
def run(conn):
    """run(fake, text) -> reply, with one agent (and conversation memory) per test."""
    graphs = {}

    def _run(fake, inbound, phone=PHONE):
        if id(fake) not in graphs:
            graphs[id(fake)] = build_agent(conn, fake, now=lambda: NOW)
        return handle_message(graphs[id(fake)], CLINIC, phone, inbound)
    return _run


def appointments(conn):
    return conn.execute("select starts_at, doctor_id::text, status::text from appointments order by starts_at").fetchall()


def tool_results(call):
    return [b for b in call["messages"][-1]["content"] if b.get("type") == "tool_result"]


def check_conversation(messages):
    """The rules the Messages API enforces on a history."""
    assert messages[0]["role"] == "user"
    for i, m in enumerate(messages):
        if m["role"] == "system":
            assert messages[i - 1]["role"] == "user", "a system message must follow a user message"
            assert i == len(messages) - 1 or messages[i + 1]["role"] == "assistant"
        if m["role"] == "assistant":
            uses = [b["id"] for b in m["content"] if b.get("type") == "tool_use"]
            if uses:
                nxt = messages[i + 1]
                assert nxt["role"] == "user"
                assert [b["tool_use_id"] for b in nxt["content"] if b["type"] == "tool_result"] == uses


def check_append_only(fake):
    for a, b in zip(fake.calls, fake.calls[1:]):
        assert b["messages"][: len(a["messages"])] == a["messages"], "history was edited"


# ---------------------------------------------------------------- booking with confirmation

def test_booking_waits_for_yes_then_books(conn, run):
    fake = FakeClaude(
        msg(thinking("sig-1"), tool("find_available_times", service_id=CONSULT, date_from="2026-12-06", days=1), stop="tool_use"),
        msg(tool("book_appointment", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="10:00", patient_name="Sara"), stop="tool_use"),
        msg(text("موعدك: استشارة جلدية مع د. لينا، الأحد 6/12 الساعة 10:00. هل تؤكدين؟ ردّي بنعم")),
        msg(text("تم تأكيد موعدك ✅")),
    )
    reply = run(fake, "مرحبا، بدي موعد استشارة اليوم الساعة 10 مع دكتورة لينا، اسمي سارة")
    assert reply.startswith("موعدك")
    assert appointments(conn) == []  # nothing booked before the yes

    found = json.loads(tool_results(fake.calls[1])[0]["content"])
    lina = next(d for d in found["days"][0]["doctors"] if d["doctor_id"] == LINA)
    assert "10:00" in lina["times"]
    held = json.loads(tool_results(fake.calls[2])[0]["content"])
    assert held["status"] == "waiting_for_patient_confirmation"
    assert held["will_do"]["appointment"]["time"] == "10:00"

    assert run(fake, "نعم") == "تم تأكيد موعدك ✅"
    assert appointments(conn) == [(datetime.combine(date(2026, 12, 6), time(10), TZ), LINA, "booked")]
    assert conn.execute("select full_name from patients").fetchone()[0] == "Sara"
    last = fake.calls[3]["messages"]
    assert last[-1]["role"] == "system" and "The patient confirmed. book_appointment was done" in last[-1]["content"]

    # The thinking block went back unchanged, and the history was only ever appended to.
    assert fake.calls[1]["messages"][2]["content"][0] == {"type": "thinking", "thinking": "", "signature": "sig-1"}
    check_append_only(fake)
    check_conversation(last)


@pytest.mark.parametrize("answer, note", [
    ("لا", "The patient said no"),
    ("actually what are your prices?", "The patient did not confirm"),
])
def test_no_or_other_reply_books_nothing(conn, run, answer, note):
    fake = FakeClaude(
        msg(tool("book_appointment", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="10:00"), stop="tool_use"),
        msg(text("Confirm consultation Sunday 10:00? Reply yes.")),
        msg(text("OK.")),
    )
    run(fake, "book me a consultation today at 10 with Dr Lina")
    run(fake, answer)
    assert appointments(conn) == []
    assert note in fake.calls[2]["messages"][-1]["content"]
    run_again = fake.calls[2]["messages"]
    check_conversation(run_again)


def test_unavailable_time_is_refused_before_asking(conn, run):
    fake = FakeClaude(
        msg(tool("book_appointment", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="10:05"), stop="tool_use"),
        msg(text("That time is not available.")),
        msg(text("OK.")),
    )
    run(fake, "consultation at 10:05 please")
    r = tool_results(fake.calls[1])[0]
    assert r["is_error"] and json.loads(r["content"])["error"] == "slot_unavailable"
    run(fake, "yes")  # nothing was waiting, so a yes changes nothing
    assert appointments(conn) == []
    assert "did not confirm" not in fake.calls[2]["messages"][-1]["content"]


def test_slot_taken_between_question_and_yes(conn, run):
    fake = FakeClaude(
        msg(tool("book_appointment", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="10:00"), stop="tool_use"),
        msg(text("Confirm 10:00? Reply yes.")),
        msg(text("Sorry, that time was just taken.")),
    )
    run(fake, "consultation 10:00 Dr Lina")
    other = FakeClaude(
        msg(tool("book_appointment", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="10:00"), stop="tool_use"),
        msg(text("Confirm?")), msg(text("Done.")),
    )
    run(other, "10:00 please", phone="+962797654321")
    run(other, "yes", phone="+962797654321")
    run(fake, "yes")
    assert len(appointments(conn)) == 1
    assert "could not be done (slot_unavailable)" in fake.calls[2]["messages"][-1]["content"]


def test_patient_cannot_pass_another_phone(conn, run):
    fake = FakeClaude(
        msg(tool("list_my_appointments", phone="+962700000000"), stop="tool_use"),
        msg(text("...")),
    )
    run(fake, "show my appointments")
    r = tool_results(fake.calls[1])[0]
    assert r["is_error"] and "unknown fields: phone" in json.loads(r["content"])["detail"]


def test_two_changes_in_one_response(conn, run):
    fake = FakeClaude(
        msg(tool("book_appointment", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="10:00"),
            tool("book_appointment", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="11:00"), stop="tool_use"),
        msg(text("Confirm 10:00?")),
        msg(text("Booked.")),
    )
    run(fake, "book 10 and 11")
    first, second = tool_results(fake.calls[1])
    assert not first.get("is_error") and json.loads(second["content"])["error"] == "one_change_at_a_time"
    run(fake, "yes")
    assert [a[0].hour for a in appointments(conn)] == [10]


# ---------------------------------------------------------------- safety and hand-off

def test_emergency_gets_fixed_reply_and_staff(conn, run):
    fake = FakeClaude()
    reply = run(fake, "عندي ضيق تنفس شديد بعد الإبرة")
    assert "911" in reply and fake.calls == []
    assert conn.execute("select reason from handoffs").fetchall() == [("emergency",)]
    assert run(fake, "hello?") is None  # staff are handling it now; the AI stays quiet
    assert fake.calls == []


def test_hand_off_tool_then_silence_until_staff_hand_back(conn, run):
    fake = FakeClaude(
        msg(tool("hand_off_to_staff", reason="complaint", summary="Unhappy with last visit"), stop="tool_use"),
        msg(text("I've passed this to the team.")),
        msg(text("Welcome back! How can I help?")),
    )
    assert run(fake, "I want to complain") == "I've passed this to the team."
    assert run(fake, "anyone there?") is None
    conn.execute("update conversations set status = 'active'")  # staff hand it back (step 7)
    assert run(fake, "can I book?") == "Welcome back! How can I help?"
    check_conversation(fake.calls[-1]["messages"])


def test_too_many_tool_rounds_goes_to_staff(conn, run):
    fake = FakeClaude(*[msg(tool("list_my_appointments"), stop="tool_use") for _ in range(7)])
    assert run(fake, "hi") == PASSED_TO_TEAM["en"]
    assert len(fake.calls) == 7
    assert conn.execute("select reason from handoffs").fetchall() == [("agent_unsure",)]


def test_api_error_and_refusal_still_answer_and_keep_history_valid(conn, run):
    err = anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))
    fake = FakeClaude(err, msg(stop="refusal"), msg(text("مرحبا! كيف أساعدك؟")))
    assert run(fake, "مرحبا") == SORRY["ar"]
    assert run(fake, "مرحبا") == SORRY["ar"]
    assert run(fake, "مرحبا") == "مرحبا! كيف أساعدك؟"
    check_conversation(fake.calls[-1]["messages"])


# ---------------------------------------------------------------- request shape

def test_request_settings_and_stable_prefix(conn, run):
    fake = FakeClaude(msg(text("Hello!")), msg(text("Sure.")))
    run(fake, "hi")
    run(fake, "thanks")
    a, b = fake.calls
    assert a["model"] == "claude-opus-5-5" and a["output_config"] == {"effort": "medium"}
    assert a["fallbacks"] == "default" and a["betas"] == ["server-side-fallback-2026-07-01"]
    assert a["cache_control"] == {"type": "ephemeral"} and a["tools"] == TOOLS
    assert a["system"] == b["system"] and "د. لينا حداد" in a["system"] and "Current time" not in a["system"]
    assert "first message" in a["messages"][1]["content"] and "first message" not in b["messages"][-1]["content"]
    assert "Sunday 2026-12-06 08:00" in a["messages"][1]["content"]
    check_append_only(fake)


# ---------------------------------------------------------------- safety helpers

@pytest.mark.parametrize("t, expected", [
    ("نعم", "yes"), ("نعم تمام", "yes"), ("أكيد!", "yes"), ("اي", "yes"), ("Yes please", "yes"), ("ok", "yes"),
    ("👍", "yes"), ("CONFIRM_YES", "yes"), ("لا", "no"), ("لا شكراً", "no"), ("no", "no"), ("CONFIRM_NO", "no"),
    ("نعم بس خليها الساعة 11", None), ("yes but at 11", None), ("what time?", None), ("", None),
])
def test_confirmation_answer(t, expected):
    assert confirmation_answer(t) == expected


@pytest.mark.parametrize("t, expected", [
    ("عندي ألم في الصدر", True), ("I can't breathe", True), ("my throat is swelling after the peel", True),
    ("بدي موعد ليزر", False), ("is the chemical peel painful?", False),
])
def test_emergency_words(t, expected):
    assert is_emergency(t) is expected
