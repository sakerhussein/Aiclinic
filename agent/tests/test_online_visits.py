"""Online visits, phase 2 (design booking/design/online-visits.html; migrations 0024 and 0025): the WhatsApp assistant and
the web chat book online visits under the clinic's settings, and the "Join the visit" link goes out by itself on WhatsApp
after the clinic confirms, and again in the online-visit reminder. Only the link's hash is ever stored."""

import hashlib
from datetime import datetime, time, timedelta

import pytest

from limitsiz_agent.agent import build_agent, handle_message
from limitsiz_agent.agent.graph import CONSENT_LEAD, consent_note
from limitsiz_agent.agent.prompt import build_system_prompt
from limitsiz_agent.agent.web import build_web_agent, build_web_prompt, run_web_turn
from limitsiz_agent.booking import BookingError, book, clinic_info, find_slots, reschedule
from limitsiz_agent.whatsapp import reminders, visit_links
from test_agent import FakeClaude, msg, text, tool
from test_whatsapp import PNID, FakeWA, make_appointment

from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Amman")
CLINIC = "00000000-0000-4000-8000-000000000001"
LINA = "00000000-0000-4000-8000-0000000000d1"
OMAR = "00000000-0000-4000-8000-0000000000d2"
CONSULT = "00000000-0000-4000-8000-0000000000b1"   # 20 min, both doctors
PEEL = "00000000-0000-4000-8000-0000000000b4"      # 45 min, Dr. Lina only
SUNDAY = datetime(2026, 12, 6).date()
NOW = datetime.combine(SUNDAY, time(8), TZ)
PHONE = "+962791234567"
OTHER = "+962797654321"
SITE = "https://book.example"
CONSENT_EN = "I agree to an online visit on Microsoft Teams."


def at(h, m=0, day=SUNDAY):
    return datetime.combine(day, time(h, m), TZ)


def code_of(fn, *args, **kwargs):
    with pytest.raises(BookingError) as e:
        fn(*args, **kwargs)
    return e.value.code


@pytest.fixture
def online(conn):
    """Online visits on for the demo clinic: the consultation, with Dr. Lina only (Dr. Omar does not take them)."""
    conn.execute("""update online_visits set enabled = true, who_can_book = 'marked', mode = 'audio', link_when = 'confirmed',
                    channels = '{whatsapp,email,print}', default_channel = 'whatsapp', consent_en = %s where clinic_id = %s""",
                 (CONSENT_EN, CLINIC))
    conn.execute("update services set online_allowed = (id = %s) where clinic_id = %s", (CONSULT, CLINIC))
    conn.execute("update doctors set online_enabled = (id = %s), online_min_notice_minutes = 60, teams_link = null where clinic_id = %s",
                 (LINA, CLINIC))
    yield conn
    conn.execute("update online_visits set enabled = false, who_can_book = 'marked', mode = 'audio' where clinic_id = %s", (CLINIC,))
    conn.execute("update services set online_allowed = false where clinic_id = %s", (CLINIC,))
    conn.execute("update doctors set online_enabled = false, online_min_notice_minutes = 60 where clinic_id = %s", (CLINIC,))


def patient(conn, phone=PHONE, marked=True, mode=None):
    return conn.execute("""insert into patients (clinic_id, phone_e164, full_name, preferred_language, whatsapp_reminders, online_allowed, online_mode)
                           values (%s, %s, 'Huda', 'ar', true, %s, %s) returning id::text""", (CLINIC, phone, marked, mode)).fetchone()[0]


def row(conn, appt_id):
    return conn.execute("""select visit_type, online_mode, link_channel, online_consent_at is not null, online_consent_version, link_sent_at
                           from appointments where id = %s""", (appt_id,)).fetchone()


# ---------------------------------------------------------------- free times and booking rules

def test_online_times_follow_the_settings(online):
    conn = online
    conn.execute("update online_visits set enabled = false where clinic_id = %s", (CLINIC,))
    assert code_of(find_slots, conn, CLINIC, CONSULT, visit="online", now=NOW) == "online_visits_off"
    conn.execute("update online_visits set enabled = true where clinic_id = %s", (CLINIC,))
    assert code_of(find_slots, conn, CLINIC, PEEL, visit="online", now=NOW) == "service_not_online"
    assert code_of(find_slots, conn, CLINIC, CONSULT, doctor_id=OMAR, visit="online", now=NOW) == "doctor_not_online"
    slots = find_slots(conn, CLINIC, CONSULT, visit="online", days=3, now=NOW)
    assert slots and {str(s["doctor_id"]) for s in slots} == {LINA}
    # The doctor's earliest online booking comes on top of the clinic's minimum notice (60 minutes here).
    conn.execute("update doctors set online_min_notice_minutes = 240 where id = %s", (LINA,))
    clinic = find_slots(conn, CLINIC, CONSULT, doctor_id=LINA, days=1, now=NOW)
    onl = find_slots(conn, CLINIC, CONSULT, doctor_id=LINA, visit="online", days=1, now=NOW)
    assert clinic[0]["starts_at"] < NOW + timedelta(hours=4) <= onl[0]["starts_at"]
    assert {s["starts_at"] for s in onl} == {s["starts_at"] for s in clinic if s["starts_at"] >= NOW + timedelta(hours=4)}


