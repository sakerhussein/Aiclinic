"""Free appointment slots for one doctor. Pure code: no database, so every rule here is easy to test."""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Shift:
    """Weekly working hours in the clinic's local time. weekday: 0 = Sunday ... 6 = Saturday."""

    weekday: int
    start: time
    end: time


def pg_weekday(d: date) -> int:
    """Weekday numbered like Postgres "dow" and the working_hours table: 0 = Sunday ... 6 = Saturday."""
    return d.isoweekday() % 7


def within_opening_hours(doctor: list[Shift], clinic: list[Shift]) -> list[Shift]:
    """The doctor's shifts cut down to the clinic's opening hours. No opening hours at all means they are not set: nothing is cut."""
    if not clinic:
        return doctor
    out = []
    for d in doctor:
        for c in clinic:
            if c.weekday == d.weekday and d.start < c.end and c.start < d.end:
                out.append(Shift(d.weekday, max(d.start, c.start), min(d.end, c.end)))
    return out


def free_slots(
    *,
    day_from: date,
    day_to: date,
    tz: ZoneInfo,
    shifts: list[Shift],
    busy: list[tuple[datetime, datetime]],
    duration: timedelta,
    step: timedelta,
    earliest: datetime,
    latest: datetime,
    bookings: list[tuple[datetime, datetime]] = (),
    buffer: timedelta = timedelta(0),
) -> list[datetime]:
    """Start times (aware, in the clinic's time zone) between day_from and day_to, both included.

    A slot is free when the whole appointment fits inside one shift, starts on the shift's step grid,
    starts no earlier than `earliest` (minimum notice) and no later than `latest` (booking window),
    and does not overlap anything in `busy` (leave, holidays, or appointments when no buffer is used).
    `bookings` are the doctor's other appointments: the doctor's `buffer` is kept after each of them and after this one,
    though the buffer itself may run past the end of a shift.
    """
    busy = sorted(busy)
    slots: list[datetime] = []
    day = day_from
    while day <= day_to:
        for shift in sorted((s for s in shifts if s.weekday == pg_weekday(day)), key=lambda s: s.start):
            start = datetime.combine(day, shift.start, tz)
            end = datetime.combine(day, shift.end, tz)
            t = start
            while t + duration <= end:
                if (earliest <= t <= latest and not _overlaps(t, t + duration, busy)
                        and not _overlaps(t, t + duration + buffer, [(a, b + buffer) for a, b in bookings])):
                    slots.append(t)
                t += step
        day += timedelta(days=1)
    return slots


def _overlaps(start: datetime, end: datetime, busy: list[tuple[datetime, datetime]]) -> bool:
    # Half-open ranges, like the database: an appointment ending at 10:20 does not block one starting at 10:20.
    return any(b_start < end and start < b_end for b_start, b_end in busy)
