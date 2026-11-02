from datetime import date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest

from limitsiz_agent.booking import (
    BookingError, book, cancel, clinic_info, find_slots, hand_off, my_appointments, normalize_phone, reschedule,
)
from limitsiz_agent.booking import service as booking_service

TZ = ZoneInfo("Asia/Amman")
CLINIC = UUID("00000000-0000-4000-8000-000000000001")
LINA = UUID("00000000-0000-4000-8000-0000000000d1")
OMAR = UUID("00000000-0000-4000-8000-0000000000d2")
CONSULT = UUID("00000000-0000-4000-8000-0000000000b1")  # 20 min, both doctors
PEEL = UUID("00000000-0000-4000-8000-0000000000b4")  # 45 min, Dr. Lina only
SUNDAY = date(2026, 12, 6)
NOW = datetime.combine(SUNDAY, time(8), TZ)
PHONE = "+962791234567"
OTHER = "+962797654321"


def at(h, m=0, day=SUNDAY):
    return datetime.combine(day, time(h, m), TZ)


def code_of(fn, *args, **kwargs):
    with pytest.raises(BookingError) as e:
        fn(*args, **kwargs)
    return e.value.code


def book_at(conn, start, phone=PHONE, doctor=LINA, service=CONSULT, now=NOW, **kw):
    return book(conn, CLINIC, phone, service, doctor, start, now=now, **kw)


# ---------------------------------------------------------------- phone numbers

@pytest.mark.parametrize("raw", ["+962791234567", "+962 79 123 4567", "00962791234567", "962791234567", "0791234567"])
def test_phone_formats(raw):
    assert normalize_phone(raw) == PHONE


@pytest.mark.parametrize("raw", ["", "abc", "+0791234567", "12"])
def test_bad_phone(raw):
    assert code_of(normalize_phone, raw) == "invalid_phone"


# ---------------------------------------------------------------- reading

def test_clinic_info(conn):
    info = clinic_info(conn, CLINIC)
    assert info["name_ar"] == "عيادة Limitsiz التجريبية للجلدية"
    assert len(info["services"]) == 5 and len(info["faqs"]) == 5
    doctors = {d["name_en"]: d for d in info["doctors"]}
    assert len(doctors["Dr. Omar Khalil"]["service_ids"]) == 3
    assert len(doctors["Dr. Lina Haddad"]["hours"]) == 12
    assert {"weekday": 0, "start": "16:00", "end": "19:00"} in doctors["Dr. Lina Haddad"]["hours"]


def test_find_slots_all_doctors_and_filters(conn):
    s = find_slots(conn, CLINIC, CONSULT, date_from=SUNDAY, days=1, now=NOW)
    assert {x["doctor_id"] for x in s} == {LINA, OMAR}
    assert s[0]["starts_at"] == at(10) and s[0]["ends_at"] == at(10, 20)
    assert [x["starts_at"] for x in s] == sorted(x["starts_at"] for x in s)
    assert {x["doctor_id"] for x in find_slots(conn, CLINIC, CONSULT, date_from=SUNDAY, days=1, gender="f", now=NOW)} == {LINA}
    assert {x["doctor_id"] for x in find_slots(conn, CLINIC, PEEL, date_from=SUNDAY, days=1, now=NOW)} == {LINA}


def test_find_slots_errors(conn):
    assert code_of(find_slots, conn, CLINIC, PEEL, doctor_id=OMAR, now=NOW) == "doctor_does_not_offer_service"
    assert code_of(find_slots, conn, CLINIC, "00000000-0000-4000-8000-0000000000ff", now=NOW) == "unknown_service"
    assert code_of(find_slots, conn, "00000000-0000-4000-8000-0000000000ff", CONSULT, now=NOW) == "unknown_clinic"