def test_booking_online_needs_the_clinics_permission(online):
    conn = online
    start = at(10)
    assert code_of(book, conn, CLINIC, OTHER, CONSULT, LINA, start, visit="online", now=NOW) == "online_not_allowed"
    patient(conn, OTHER, marked=False)
    assert code_of(book, conn, CLINIC, OTHER, CONSULT, LINA, start, visit="online", now=NOW) == "online_not_allowed"
    assert conn.execute("select count(*) from appointments").fetchone()[0] == 0
    patient(conn)
    a = book(conn, CLINIC, PHONE, CONSULT, LINA, start, visit="online", online_mode="video", now=NOW)
    version = conn.execute("select consent_version from online_visits where clinic_id = %s", (CLINIC,)).fetchone()[0]
    # The clinic's mode wins unless the patient may choose; the link comes on WhatsApp, where the patient is.
    assert row(conn, a["id"])[:5] == ("online", "audio", "whatsapp", True, version)
    assert a["visit_type"] == "online"
    assert code_of(book, conn, CLINIC, PHONE, CONSULT, OMAR, at(11), visit="online", now=NOW) == "doctor_not_online"
    # "Everyone": a new number may book one.
    conn.execute("update online_visits set who_can_book = 'everyone' where clinic_id = %s", (CLINIC,))
    assert book(conn, CLINIC, "+962790000003", CONSULT, LINA, at(11), visit="online", now=NOW)["visit_type"] == "online"


def test_the_patient_chooses_video_or_audio_when_the_clinic_lets_them(online):
    conn = online
    patient(conn, mode="patient")
    assert code_of(book, conn, CLINIC, PHONE, CONSULT, LINA, at(10), visit="online", now=NOW) == "choose_mode"
    a = book(conn, CLINIC, PHONE, CONSULT, LINA, at(10), visit="online", online_mode="video", now=NOW)
    assert row(conn, a["id"])[1] == "video"


def test_the_doctors_one_time_tick_lets_an_unmarked_patient_book_once(online):
    conn = online
    pid = patient(conn, marked=False)
    last = conn.execute("""insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, status,
                                                     next_online, next_online_mode, next_online_at)
                           values (%s, %s, %s, %s, %s, %s, 'completed', true, 'video', %s) returning id::text""",
                        (CLINIC, LINA, CONSULT, pid, NOW - timedelta(days=7), NOW - timedelta(days=7) + timedelta(minutes=20), NOW)).fetchone()[0]
    a = book(conn, CLINIC, PHONE, CONSULT, LINA, at(10), visit="online", now=NOW)
    assert row(conn, a["id"])[1] == "video", "the tick's mode"
    assert conn.execute("select next_online_used_by::text from appointments where id = %s", (last,)).fetchone()[0] == str(a["id"])
    assert code_of(book, conn, CLINIC, PHONE, CONSULT, LINA, at(11), visit="online", now=NOW) == "online_not_allowed", "used up"


def test_an_online_visit_moves_under_the_online_rules_and_will_be_told_again(online):
    conn = online
    patient(conn)
    a = book(conn, CLINIC, PHONE, CONSULT, LINA, at(16), visit="online", now=NOW)
    conn.execute("update appointments set status = 'confirmed', link_sent_at = %s where id = %s", (NOW, a["id"]))
    conn.execute("update doctors set online_min_notice_minutes = 600 where id = %s", (LINA,))
    assert code_of(reschedule, conn, CLINIC, PHONE, a["id"], at(17), now=NOW) == "inside_online_notice"
    conn.execute("update doctors set online_min_notice_minutes = 60 where id = %s", (LINA,))
    moved = reschedule(conn, CLINIC, PHONE, a["id"], at(17), now=NOW)
    assert moved["visit_type"] == "online" and moved["status"] == "booked"
    assert row(conn, a["id"])[5] is None, "a new time clears the sent mark, so the link goes out again once confirmed"


# ---------------------------------------------------------------- what the assistants know

