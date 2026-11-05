"""The assistant reads each clinic's Settings: opening hours, doctor interval and buffer, patient rules, prompt notes."""

from datetime import date, datetime, time, timedelta

from limitsiz_agent.agent.prompt import build_system_prompt
from limitsiz_agent.booking import book, clinic_info, find_slots
from limitsiz_agent.booking.slots import Shift, within_opening_hours
from test_booking import CLINIC, CONSULT, LINA, NOW, OMAR, OTHER, PHONE, SUNDAY, TZ, at, book_at, code_of

MONDAY = SUNDAY + timedelta(days=1)
OPEN_ALL_DAY = [("00:00", "23:59")]


def starts(conn, doctor=LINA, day=SUNDAY, now=NOW):
    return [s["starts_at"] for s in find_slots(conn, CLINIC, CONSULT, date_from=day, days=1, doctor_id=doctor, now=now)]


def set_hours(conn, weekday, periods):
    for start, end in periods:
        conn.execute("insert into clinic_hours (clinic_id, weekday, start_time, end_time) values (%s, %s, %s, %s)", (CLINIC, weekday, start, end))


def test_new_clinic_gets_todays_rules_and_defaults(conn):
    r = conn.execute("""select min_notice_minutes, window_days, change_notice_minutes, max_upcoming from booking_rules
                        where clinic_id = %s and audience = 'patient'""", (CLINIC,)).fetchone()
    assert r == (60, 30, 120, 3)
    s = conn.execute("""select min_notice_minutes, window_days, change_notice_minutes, max_upcoming, outside_hours,
                               walkin_back_minutes, require_cancel_reason
                        from booking_rules where clinic_id = %s and audience = 'staff'""", (CLINIC,)).fetchone()
    assert s == (0, 365, 0, None, "warn", 120, True)
    g = conn.execute("""select idle_timeout_minutes, lock_after_minutes, require_2fa_all, conversation_visibility,
                               reminders_enabled, reminder_offsets_minutes, assistant_enabled
                        from clinic_settings where clinic_id = %s""", (CLINIC,)).fetchone()
    assert g == (60, 10, False, "handoff", True, [1440, 120], True)


def test_no_opening_hours_means_the_doctors_hours_apply_alone():
    d = [Shift(0, time(10), time(14))]
    assert within_opening_hours(d, []) == d


def test_doctor_hours_are_cut_to_the_opening_hours(conn):
    assert at(10) in starts(conn)
    set_hours(conn, 0, [("11:00", "13:00")])                 # Sunday only
    free = starts(conn)
    assert at(10) not in free and at(11) in free and at(12, 30) in free
    assert at(12, 45) not in free, "20 minutes would run past the closing time"
    assert not any(t >= at(16) for t in free), "the afternoon shift is outside the opening hours"


def test_a_day_with_no_opening_hours_is_closed_once_any_are_set(conn):
    set_hours(conn, 1, OPEN_ALL_DAY)                         # Monday open, Sunday not listed
    assert starts(conn) == []
    assert starts(conn, day=MONDAY) != []


def test_each_doctor_has_their_own_interval(conn):
    conn.execute("update doctors set slot_minutes = 30 where id = %s", (LINA,))
    free = starts(conn)
    assert at(10) in free and at(10, 30) in free and at(10, 15) not in free
    assert at(12, 15) in starts(conn, OMAR), "the other doctor keeps the clinic's 15 minutes"


def test_buffer_after_each_appointment_both_ways(conn):
    conn.execute("update doctors set buffer_minutes = 10 where id = %s", (LINA,))
    book_at(conn, at(11))                                    # 11:00-11:20, buffer to 11:30
    free = starts(conn)
    assert at(11, 15) not in free, "inside the appointment"
    assert at(11, 30) in free, "right after the buffer"
    assert at(10, 30) in free and at(10, 45) not in free, "10:45 + 20 + 10 would run into 11:00"
    assert at(13, 30) in free, "the buffer may run past the end of a shift, the appointment may not"


def test_buffer_does_not_apply_to_other_doctors(conn):
    conn.execute("update doctors set buffer_minutes = 15 where id = %s", (LINA,))
    book_at(conn, at(12), doctor=OMAR)
    assert at(12, 15) in starts(conn, LINA) or at(12, 30) in starts(conn, LINA)
    assert at(12, 30) in starts(conn, OMAR)


def test_patient_rules_come_from_settings(conn):
    conn.execute("update booking_rules set min_notice_minutes = 240 where clinic_id = %s and audience = 'patient'", (CLINIC,))
    free = starts(conn, now=at(9))
    assert at(13) in free or at(13, 15) in free
    assert all(t >= at(13) for t in free)
    assert code_of(book_at, conn, at(10), now=at(9)) == "too_soon"
    assert clinic_info(conn, CLINIC)["min_notice_minutes"] == 240


def test_the_limit_of_upcoming_bookings_is_a_setting(conn):
    conn.execute("update booking_rules set max_upcoming = 1 where clinic_id = %s and audience = 'patient'", (CLINIC,))
    book_at(conn, at(10))
    assert code_of(book_at, conn, at(11)) == "too_many_upcoming"
    conn.execute("update booking_rules set max_upcoming = null where clinic_id = %s and audience = 'patient'", (CLINIC,))
    for h in (11, 12, 13):
        book_at(conn, at(h))                                 # no limit
    assert conn.execute("select count(*) from appointments").fetchone()[0] == 4


def test_staff_rules_do_not_touch_the_assistant(conn):
    conn.execute("update booking_rules set min_notice_minutes = 600, window_days = 2 where clinic_id = %s and audience = 'staff'", (CLINIC,))
    assert book_at(conn, at(10))["status"] == "booked"


def test_prompt_is_unchanged_until_a_clinic_sets_hours_or_a_note(conn):
    before = build_system_prompt(clinic_info(conn, CLINIC))
    assert "opening hours" not in before
    set_hours(conn, 0, [("09:00", "17:00")])
    conn.execute("update clinic_settings set after_hours_message_en = 'We reply in the morning', after_hours_message_ar = 'نرد صباحاً' where clinic_id = %s", (CLINIC,))
    after = build_system_prompt(clinic_info(conn, CLINIC))
    assert "Clinic opening hours: Sunday 09:00-17:00" in after
    assert "We reply in the morning / نرد صباحاً" in after


def test_doctor_hours_shown_to_the_assistant_are_inside_the_opening_hours(conn):
    set_hours(conn, 0, [("11:00", "13:00")])
    info = clinic_info(conn, CLINIC)
    lina = next(d for d in info["doctors"] if d["id"] == LINA)
    assert lina["hours"] == [{"weekday": 0, "start": "11:00", "end": "13:00"}]


def test_moving_keeps_the_settings(conn):
    from limitsiz_agent.booking import reschedule
    conn.execute("update doctors set slot_minutes = 30 where id = %s", (LINA,))
    a = book_at(conn, at(10))
    assert code_of(reschedule, conn, CLINIC, PHONE, a["id"], at(10, 15), now=NOW) == "slot_unavailable"
    assert reschedule(conn, CLINIC, PHONE, a["id"], at(10, 30), now=NOW)["starts_at"] == at(10, 30)
    assert book(conn, CLINIC, OTHER, CONSULT, LINA, at(10), now=NOW)["status"] == "booked"
    assert isinstance(NOW, datetime) and isinstance(SUNDAY, date) and TZ