def test_find_slots_respects_notice_window_and_closed_days(conn):
    s = find_slots(conn, CLINIC, CONSULT, date_from=SUNDAY, days=1, now=at(11, 5))
    assert min(x["starts_at"] for x in s) == at(12, 15)  # 1 hour notice, on the 15-minute grid
    friday = SUNDAY + timedelta(days=5)
    assert find_slots(conn, CLINIC, CONSULT, date_from=friday, days=1, now=NOW) == []
    far = find_slots(conn, CLINIC, CONSULT, date_from=SUNDAY, days=60, now=NOW)
    assert max(x["starts_at"] for x in far) <= NOW + timedelta(days=30)
    past = find_slots(conn, CLINIC, CONSULT, date_from=SUNDAY - timedelta(days=3), days=1, now=NOW)
    assert past and min(x["starts_at"] for x in past) >= at(10)  # never offers the past


def test_time_off_blocks_slots(conn):
    conn.execute("insert into time_off (clinic_id, doctor_id, starts_at, ends_at) values (%s, %s, %s, %s)",
                 (CLINIC, LINA, at(10), at(14)))
    s = find_slots(conn, CLINIC, CONSULT, date_from=SUNDAY, days=1, doctor_id=LINA, now=NOW)
    assert s[0]["starts_at"] == at(16)
    conn.execute("insert into time_off (clinic_id, starts_at, ends_at) values (%s, %s, %s)",
                 (CLINIC, at(0), at(0, day=SUNDAY + timedelta(days=1))))
    assert find_slots(conn, CLINIC, CONSULT, date_from=SUNDAY, days=1, now=NOW) == []


# ---------------------------------------------------------------- booking

def test_book_and_slot_disappears(conn):
    a = book_at(conn, at(10), full_name="Sara", language="ar")
    assert a["status"] == "booked" and a["ends_at"] == at(10, 20)
    assert a["doctor_name_en"] == "Dr. Lina Haddad" and a["service_name_ar"] == "استشارة جلدية"
    lina = find_slots(conn, CLINIC, CONSULT, date_from=SUNDAY, days=1, doctor_id=LINA, now=NOW)
    assert at(10) not in [x["starts_at"] for x in lina] and at(10, 15) not in [x["starts_at"] for x in lina]
    assert at(10, 30) in [x["starts_at"] for x in lina]
    assert code_of(book_at, conn, at(10), phone=OTHER) == "slot_unavailable"


@pytest.mark.parametrize("start, code", [
    (at(10, 5), "slot_unavailable"),                      # not on the 15-minute grid
    (at(14), "slot_unavailable"),                         # lunch break
    (at(13, 45), "slot_unavailable"),                     # would run past 14:00
    (at(8, 30), "too_soon"),                              # less than 1 hour notice
    (at(10, day=SUNDAY + timedelta(days=40)), "outside_booking_window"),
    (at(10, day=SUNDAY + timedelta(days=5)), "slot_unavailable"),  # Friday
])
def test_book_rejects_bad_times(conn, start, code):
    assert code_of(book_at, conn, start) == code


def test_book_rejects_naive_time_and_wrong_doctor(conn):
    assert code_of(book_at, conn, datetime(2026, 12, 6, 10)) == "invalid_time"
    assert code_of(book_at, conn, at(12), doctor=OMAR, service=PEEL) == "doctor_does_not_offer_service"


def test_race_for_the_same_slot_is_caught_by_the_database(conn, monkeypatch):
    book_at(conn, at(10))
    # Pretend the second request checked before the first was saved: the database still refuses it.
    monkeypatch.setattr(booking_service, "_check_slot", lambda *a, **k: None)
    assert code_of(book_at, conn, at(10, 10), phone=OTHER) == "slot_taken"
    assert len(my_appointments(conn, CLINIC, OTHER, now=NOW)) == 0


def test_patient_found_by_any_phone_format_and_name_kept(conn):
    book_at(conn, at(10), phone="0791234567", full_name="Sara")
    book_at(conn, at(11), phone="+962 79 123 4567")
    mine = my_appointments(conn, CLINIC, "00962791234567", now=NOW)
    assert [a["starts_at"] for a in mine] == [at(10), at(11)]
    assert conn.execute("select full_name from patients").fetchall() == [("Sara",)]