def test_the_prompts_tell_online_visits_only_when_they_are_on(conn, online):
    info = clinic_info(conn, CLINIC)
    assert info["online"]["consent_en"] == CONSENT_EN and "teams_link" not in str(info)
    p = build_system_prompt(info)
    assert "Online visits (Microsoft Teams)" in p and "also online" in p and "Takes online visits, booked at least 1 hour ahead." in p
    assert "Never give or invent a Teams address" in p
    w = build_web_prompt(info)
    assert "Online visits (Microsoft Teams)" in w and "propose_booking" in w
    conn.execute("update online_visits set enabled = false where clinic_id = %s", (CLINIC,))
    off = clinic_info(conn, CLINIC)
    assert off["online"] is None
    assert "Online visits (Microsoft Teams)" not in build_system_prompt(off) + build_web_prompt(off)
    assert "also online" not in build_system_prompt(off) and "Takes online visits" not in build_system_prompt(off)


def test_consent_note_only_for_an_online_booking_waiting_for_yes(conn, online):
    info = clinic_info(conn, CLINIC)
    wait = {"tool": "book_appointment", "args": {"visit": "online"}}
    assert consent_note(wait, info, "en") == f"{CONSENT_LEAD['en']}\n_{CONSENT_EN}_"
    assert info["online"]["consent_ar"] in consent_note(wait, info, "ar")
    assert consent_note({"tool": "book_appointment", "args": {}}, info, "en") is None
    assert consent_note({"tool": "cancel_appointment", "args": {"visit": "online"}}, info, "en") is None
    assert consent_note(None, info, "en") is None


def test_whatsapp_books_an_online_visit_with_the_consent_in_the_yes_message(conn, online):
    patient(conn)
    fake = FakeClaude(
        msg(tool("book_appointment", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="10:00", visit="online"), stop="tool_use"),
        msg(text("An online follow-up with Dr. Lina, Sunday 06/12 at *10:00*. Shall I book it?")),
        msg(text("Done, it's booked. The Join link comes on WhatsApp once the clinic confirms.")),
    )
    graph = build_agent(conn, fake, now=lambda: NOW)
    reply = handle_message(graph, CLINIC, PHONE, "I'd like an online follow-up today at 10")
    assert reply.startswith("An online follow-up") and reply.endswith(f"{CONSENT_LEAD['en']}\n_{CONSENT_EN}_")
    assert conn.execute("select count(*) from appointments").fetchone()[0] == 0, "nothing before the yes"
    handle_message(graph, CLINIC, PHONE, "yes")
    (appt,) = conn.execute("select id from appointments").fetchall()
    assert row(conn, appt[0])[:4] == ("online", "audio", "whatsapp", True)
    # The consent stays in the conversation history the model sees next time.
    assert any(b.get("text", "").startswith(CONSENT_LEAD["en"]) for m in fake.calls[-1]["messages"] if m["role"] == "assistant"
               for b in (m["content"] if isinstance(m["content"], list) else []))


def test_the_web_chat_proposes_an_online_visit(conn, online):
    fake = FakeClaude(
        msg(tool("propose_booking", service_id=CONSULT, doctor_id=LINA, date="2026-12-06", time="10:00", visit="online"), stop="tool_use"),
        msg(text("Check the card, tick the consent and press Yes.")),
        msg(tool("propose_booking", service_id=PEEL, doctor_id=LINA, date="2026-12-06", time="10:00", visit="online"), stop="tool_use"),
        msg(text("That one is only at the clinic.")),
    )
    graph = build_web_agent(conn, fake, now=lambda: NOW)
    out = run_web_turn(graph, CLINIC, "22222222-2222-4222-8222-222222222222", "online follow-up at 10 please")
    assert out["proposal"]["visitType"] == "online" and out["proposal"]["summary"].startswith("Online visit: ")
    out = run_web_turn(graph, CLINIC, "22222222-2222-4222-8222-222222222222", "and a peel online?")
    assert out["proposal"] is None and "service_not_online" in fake.calls[-1]["messages"][-1]["content"][0]["content"]


# ---------------------------------------------------------------- the link, by itself on WhatsApp

def online_booking(conn, start, status="confirmed", channel="whatsapp", created=None):
    a = make_appointment(conn, start, created or NOW - timedelta(days=2), status=status)
    conn.execute("update appointments set visit_type = 'online', online_mode = 'audio', link_channel = %s where id = %s", (channel, a))
    conn.execute("update patients set online_allowed = true where phone_e164 = %s", (PHONE,))
    return a


def link_rows(conn, appt):
    return conn.execute("select token_hash, channel, auto, sent_by, stopped_at from join_links where appointment_id = %s order by sent_at, id",
                        (appt,)).fetchall()


