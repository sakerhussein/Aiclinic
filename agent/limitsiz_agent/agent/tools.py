"""The tools Claude may call, and how they run.

The patient's phone number and the clinic come from the conversation, never from Claude: the tool schemas
have no field for them, so the agent can only ever act for the person it is talking to.
Times go in and out as the clinic's local date ("2026-12-06") and time ("10:00").
"""

import json
import re
from datetime import date, datetime
from datetime import time as dtime
from uuid import UUID

import psycopg
from zoneinfo import ZoneInfo

from ..booking import BookingError, book, cancel, find_slots, hand_off, my_appointments, reschedule

# Changes that wait for the patient's explicit yes before they run.
CHANGE_TOOLS = ("book_appointment", "cancel_appointment", "reschedule_appointment")

WEEKDAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
WEEKDAYS_AR = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]

_ID = {"type": "string", "description": "An ID exactly as given in the clinic details or a tool result."}
_DATE = {"type": "string", "description": "Clinic local date, YYYY-MM-DD."}
_TIME = {"type": "string", "description": "Clinic local start time, HH:MM (24-hour), exactly as listed by find_available_times."}
_VISIT = {"type": "string", "enum": ["clinic", "online"],
          "description": "'online' for an online visit (Microsoft Teams), only when the clinic offers them. Default: at the clinic."}

