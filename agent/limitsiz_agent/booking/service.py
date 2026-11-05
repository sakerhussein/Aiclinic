"""Booking functions the agent calls. Plain code: the AI chooses what to call, these decide what is allowed.

Every function takes an open psycopg connection and the clinic ID, and only ever touches that clinic's rows.
A patient is identified by their WhatsApp number, and can only see and change their own appointments.
Rules that fail raise BookingError with a short code the agent can explain to the patient.
The database adds a last guard: two active appointments of one doctor can never overlap.
"""

import re
from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from zoneinfo import ZoneInfo

from .slots import Shift, free_slots, within_opening_hours

ACTIVE = ("booked", "confirmed")
AGENT_ACTOR = ("agent", "whatsapp", "WhatsApp assistant")
# Stops one number from filling the calendar.
HANDOFF_REASONS = ("emergency", "medical_question", "patient_request", "complaint", "agent_unsure")


class BookingError(Exception):
    """A booking rule said no. `code` is stable and meant for the agent; `detail` is for logs."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


def set_actor(cur, clinic_id, reason: str | None = None) -> None:
    """Tells the database, for this transaction, that the WhatsApp assistant is acting (audit trail, design §7)."""
    cur.execute("select audit.set_actor(%s, %s, %s, null, null, null, %s, %s)", (*AGENT_ACTOR, reason, clinic_id))


def normalize_phone(raw: str, default_country: str = "962") -> str:
    """'+962 79 123 4567', '00962791234567', '962791234567' or '0791234567' -> '+962791234567'."""
    digits = re.sub(r"[\s\-().]", "", raw or "")
    if digits.startswith("+"):
        n = digits[1:]
    elif digits.startswith("00"):
        n = digits[2:]
    elif digits.startswith("0"):
        n = default_country + digits[1:]
    else:
        n = digits
    if not re.fullmatch(r"[1-9][0-9]{6,14}", n):
        raise BookingError("invalid_phone", raw)
    return "+" + n


# ---------------------------------------------------------------- reading


def clinic_info(conn: psycopg.Connection, clinic_id: UUID | str) -> dict:
    """Everything the agent may tell a patient: clinic details, services, doctors with their hours, FAQs."""
    with conn.cursor(row_factory=dict_row) as cur:
        clinic = _clinic(cur, clinic_id)
        cur.execute(
            """select id, name_en, name_ar, description_en, description_ar, duration_minutes, price_jod, price_is_from
               from services where clinic_id = %s and active order by sort, name_en""",
            (clinic_id,),
        )
        services = cur.fetchall()
        cur.execute(
            """select d.id, d.name_en, d.name_ar, d.title_en, d.title_ar, d.gender,
                      coalesce(array_agg(ds.service_id) filter (where ds.service_id is not null), '{}') as service_ids
               from doctors d left join doctor_services ds on ds.doctor_id = d.id
               where d.clinic_id = %s and d.active group by d.id order by d.name_en""",
            (clinic_id,),
        )
        doctors = cur.fetchall()
        for d in doctors:
            d["hours"] = [
                {"weekday": s.weekday, "start": s.start.strftime("%H:%M"), "end": s.end.strftime("%H:%M")}
                for s in _shifts(cur, clinic_id, d["id"])
            ]
        hours = [{"weekday": s.weekday, "start": s.start.strftime("%H:%M"), "end": s.end.strftime("%H:%M")}
                 for s in _clinic_hours(cur, clinic_id)]
        cur.execute(
            """select topic, question_en, question_ar, answer_en, answer_ar
               from clinic_faqs where clinic_id = %s order by sort""",
            (clinic_id,),
        )
        faqs = cur.fetchall()
    keys = ("id", "name_en", "name_ar", "timezone", "phone", "address_en", "address_ar", "maps_url",
            "default_language", "booking_window_days", "min_notice_minutes", "cancel_notice_minutes",
            "after_hours_message_en", "after_hours_message_ar")
    return {**{k: clinic[k] for k in keys}, "services": services, "doctors": doctors, "faqs": faqs, "opening_hours": hours}


def find_slots(
    conn: psycopg.Connection,
    clinic_id: UUID | str,
    service_id: UUID | str,
    *,
    date_from: date | None = None,
    days: int = 7,
    doctor_id: UUID | str | None = None,
    gender: str | None = None,
    now: datetime | None = None,
) -> list[dict]:
    """Free start times for a service over `days` days from `date_from` (default today), for every doctor
    who offers it, or only `doctor_id`, or only female/male doctors (`gender` 'f' or 'm')."""
    now = _now(now)
    with conn.cursor(row_factory=dict_row) as cur:
        clinic = _clinic(cur, clinic_id)
        tz = ZoneInfo(clinic["timezone"])
        service = _service(cur, clinic_id, service_id)
        doctors = _doctors_for(cur, clinic_id, service_id, doctor_id, gender)
        earliest, latest = _window(clinic, now)
        today = now.astimezone(tz).date()
        day_from = max(date_from or today, today)
        day_to = min(day_from + timedelta(days=max(days, 1) - 1), latest.astimezone(tz).date())
        duration = timedelta(minutes=service["duration_minutes"])
        out = []
        for d in doctors:
            for t in _doctor_slots(cur, clinic, d["id"], duration, day_from, day_to, earliest, latest):
                out.append({
                    "doctor_id": d["id"], "doctor_name_en": d["name_en"], "doctor_name_ar": d["name_ar"],
                    "starts_at": t, "ends_at": t + duration,
                })
    out.sort(key=lambda s: (s["starts_at"], s["doctor_name_en"]))
    return out


def my_appointments(conn: psycopg.Connection, clinic_id: UUID | str, phone: str, *, now: datetime | None = None) -> list[dict]:
    """The patient's upcoming active appointments, soonest first."""
    phone = normalize_phone(phone)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            _APPOINTMENT_SELECT + """ where a.clinic_id = %s and p.phone_e164 = %s
               and a.status in ('booked', 'confirmed') and a.ends_at > %s order by a.starts_at""",
            (clinic_id, phone, _now(now)),
        )
        return cur.fetchall()


