"""Appointment reminders (step 6), sent as an approved WhatsApp template with Confirm / Change buttons.

Timing comes from each clinic's Settings (default 24 hours and 2 hours before; at most two reminders):
- first: once, when the appointment is closer than the first offset but not yet inside the second, unless it was booked in the last hour;
- second: once, when the appointment is closer than the second offset.
Nothing goes out in the clinic's quiet hours (default 21:00-08:00 local); what is still due is sent when they end.
The columns keep their old names (reminder_24h_at = first, reminder_2h_at = second).
A reminder is marked as sent before it goes out, so a crash can cost a reminder but never repeat one.

An online visit (when the clinic has online visits on and WA_ONLINE_REMINDER_TEMPLATE is set) gets the online version,
which also carries a new "Join the visit" link made for that reminder (only its hash is kept, in join_links).

Buttons come back as REMIND_CONFIRM:<appointment id> (confirmed here, no AI) and REMIND_CHANGE:<appointment id>
(handed to the agent as "I want to change my appointment").
"""

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg

from ..agent import run_turn
from ..booking import set_actor
from ..agent.tools import WEEKDAYS_AR, WEEKDAYS_EN
from .client import WhatsAppClient
from .visit_links import new_join_link, stop_link
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
           p.phone_e164, p.preferred_language, d.name_en, d.name_ar, s.name_en, s.name_ar,
           (a.visit_type = 'online' and coalesce(o.enabled, false)) as online, c.slug
    from appointments a
    join clinics c on c.id = a.clinic_id
    join patients p on p.id = a.patient_id
    join doctors d on d.id = a.doctor_id
    join services s on s.id = a.service_id
    join clinic_settings cs on cs.clinic_id = c.id
    left join online_visits o on o.clinic_id = c.id
    where a.status in ('booked', 'confirmed') and c.active and c.wa_phone_number_id is not null
      and p.phone_e164 is not null and p.whatsapp_reminders and cs.reminders_enabled
      and not (case when cs.quiet_start <= cs.quiet_end
                    then (%(now)s at time zone c.timezone)::time >= cs.quiet_start and (%(now)s at time zone c.timezone)::time < cs.quiet_end
                    else (%(now)s at time zone c.timezone)::time >= cs.quiet_start or (%(now)s at time zone c.timezone)::time < cs.quiet_end end)
      and {condition}
    order by a.starts_at
    for update of a skip locked"""

KINDS = {
    "first": ("reminder_24h_at",
              "a.reminder_24h_at is null and cardinality(cs.reminder_offsets_minutes) >= 1 "
              "and a.starts_at > %(now)s + make_interval(mins => coalesce(cs.reminder_offsets_minutes[2], 0)) "
              "and a.starts_at <= %(now)s + make_interval(mins => cs.reminder_offsets_minutes[1]) "
              "and a.created_at <= %(now)s - interval '1 hour'"),
    "second": ("reminder_2h_at",
               "a.reminder_2h_at is null and cardinality(cs.reminder_offsets_minutes) = 2 and a.starts_at > %(now)s "
               "and a.starts_at <= %(now)s + make_interval(mins => cs.reminder_offsets_minutes[2])"),
}


def send_due_reminders(conn: psycopg.Connection, wa: WhatsAppClient, template: str, now: datetime,
                       online_template: str | None = None, site_url: str | None = None) -> int:
    """Sends every reminder that is due now. Returns how many were sent. Without online_template, online visits get the
    usual reminder (as in phase 1)."""
    sent = 0
    for kind, (column, condition) in KINDS.items():
        with conn.transaction():
            rows = conn.execute(_DUE.format(condition=condition), {"now": now}).fetchall()
            for r in rows:
                conn.execute(f"update appointments set {column} = %s where id = %s", (now, r[0]))
        for (appt_id, starts_at, clinic_id, tz, pnid, default_lang, phone, pref_lang,
             doc_en, doc_ar, svc_en, svc_ar, online, slug) in rows:
            lang = pref_lang or default_lang
            local = starts_at.astimezone(ZoneInfo(tz))
            params = ([svc_ar, doc_ar, f"{WEEKDAYS_AR[local.weekday()]} {local:%d/%m}", f"{local:%H:%M}"] if lang == "ar"
                      else [svc_en, doc_en, f"{WEEKDAYS_EN[local.weekday()]} {local:%d/%m}", f"{local:%H:%M}"])
            name, link_id = template, None
            if online and online_template and site_url:
                link, link_id = new_join_link(conn, clinic_id, appt_id, slug, site_url, "reminder", f"Join link in the {kind} reminder")
                name, params = online_template, [*params, link]
            try:
                wa_id = wa.send_template(pnid, phone, name, lang, params, [CONFIRM + appt_id, CHANGE + appt_id])
            except Exception:  # noqa: BLE001 - logged; the reminder stays marked so it is never sent twice
                log.exception("%s reminder for appointment %s failed", kind, appt_id)
                if link_id:
                    stop_link(conn, link_id, now)
                continue
            _log_outgoing(conn, clinic_id, phone, f"[{kind} reminder] {' | '.join(params)}", wa_id)
            sent += 1
    return sent


def handle_button(proc, ctx: dict, m: Inbound) -> bool:
    """Processor hook for reminder buttons. Returns False for any other button (e.g. Yes / No)."""
    if m.text.startswith(CONFIRM):
        appt_id, lang = m.text[len(CONFIRM):], ctx["language"]
        with proc.conn.transaction():
            set_actor(proc.conn, ctx["clinic_id"], "Patient confirmed from the reminder")
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


def online_template_text() -> dict:
    """The online-visit reminder to create in Meta (WA_ONLINE_REMINDER_TEMPLATE), category Utility, with the same two buttons."""
    return {
        "ar": {"body": "تذكير بزيارتك أونلاين: {{1}} مع {{2}}، يوم {{3}} الساعة {{4}}. ادخل الزيارة من هذا الرابط قرب الموعد: {{5}}\n"
                       "هل ستحضر؟ ليست للطوارئ.",
               "buttons": ["تأكيد الموعد", "تغيير الموعد"]},
        "en": {"body": "Reminder of your online visit: {{1}} with {{2}} on {{3}} at {{4}}. Join from this link near the time: {{5}}\n"
                       "Will you attend? Not for emergencies.",
               "buttons": ["Confirm", "Change"]},
    }


def template_text() -> dict:
    """The template to create in Meta (WhatsApp Manager > Message templates), category Utility, name as configured."""
    return {
        "ar": {"body": "تذكير بموعدك في العيادة: {{1}} مع {{2}}، يوم {{3}} الساعة {{4}}. هل ستحضر؟",
               "buttons": ["تأكيد الموعد", "تغيير الموعد"]},
        "en": {"body": "Reminder of your clinic appointment: {{1}} with {{2}} on {{3}} at {{4}}. Will you attend?",
               "buttons": ["Confirm", "Change"]},
    }