def test_patient_cannot_be_in_two_places(conn):
    book_at(conn, at(12), doctor=LINA)
    assert code_of(book_at, conn, at(12, 15), doctor=OMAR) == "patient_busy"


def test_upcoming_limit(conn):
    for h in (10, 11, 12):
        book_at(conn, at(h))
    assert code_of(book_at, conn, at(13)) == "too_many_upcoming"


# ---------------------------------------------------------------- cancel and reschedule

def test_cancel_frees_the_slot(conn):
    a = book_at(conn, at(10))
    assert code_of(cancel, conn, CLINIC, OTHER, a["id"], now=NOW) == "not_found"  # not your appointment
    c = cancel(conn, CLINIC, PHONE, a["id"], reason="travel", now=NOW)
    assert c["status"] == "cancelled"
    assert my_appointments(conn, CLINIC, PHONE, now=NOW) == []
    assert code_of(cancel, conn, CLINIC, PHONE, a["id"], now=NOW) == "not_active"
    assert book_at(conn, at(10), phone=OTHER)["status"] == "booked"


def test_cancel_too_late(conn):
    a = book_at(conn, at(10))
    assert code_of(cancel, conn, CLINIC, PHONE, a["id"], now=at(8, 30)) == "too_late_to_change"  # 2 hours needed


def test_reschedule_same_doctor_other_doctor_and_overlap_with_itself(conn):
    a = book_at(conn, at(10))
    moved = reschedule(conn, CLINIC, PHONE, a["id"], at(10, 15), now=NOW)  # overlaps only its old time
    assert moved["id"] == a["id"] and moved["starts_at"] == at(10, 15) and moved["status"] == "booked"
    moved = reschedule(conn, CLINIC, PHONE, a["id"], at(13), doctor_id=OMAR, now=NOW)
    assert moved["doctor_id"] == OMAR and moved["ends_at"] == at(13, 20)
    assert at(10, 15) in [x["starts_at"] for x in find_slots(conn, CLINIC, CONSULT, date_from=SUNDAY, days=1, doctor_id=LINA, now=NOW)]


def test_reschedule_rules(conn):
    a = book_at(conn, at(10))
    book_at(conn, at(11), phone=OTHER)
    assert code_of(reschedule, conn, CLINIC, PHONE, a["id"], at(11), now=NOW) == "slot_unavailable"
    assert code_of(reschedule, conn, CLINIC, OTHER, a["id"], at(12), now=NOW) == "not_found"
    assert code_of(reschedule, conn, CLINIC, PHONE, a["id"], at(12), now=at(8, 30)) == "too_late_to_change"
    peel = book_at(conn, at(16), service=PEEL)
    assert code_of(reschedule, conn, CLINIC, PHONE, peel["id"], at(13), doctor_id=OMAR, now=NOW) == "doctor_does_not_offer_service"


# ---------------------------------------------------------------- hand-off and tenants

def test_hand_off(conn):
    book_at(conn, at(10))
    h = hand_off(conn, CLINIC, PHONE, "medical_question", "Asks if a rash needs urgent care")
    assert h["status"] == "open"
    h2 = hand_off(conn, CLINIC, PHONE, "patient_request", "Wants to talk to reception")
    assert h2["conversation_id"] == h["conversation_id"]
    row = conn.execute("select status, patient_id is not null from conversations").fetchall()
    assert row == [("handed_off", True)]
    assert code_of(hand_off, conn, CLINIC, PHONE, "bored", "") == "invalid_reason"


def test_other_clinic_sees_nothing(conn):
    other = conn.execute("insert into clinics (slug, name_en, name_ar) values ('other', 'Other', 'أخرى') returning id").fetchone()[0]
    book_at(conn, at(10))
    assert code_of(find_slots, conn, other, CONSULT, now=NOW) == "unknown_service"
    assert my_appointments(conn, other, PHONE, now=NOW) == []
    assert code_of(book, conn, other, PHONE, CONSULT, LINA, at(11), now=NOW) == "unknown_service"