# ---------------------------------------------------------------- changing


def book(
    conn: psycopg.Connection,
    clinic_id: UUID | str,
    phone: str,
    service_id: UUID | str,
    doctor_id: UUID | str,
    starts_at: datetime,
    *,
    full_name: str | None = None,
    language: str | None = None,
    source: str = "whatsapp",
    now: datetime | None = None,
) -> dict:
    """Books a free slot (as returned by find_slots) and returns the appointment."""
    phone = normalize_phone(phone)
    now = _now(now)
    _require_aware(starts_at)
    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        set_actor(cur, clinic_id)
        clinic = _clinic(cur, clinic_id)
        service = _service(cur, clinic_id, service_id)
        _doctors_for(cur, clinic_id, service_id, doctor_id, None)
        duration = timedelta(minutes=service["duration_minutes"])
        _check_slot(cur, clinic, doctor_id, starts_at, duration, now)

        cur.execute(
            """insert into patients (clinic_id, phone_e164, full_name, preferred_language, whatsapp_reminders)
               values (%s, %s, %s, %s, true)
               on conflict (clinic_id, phone_e164) do update
                 set full_name = coalesce(excluded.full_name, patients.full_name),
                     preferred_language = coalesce(excluded.preferred_language, patients.preferred_language),
                     whatsapp_reminders = true
               returning id""",
            (clinic_id, phone, full_name, language),
        )
        patient_id = cur.fetchone()["id"]
        _check_patient_free(cur, clinic, patient_id, starts_at, starts_at + duration, now, exclude_id=None, counting_new=True)

        try:
            cur.execute(
                """insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, source)
                   values (%s, %s, %s, %s, %s, %s, %s) returning id""",
                (clinic_id, doctor_id, service_id, patient_id, starts_at, starts_at + duration, source),
            )
        except psycopg.errors.ExclusionViolation as e:
            raise BookingError("slot_taken", "someone else booked it a moment ago") from e
        return _appointment(cur, cur.fetchone()["id"])


