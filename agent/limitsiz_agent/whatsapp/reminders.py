"""Appointment reminders (step 6), sent as an approved WhatsApp template with Confirm / Change buttons.

- 24 hours before: once, when the appointment is 2 to 24 hours away, unless it was booked in the last hour.
- 2 hours before: once, when the appointment is less than 2 hours away.
A reminder is marked as sent before it goes out, so a crash can cost a reminder but never repeat one.

Buttons come back as REMIND_CONFIRM:<appointment id> (confirmed here, no AI) and REMIND_CHANGE:<appointment id>
(handed to the agent as "I want to change my appointment").
"""

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg

from ..agent import run_turn
from ..agent.tools import WEEKDAYS_AR, WEEKDAYS_EN
from .client import WhatsAppClient
from .webhook import Inbound

log = logging.getLogger("limitsiz.reminders")

CONFIRM, CHANGE = "REMIND_CONFIRM:", "REMIND_CHANGE:"
REPLIES = {
    "confirmed": {"ar": "تم تأكيد موعدك ✅ بنستناك {when}.", "en": "Your appointment is confirmed ✅ See you {when}."},
    "not_found": {"ar": "عذراً، لم أجد هذا الموعد، ربما تم تغييره أو إلغاؤه. اكتبلي إذا بدك أساعدك بموعد جديد.",
                  "en": "Sorry, I couldn't find that appointment; it may have been changed or cancelled. "
                        "Message me if you'd like a new one."},
}
CHANGE_REQUEST = {"ar": "بدي أغيّر موعدي", "en": "I want to change my appointment"}

_DUE = """
    select a.id::text, a.starts_at, c.id::text as clinic_id, c.timezone, c.wa_phone_number_id, c.default_language,
           p.phone_e164, p.preferred_language, d.name_en, d.name_ar, s.name_en, s.name_ar
    from appointments a
    join clinics c on c.id = a.clinic_id
    join patients p on p.id = a.patient_id
    join doctors d on d.id = a.doctor_id
    join services s on s.id = a.service_id
    where a.status in ('booked', 'confirmed') and c.active and c.wa_phone_number_id is not null
      and {condition}
    order by a.starts_at
    for update of a skip locked"""

KINDS = {
    "24h": ("reminder_24h_at",
            "a.reminder_24h_at is null and a.starts_at > %(now)s + interval '2 hours' "
            "and a.starts_at <= %(now)s + interval '24 hours' and a.created_at <= %(now)s - interval '1 hour'"),
    "2h": ("reminder_2h_at",
           "a.reminder_2h_at is null and a.starts_at > %(now)s and a.starts_at <= %(now)s + interval '2 hours'"),
}


def send_due_reminders(conn: psycopg.Connection, wa: WhatsAppClient, template: str, now: datetime) -> int:
    """Sends every reminder that is due now. Returns how many were sent."""
    sent = 0
    for kind, (column, condition) in KINDS.items():
        with conn.transaction():
            rows = conn.execute(_DUE.format(condition=condition), {"now": now}).fetchall()
            for r in rows:
                conn.execute(f"update appointments set {column} = %s where id = %s", (now, r[0]))
        for (appt_id, starts_at, clinic_id, tz, pnid, default_lang, phone, pref_lang,
             doc_en, doc_ar, svc_en, svc_ar) in rows:
            lang = pref_lang or default_lang
            local = starts_at.astimezone(ZoneInfo(tz))
            params = ([svc_ar, doc_ar, f"{WEEKDAYS_AR[local.weekday()]} {local:%d/%m}", f"{local:%H:%M}"] if lang == "ar"
                      else [svc_en, doc_en, f"{WEEKDAYS_EN[local.weekday()]} {local:%d/%m}", f"{local:%H:%M}"])
            try:
                wa_id = wa.send_template(pnid, phone, template, lang, params, [CONFIRM + appt_id, CHANGE + appt_id])
            except Exception:  # noqa: BLE001 - logged; the reminder stays marked so it is never sent twice
                log.exception("%s reminder for appointment %s failed", kind, appt_id)
                continue
            _log_outgoing(conn, clinic_id, phone, f"[{kind} reminder] {' | '.join(params)}", wa_id)
            sent += 1
    return sent


def handle_button(proc, ctx: dict, m: Inbound) -> bool:
    """Processor hook for reminder buttons. Returns False for any other button (e.g. Yes / No)."""
    if m.text.startswith(CONFIRM):
        appt_id, lang = m.text[len(CONFIRM):], ctx["language"]
        row = proc.conn.execute(
            """update appointments a set status = 'confirmed', confirmed_at = %s
               from patients p, clinics c
               where a.id::text = %s and p.id = a.patient_id and c.id = a.clinic_id
                 and a.clinic_id = %s and p.phone_e164 = %s
                 and a.status in ('booked', 'confirmed') and a.starts_at > %s
               returning a.starts_at, c.timezone""",
            (proc.now(), appt_id, ctx["clinic_id"], m.sender, proc.now())).fetchone()
        if row:
            local = row[0].astimezone(ZoneInfo(row[1]))
            day = WEEKDAYS_AR[local.weekday()] if lang == "ar" else WEEKDAYS_EN[local.weekday()]
            when = f"{day} {local:%d/%m} الساعة {local:%H:%M}" if lang == "ar" else f"{day} {local:%d/%m} at {local:%H:%M}"
            proc.send(ctx, m, REPLIES["confirmed"][lang].format(when=when), author="system")
        else:
            proc.send(ctx, m, REPLIES["not_found"][lang], author="system")
        return True
    if m.text.startswith(CHANGE):
        reply, awaiting_yes = run_turn(proc.graph, ctx["clinic_id"], m.sender, CHANGE_REQUEST[ctx["language"]])
        if reply:
            proc.send(ctx, m, reply, buttons=awaiting_yes)
        return True
    return False


def _log_outgoing(conn, clinic_id: str, phone: str, body: str, wa_id: str | None) -> None:
    conv = conn.execute(
        """insert into conversations (clinic_id, wa_phone, patient_id)
           values (%s, %s, (select id from patients where clinic_id = %s and phone_e164 = %s))
           on conflict (clinic_id, wa_phone) do update set wa_phone = excluded.wa_phone returning id""",
        (clinic_id, phone, clinic_id, phone)).fetchone()[0]
    conn.execute(
        """insert into messages (clinic_id, conversation_id, direction, kind, body, wa_message_id, author)
           values (%s, %s, 'out', 'template', %s, %s, 'reminder')""", (clinic_id, conv, body, wa_id))


def template_text() -> dict:
    """The template to create in Meta (WhatsApp Manager > Message templates), category Utility, name as configured."""
    return {
        "ar": {"body": "تذكير بموعدك في العيادة: {{1}} مع {{2}}، يوم {{3}} الساعة {{4}}. هل ستحضر؟",
               "buttons": ["تأكيد الموعد", "تغيير الموعد"]},
        "en": {"body": "Reminder of your clinic appointment: {{1}} with {{2}} on {{3}} at {{4}}. Will you attend?",
               "buttons": ["Confirm", "Change"]},
    }
