from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from limitsiz_agent.booking.slots import Shift, free_slots, pg_weekday

TZ = ZoneInfo("Asia/Amman")
SUNDAY = date(2026, 12, 6)
FRIDAY = date(2026, 12, 11)
# Dr. Lina's Sunday in the demo clinic: a split shift.
SHIFTS = [Shift(0, time(10), time(14)), Shift(0, time(16), time(19))]


def at(h, m=0, day=SUNDAY):
    return datetime.combine(day, time(h, m), TZ)


def slots(busy=(), earliest=None, latest=None, day=SUNDAY, duration=20):
    return free_slots(
        day_from=day, day_to=day, tz=TZ, shifts=SHIFTS, busy=list(busy),
        duration=timedelta(minutes=duration), step=timedelta(minutes=15),
        earliest=earliest or at(0, day=day), latest=latest or at(23, 59, day=day),
    )


def test_weekday_numbering_matches_postgres():
    assert pg_weekday(SUNDAY) == 0
    assert pg_weekday(date(2026, 12, 12)) == 6  # Saturday


def test_split_shift_and_whole_appointment_must_fit():
    s = slots()
    assert s[0] == at(10) and s[-1] == at(18, 30)
    assert at(13, 30) in s and at(13, 45) not in s  # 13:45 + 20 min would run past 14:00
    assert not [t for t in s if at(14) <= t < at(16)]  # lunch break
    assert len(s) == 15 + 11


def test_busy_blocks_overlaps_but_not_back_to_back():
    s = slots(busy=[(at(10), at(10, 30))])
    assert at(10) not in s and at(10, 15) not in s
    assert at(10, 30) in s


def test_minimum_notice_and_booking_window():
    s = slots(earliest=at(11, 5), latest=at(17))
    assert s[0] == at(11, 15)
    assert s[-1] == at(17)


def test_closed_day_has_no_slots():
    assert slots(day=FRIDAY) == []


def test_long_service_fits_fewer_slots():
    s = slots(duration=45)
    assert s[-1] == at(18, 15) and at(13, 15) in s and at(13, 30) not in s


def test_times_are_in_clinic_time_zone():
    assert slots()[0].utcoffset() == timedelta(hours=3)