def cancel(
    conn: psycopg.Connection,
    clinic_id: UUID | str,
    phone: str,
    appointment_id: UUID | str,
    *,
    reason: str | None = None,
    now: datetime | None = None,
) -> dict:
    """Cancels one of the patient's own appointments, if it is not too close to the time."""
    phone = normalize_phone(phone)
    now = _now(now)
    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        set_actor(cur, clinic_id, reason)
        clinic = _clinic(cur, clinic_id)
        appt = _own_active_appointment(cur, clinic_id, phone, appointment_id)
        _check_change_notice(clinic, appt["starts_at"], now)
        cur.execute(
            "update appointments set status = 'cancelled', cancel_reason = %s where id = %s",
            (reason, appt["id"]),
        )
        return _appointment(cur, appt["id"])


def reschedule(
    conn: psycopg.Connection,
    clinic_id: UUID | str,
    phone: str,
    appointment_id: UUID | str,
    new_starts_at: datetime,
    *,
    doctor_id: UUID | str | None = None,
    now: datetime | None = None,
) -> dict:
    """Moves one of the patient's own appointments to a new free slot, optionally with another doctor.
    The appointment keeps its ID and goes back to 'booked' (the new time is not confirmed yet)."""
    phone = normalize_phone(phone)
    now = _now(now)
    _require_aware(new_starts_at)
    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        set_actor(cur, clinic_id)
        clinic = _clinic(cur, clinic_id)
        appt = _own_active_appointment(cur, clinic_id, phone, appointment_id)
        _check_change_notice(clinic, appt["starts_at"], now)
        doctor_id = doctor_id or appt["doctor_id"]
        service = _service(cur, clinic_id, appt["service_id"])
        _doctors_for(cur, clinic_id, appt["service_id"], doctor_id, None)
        duration = timedelta(minutes=service["duration_minutes"])
        _check_slot(cur, clinic, doctor_id, new_starts_at, duration, now, exclude_id=appt["id"])
        _check_patient_free(cur, clinic, appt["patient_id"], new_starts_at, new_starts_at + duration, now,
                            exclude_id=appt["id"], counting_new=False)
        try:
            cur.execute(
                """update appointments set doctor_id = %s, starts_at = %s, ends_at = %s, status = 'booked'
                   where id = %s""",
                (doctor_id, new_starts_at, new_starts_at + duration, appt["id"]),
            )
        except psycopg.errors.ExclusionViolation as e:
            raise BookingError("slot_taken", "someone else booked it a moment ago") from e
        return _appointment(cur, appt["id"])


def hand_off(
    conn: psycopg.Connection,
    clinic_id: UUID | str,
    phone: str,
    reason: str,
    summary: str,
) -> dict:
    """Passes the patient's conversation to clinic staff. The agent stays quiet until staff hand it back."""
    phone = normalize_phone(phone)
    if reason not in HANDOFF_REASONS:
        raise BookingError("invalid_reason", reason)
    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _clinic(cur, clinic_id)
        cur.execute(
            """insert into conversations (clinic_id, patient_id, wa_phone, status)
               values (%s, (select id from patients where clinic_id = %s and phone_e164 = %s), %s, 'handed_off')
               on conflict (clinic_id, wa_phone) do update
                 set status = 'handed_off', patient_id = coalesce(conversations.patient_id, excluded.patient_id)
               returning id""",
            (clinic_id, clinic_id, phone, phone),
        )
        conversation_id = cur.fetchone()["id"]
        cur.execute(
            """insert into handoffs (clinic_id, conversation_id, reason, summary) values (%s, %s, %s, %s)
               returning id, conversation_id, reason, summary, status, created_at""",
            (clinic_id, conversation_id, reason, summary),
        )
        return cur.fetchone()


# ---------------------------------------------------------------- internals