TOOLS = [
    {
        "name": "find_available_times",
        "description": "Free appointment times for one service, grouped by day and doctor. Call it before offering "
                       "any time; never offer a time it did not return.",
        "input_schema": {
            "type": "object",
            "properties": {
                "service_id": _ID,
                "date_from": {**_DATE, "description": "First day to search (clinic local date). Default: today."},
                "days": {"type": "integer", "minimum": 1, "maximum": 7, "description": "How many days to search. Default 3."},
                "doctor_id": {**_ID, "description": "Only this doctor. Leave out for any doctor."},
                "doctor_gender": {"type": "string", "enum": ["f", "m"], "description": "Only female (f) or male (m) doctors."},
                "visit": {**_VISIT, "description": "'online' for times of an online visit (they can differ). Default: at the clinic."},
            },
            "required": ["service_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_my_appointments",
        "description": "The patient's upcoming appointments, with their appointment_id. Use before cancelling or moving one.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "book_appointment",
        "description": "Books a time returned by find_available_times. The booking is NOT made yet: the system checks it "
                       "and then asks the patient to confirm. Tell the patient what will be booked and ask them to reply yes.",
        "input_schema": {
            "type": "object",
            "properties": {
                "service_id": _ID,
                "doctor_id": _ID,
                "date": _DATE,
                "time": _TIME,
                "patient_name": {"type": "string", "description": "The patient's name, if they gave it."},
                "visit": {**_VISIT, "description": "'online' for an online visit, with a time from find_available_times with visit 'online'."},
                "online_mode": {"type": "string", "enum": ["video", "audio"],
                                "description": "Online visits only, when the tool result asks the patient to choose (choose_mode)."},
            },
            "required": ["service_id", "doctor_id", "date", "time"],
            "additionalProperties": False,
        },
    },
    {
        "name": "cancel_appointment",
        "description": "Cancels one of the patient's own appointments. Waits for the patient's confirmation like booking.",
        "input_schema": {
            "type": "object",
            "properties": {
                "appointment_id": _ID,
                "reason": {"type": "string", "description": "The patient's reason, if they gave one."},
            },
            "required": ["appointment_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "reschedule_appointment",
        "description": "Moves one of the patient's own appointments to a time returned by find_available_times. "
                       "Waits for the patient's confirmation like booking.",
        "input_schema": {
            "type": "object",
            "properties": {
                "appointment_id": _ID,
                "date": _DATE,
                "time": _TIME,
                "doctor_id": {**_ID, "description": "Only when changing doctor."},
            },
            "required": ["appointment_id", "date", "time"],
            "additionalProperties": False,
        },
    },
    {
        "name": "hand_off_to_staff",
        "description": "Passes the conversation to the clinic team, who reply in this chat. After this you stop replying. "
                       "Use for emergencies, medical questions you must not answer, complaints, a request for a person, "
                       "or anything you cannot handle with your tools.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "enum": ["emergency", "medical_question", "patient_request", "complaint", "agent_unsure"]},
                "summary": {"type": "string", "description": "One or two sentences for the staff, in English."},
            },
            "required": ["reason", "summary"],
            "additionalProperties": False,
        },
    },
]

_SCHEMAS = {t["name"]: t["input_schema"] for t in TOOLS}
_ID_FIELDS = {"service_id", "doctor_id", "appointment_id"}


class ToolInputError(Exception):
    """Claude sent arguments that do not match the tool's schema."""


class ToolBox:
    """Runs tools for one patient of one clinic."""

    def __init__(self, conn: psycopg.Connection, clinic_id: str, phone: str, tz: str, now: datetime):
        self.conn, self.clinic_id, self.phone, self.now = conn, clinic_id, phone, now
        self.tz = ZoneInfo(tz)

    def run(self, name: str, args: dict, *, dry_run: bool = False) -> dict:
        """Runs a tool and returns a JSON-ready result. With dry_run the change is checked and then rolled back.
        Raises ToolInputError for bad arguments and BookingError when a booking rule says no."""
        if name not in _SCHEMAS:
            raise ToolInputError(f"unknown tool {name}")
        _validate(args, _SCHEMAS[name])
        if name in CHANGE_TOOLS and dry_run:
            with self.conn.transaction(force_rollback=True):
                return getattr(self, name)(**args)
        return getattr(self, name)(**args)

    # ------------------------------------------------------------ tools

    def find_available_times(self, service_id, date_from=None, days=3, doctor_id=None, doctor_gender=None, visit="clinic"):
        slots = find_slots(
            self.conn, self.clinic_id, service_id, date_from=_parse_date(date_from) if date_from else None,
            days=days, doctor_id=doctor_id, gender=doctor_gender, visit=visit, now=self.now,
        )
        by_day: dict[date, dict] = {}
        for s in slots:
            local = s["starts_at"].astimezone(self.tz)
            day = by_day.setdefault(local.date(), {})
            doc = day.setdefault(str(s["doctor_id"]), {
                "doctor_id": str(s["doctor_id"]), "doctor_en": s["doctor_name_en"], "doctor_ar": s["doctor_name_ar"], "times": [],
            })
            doc["times"].append(local.strftime("%H:%M"))
        return {
            "days": [
                {"date": d.isoformat(), "weekday_en": WEEKDAYS_EN[d.weekday()], "weekday_ar": WEEKDAYS_AR[d.weekday()],
                 "doctors": list(docs.values())}
                for d, docs in sorted(by_day.items())
            ],
            "note": "No free times in this range." if not slots else "Times are clinic local time.",
            **({"visit": "online"} if visit == "online" else {}),
        }

    def list_my_appointments(self):
        return {"appointments": [self._appointment(a) for a in my_appointments(self.conn, self.clinic_id, self.phone, now=self.now)]}

    def book_appointment(self, service_id, doctor_id, date, time, patient_name=None, visit="clinic", online_mode=None):
        a = book(self.conn, self.clinic_id, self.phone, service_id, doctor_id, self._at(date, time),
                 full_name=patient_name, visit=visit, online_mode=online_mode, now=self.now)
        return {"appointment": self._appointment(a)}

    def cancel_appointment(self, appointment_id, reason=None):
        return {"appointment": self._appointment(cancel(self.conn, self.clinic_id, self.phone, appointment_id, reason=reason, now=self.now))}

    def reschedule_appointment(self, appointment_id, date, time, doctor_id=None):
        a = reschedule(self.conn, self.clinic_id, self.phone, appointment_id, self._at(date, time), doctor_id=doctor_id, now=self.now)
        return {"appointment": self._appointment(a)}

    def hand_off_to_staff(self, reason, summary):
        h = hand_off(self.conn, self.clinic_id, self.phone, reason, summary)
        return {"handed_off": True, "handoff_id": str(h["id"])}

    # ------------------------------------------------------------ helpers

    def _at(self, d: str, t: str) -> datetime:
        if not re.fullmatch(r"\d{2}:\d{2}", t):
            raise ToolInputError("time must be HH:MM")
        hh, mm = int(t[:2]), int(t[3:])
        if hh > 23 or mm > 59:
            raise ToolInputError("time must be HH:MM")
        return datetime.combine(_parse_date(d), dtime(hh, mm), self.tz)

    def _appointment(self, a: dict) -> dict:
        start = a["starts_at"].astimezone(self.tz)
        price = None if a["price_jod"] is None else f"{'from ' if a['price_is_from'] else ''}{a['price_jod']:.2f} JOD"
        return {
            "appointment_id": str(a["id"]), "status": a["status"],
            "date": start.date().isoformat(), "weekday_en": WEEKDAYS_EN[start.weekday()], "weekday_ar": WEEKDAYS_AR[start.weekday()],
            "time": start.strftime("%H:%M"), "ends": a["ends_at"].astimezone(self.tz).strftime("%H:%M"),
            "doctor_en": a["doctor_name_en"], "doctor_ar": a["doctor_name_ar"],
            "service_en": a["service_name_en"], "service_ar": a["service_name_ar"], "price": price,
            **({"visit": "online (Microsoft Teams)", "online_mode": a.get("online_mode")} if a.get("visit_type") == "online" else {}),
        }


def to_json(result: dict) -> str:
    return json.dumps(result, ensure_ascii=False, default=str)


def _parse_date(d: str) -> date:
    try:
        return date.fromisoformat(d)
    except (TypeError, ValueError):
        raise ToolInputError("date must be YYYY-MM-DD") from None


def _validate(args, schema) -> None:
    """Small schema check for our own tool schemas (object of strings, integers and enums)."""
    if not isinstance(args, dict):
        raise ToolInputError("arguments must be an object")
    props = schema["properties"]
    unknown = set(args) - set(props)
    if unknown:
        raise ToolInputError(f"unknown fields: {', '.join(sorted(unknown))}")
    missing = [k for k in schema.get("required", []) if k not in args]
    if missing:
        raise ToolInputError(f"missing fields: {', '.join(missing)}")
    for key, value in args.items():
        p = props[key]
        if p["type"] == "string":
            if not isinstance(value, str) or not value.strip():
                raise ToolInputError(f"{key} must be a non-empty string")
            if "enum" in p and value not in p["enum"]:
                raise ToolInputError(f"{key} must be one of {p['enum']}")
            if key in _ID_FIELDS:
                try:
                    UUID(value)
                except ValueError:
                    raise ToolInputError(f"{key} is not a valid ID") from None
        elif p["type"] == "integer":
            if not isinstance(value, int) or isinstance(value, bool) or not p.get("minimum", value) <= value <= p.get("maximum", value):
                raise ToolInputError(f"{key} must be an integer between {p.get('minimum')} and {p.get('maximum')}")