def token_of(link):
    assert link.startswith(f"{SITE}/demo-derma/j#")
    return link.split("#", 1)[1]


def test_the_visit_link_goes_once_the_clinic_confirms_and_again_for_a_new_time(conn, online):
    conn.execute("update clinics set wa_phone_number_id = %s where id = %s", (PNID, CLINIC))
    wa = FakeWA()
    waiting = online_booking(conn, at(17), status="booked")
    by_email = online_booking(conn, at(18), channel="email")
    a = online_booking(conn, at(16, 20))
    assert visit_links.send_due_visit_links(conn, wa, "visit_link", NOW, SITE) == 1
    (_, to, name, lang, params, payloads), = wa.sent
    assert (to, name, lang, payloads) == (PHONE, "visit_link", "ar", [])
    assert params[0] == "عيادة Limitsiz التجريبية للجلدية" and params[1] == "د. لينا حداد"
    (h, channel, auto, by, stopped), = link_rows(conn, a)
    assert (channel, auto, by, stopped) == ("whatsapp", "confirmed", None, None)
    assert h == hashlib.sha256(token_of(params[3]).encode()).hexdigest(), "only the hash is kept"
    assert visit_links.send_due_visit_links(conn, wa, "visit_link", NOW, SITE) == 0, "never twice for one time"
    assert not link_rows(conn, waiting) and not link_rows(conn, by_email)
    # The clinic moves it: confirmed again at the new time, the patient is told again.
    conn.execute("update appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = %s", (a,))
    assert visit_links.send_due_visit_links(conn, wa, "visit_link", NOW, SITE) == 1
    # Sent on booking when the clinic chose that; never once the WhatsApp channel or online visits are off.
    conn.execute("update online_visits set channels = '{email,print}', default_channel = 'email' where clinic_id = %s", (CLINIC,))
    conn.execute("update online_visits set link_when = 'booked' where clinic_id = %s", (CLINIC,))
    assert visit_links.send_due_visit_links(conn, wa, "visit_link", NOW, SITE) == 0
    conn.execute("update online_visits set channels = '{whatsapp,email,print}' where clinic_id = %s", (CLINIC,))
    assert visit_links.send_due_visit_links(conn, wa, "visit_link", NOW, SITE) == 1 and link_rows(conn, waiting)


def test_a_visit_link_that_fails_is_stopped_and_not_sent_again(conn, online):
    conn.execute("update clinics set wa_phone_number_id = %s where id = %s", (PNID, CLINIC))

    class Broken(FakeWA):
        def send_template(self, *a):
            raise RuntimeError("Meta said no")
    a = online_booking(conn, at(16, 20))
    assert visit_links.send_due_visit_links(conn, Broken(), "visit_link", NOW, SITE) == 0
    (_, _, _, _, stopped), = link_rows(conn, a)
    assert stopped is not None
    assert visit_links.send_due_visit_links(conn, FakeWA(), "visit_link", NOW, SITE) == 0


def test_the_online_reminder_carries_a_new_join_link(conn, online):
    conn.execute("update clinics set wa_phone_number_id = %s where id = %s", (PNID, CLINIC))
    wa = FakeWA()
    a = online_booking(conn, NOW + timedelta(hours=20), status="booked")
    assert reminders.send_due_reminders(conn, wa, "appointment_reminder", NOW, "online_reminder", SITE) == 1
    (_, _, name, _, params, payloads), = wa.sent
    assert name == "online_reminder" and len(params) == 5 and payloads == [f"REMIND_CONFIRM:{a}", f"REMIND_CHANGE:{a}"]
    (h, channel, auto, _, _), = link_rows(conn, a)
    assert (channel, auto) == ("whatsapp", "reminder") and h == hashlib.sha256(token_of(params[4]).encode()).hexdigest()


def test_without_the_online_template_an_online_visit_gets_the_usual_reminder(conn, online):
    conn.execute("update clinics set wa_phone_number_id = %s where id = %s", (PNID, CLINIC))
    wa = FakeWA()
    a = online_booking(conn, NOW + timedelta(hours=20), status="booked")
    assert reminders.send_due_reminders(conn, wa, "appointment_reminder", NOW) == 1
    assert wa.sent[0][2] == "appointment_reminder" and len(wa.sent[0][4]) == 4 and not link_rows(conn, a)


def test_the_templates_never_start_or_end_with_a_variable():
    for t in (visit_links.template_text("{clinic}: your online visit with {doctor} on {when}. Join: {link}", "{clinic}: {link}"),
              reminders.online_template_text()):
        for v in t.values():
            assert not v["body"].startswith("{{") and not v["body"].rstrip().endswith("}}")