_APPOINTMENT_SELECT = """
    select a.id, a.status::text as status, a.starts_at, a.ends_at, a.doctor_id, a.service_id, a.patient_id,
           d.name_en as doctor_name_en, d.name_ar as doctor_name_ar,
           s.name_en as service_name_en, s.name_ar as service_name_ar, s.price_jod, s.price_is_from
    from appointments a
    join doctors d on d.id = a.doctor_id
    join services s on s.id = a.service_id
    join patients p on p.id = a.patient_id"""


def _now(now: datetime | None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    _require_aware(now)
    return now


def _require_aware(t: datetime) -> None:
    if t.tzinfo is None or t.utcoffset() is None:
        raise BookingError("invalid_time", "times must include a time zone")


def _clinic(cur, clinic_id) -> dict:
    # The rules for patients come from Settings (booking_rules), under the names the code has always used.
    cur.execute(
        """select c.*, r.min_notice_minutes, r.window_days as booking_window_days, r.change_notice_minutes as cancel_notice_minutes,
                  r.max_upcoming, s.after_hours_message_en, s.after_hours_message_ar
           from clinics c
           join booking_rules r on r.clinic_id = c.id and r.audience = 'patient'
           join clinic_settings s on s.clinic_id = c.id
           where c.id = %s and c.active""", (clinic_id,))
    clinic = cur.fetchone()
    if not clinic:
        raise BookingError("unknown_clinic", str(clinic_id))
    return clinic


def _service(cur, clinic_id, service_id) -> dict:
    cur.execute("select * from services where clinic_id = %s and id = %s and active", (clinic_id, service_id))
    service = cur.fetchone()
    if not service:
        raise BookingError("unknown_service", str(service_id))
    return service


def _doctors_for(cur, clinic_id, service_id, doctor_id, gender) -> list[dict]:
    """Active doctors of this clinic who offer the service, optionally one doctor or one gender."""
    if doctor_id is not None:
        cur.execute("select 1 from doctors where clinic_id = %s and id = %s and active", (clinic_id, doctor_id))
        if not cur.fetchone():
            raise BookingError("unknown_doctor", str(doctor_id))
    cur.execute(
        """select d.id, d.name_en, d.name_ar, d.gender from doctors d
           join doctor_services ds on ds.doctor_id = d.id and ds.service_id = %s
           where d.clinic_id = %s and d.active
             and (%s::uuid is null or d.id = %s::uuid) and (%s::text is null or d.gender = %s::text)
           order by d.name_en""",
        (service_id, clinic_id, doctor_id, doctor_id, gender, gender),
    )
    doctors = cur.fetchall()
    if doctor_id is not None and not doctors:
        raise BookingError("doctor_does_not_offer_service", str(doctor_id))
    return doctors


def _window(clinic, now: datetime) -> tuple[datetime, datetime]:
    return (now + timedelta(minutes=clinic["min_notice_minutes"]),
            now + timedelta(days=clinic["booking_window_days"]))


def _clinic_hours(cur, clinic_id) -> list[Shift]:
    cur.execute("select weekday, start_time, end_time from clinic_hours where clinic_id = %s order by weekday, start_time", (clinic_id,))
    return [Shift(r["weekday"], r["start_time"], r["end_time"]) for r in cur.fetchall()]


def _shifts(cur, clinic_id, doctor_id) -> list[Shift]:
    """The doctor's weekly hours inside the clinic's opening hours."""
    cur.execute("select weekday, start_time, end_time from working_hours where doctor_id = %s "
                "order by weekday, start_time", (doctor_id,))
    doctor = [Shift(r["weekday"], r["start_time"], r["end_time"]) for r in cur.fetchall()]
    return within_opening_hours(doctor, _clinic_hours(cur, clinic_id))


def _doctor_slots(cur, clinic, doctor_id, duration, day_from, day_to, earliest, latest, exclude_id=None):
    tz = ZoneInfo(clinic["timezone"])
    range_from = datetime.combine(day_from, time(0), tz)
    range_to = datetime.combine(day_to + timedelta(days=1), time(0), tz)
    cur.execute(
        """select starts_at, ends_at from appointments
           where doctor_id = %s and status in ('booked', 'confirmed') and starts_at < %s and ends_at > %s
             and (%s::uuid is null or id <> %s::uuid)""",
        (doctor_id, range_to, range_from, exclude_id, exclude_id),
    )
    bookings = [(r["starts_at"], r["ends_at"]) for r in cur.fetchall()]
    cur.execute(
        """select starts_at, ends_at from time_off
           where clinic_id = %s and (doctor_id is null or doctor_id = %s) and starts_at < %s and ends_at > %s""",
        (clinic["id"], doctor_id, range_to, range_from),
    )
    busy = [(r["starts_at"], r["ends_at"]) for r in cur.fetchall()]
    cur.execute("select slot_minutes, buffer_minutes from doctors where id = %s", (doctor_id,))
    doctor = cur.fetchone()
    return free_slots(
        day_from=day_from, day_to=day_to, tz=tz, shifts=_shifts(cur, clinic["id"], doctor_id), busy=busy, duration=duration,
        step=timedelta(minutes=doctor["slot_minutes"] or clinic["slot_step_minutes"]), earliest=earliest, latest=latest,
        bookings=bookings, buffer=timedelta(minutes=doctor["buffer_minutes"]),
    )


def _check_slot(cur, clinic, doctor_id, starts_at, duration, now, exclude_id=None) -> None:
    earliest, latest = _window(clinic, now)
    if starts_at < earliest:
        raise BookingError("too_soon", f"needs {clinic['min_notice_minutes']} minutes notice")
    if starts_at > latest:
        raise BookingError("outside_booking_window", f"up to {clinic['booking_window_days']} days ahead")
    day = starts_at.astimezone(ZoneInfo(clinic["timezone"])).date()
    if starts_at not in _doctor_slots(cur, clinic, doctor_id, duration, day, day, earliest, latest, exclude_id):
        raise BookingError("slot_unavailable", starts_at.isoformat())


def _check_patient_free(cur, clinic, patient_id, starts_at, ends_at, now, *, exclude_id, counting_new) -> None:
    cur.execute(
        """select count(*) filter (where ends_at > %s) as upcoming,
                  count(*) filter (where starts_at < %s and ends_at > %s) as overlapping
           from appointments
           where patient_id = %s and status in ('booked', 'confirmed') and (%s::uuid is null or id <> %s::uuid)""",
        (now, ends_at, starts_at, patient_id, exclude_id, exclude_id),
    )
    row = cur.fetchone()
    if row["overlapping"]:
        raise BookingError("patient_busy", "the patient already has an appointment at that time")
    limit = clinic["max_upcoming"]
    if counting_new and limit is not None and row["upcoming"] >= limit:
        raise BookingError("too_many_upcoming", f"at most {limit} upcoming appointments")


def _own_active_appointment(cur, clinic_id, phone, appointment_id) -> dict:
    cur.execute(
        """select a.* from appointments a join patients p on p.id = a.patient_id
           where a.clinic_id = %s and p.phone_e164 = %s and a.id = %s for update of a""",
        (clinic_id, phone, appointment_id),
    )
    appt = cur.fetchone()
    if not appt:
        # Same answer whether it does not exist or belongs to someone else.
        raise BookingError("not_found", str(appointment_id))
    if appt["status"] not in ACTIVE:
        raise BookingError("not_active", appt["status"])
    return appt


def _check_change_notice(clinic, starts_at: datetime, now: datetime) -> None:
    if starts_at - now < timedelta(minutes=clinic["cancel_notice_minutes"]):
        raise BookingError("too_late_to_change", f"needs {clinic['cancel_notice_minutes']} minutes notice")


def _appointment(cur, appointment_id) -> dict:
    cur.execute(_APPOINTMENT_SELECT + " where a.id = %s", (appointment_id,))
    return cur.fetchone()
