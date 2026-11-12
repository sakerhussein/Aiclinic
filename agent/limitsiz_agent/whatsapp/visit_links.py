"""Online visits, phase 2: the "Join the visit" link on WhatsApp, sent by itself (design booking/design/online-visits.html §5).

Every minute, for each online visit whose patient chose WhatsApp for the link (on the booking page, in the chat, on WhatsApp,
or set by staff), once the clinic confirmed it (or once it is booked, when the clinic sends links on booking):
- a new Join link is made at the moment it is sent; only its SHA-256 is stored (join_links, auto = 'confirmed');
- the booking is marked (link_sent_at) before the message goes out, so a crash can cost a message but never repeat one.
  The mark is cleared when the time or the doctor changes, so the patient is told again once the new time is confirmed;
- a message that fails stops its link at once, and staff see no link sent, so they can send one from the booking.
The message is an approved WhatsApp template ("visit link"); its text is the clinic's own (Settings > Online visits >
message_*), with {clinic}, {doctor}, {when} and {link} as the template's {{1}}..{{4}}, between a fixed first and last line.
Phase 1's one-button send from the clinic's own WhatsApp stays for staff; this needs WA_VISIT_LINK_TEMPLATE in agent/.env.
"""

import hashlib
import logging
import secrets
from datetime import datetime

import psycopg

from ..booking import set_actor
from .client import WhatsAppClient
from .links import when_text

log = logging.getLogger("limitsiz.visit_links")

PLACEHOLDERS = ["{clinic}", "{doctor}", "{when}", "{link}"]
# The template's fixed first and last lines: Meta does not accept a template that starts or ends with a variable.
FIRST_LINE = {"en": "Your online visit link", "ar": "رابط زيارتك أونلاين"}
LAST_LINE = {"en": "Not for emergencies.", "ar": "ليست للطوارئ."}

_DUE = """
    select a.id::text, a.clinic_id::text, a.starts_at, c.slug, c.timezone, c.wa_phone_number_id, c.default_language,
           c.name_en, c.name_ar, p.phone_e164, p.preferred_language, d.name_en, d.name_ar, o.message_en, o.message_ar
    from appointments a
    join clinics c on c.id = a.clinic_id
    join patients p on p.id = a.patient_id
    join doctors d on d.id = a.doctor_id
    join online_visits o on o.clinic_id = a.clinic_id
    where a.visit_type = 'online' and a.link_channel = 'whatsapp' and a.link_sent_at is null
      and (a.status = 'confirmed' or (o.link_when = 'booked' and a.status = 'booked'))
      and o.enabled and 'whatsapp' = any(o.channels) and c.active and c.wa_phone_number_id is not null
      and p.phone_e164 is not null and a.ends_at + make_interval(mins => o.join_closes_minutes) > %(now)s
    order by a.starts_at
    limit 50
    for update of a skip locked"""


def new_join_link(conn: psycopg.Connection, clinic_id: str, appointment_id: str, slug: str, site_url: str, auto: str,
                  reason: str) -> tuple[str, str]:
    """Makes a Join link for one booking and records its hash. Returns (link, join_links id). The token is never stored."""
    token = secrets.token_urlsafe(32)                       # 43 characters, like the page's own links
    with conn.transaction():
        set_actor(conn, clinic_id, reason)
        link_id = conn.execute(
            """insert into join_links (clinic_id, appointment_id, token_hash, channel, auto)
               values (%s, %s, %s, 'whatsapp', %s) returning id::text""",
            (clinic_id, appointment_id, hashlib.sha256(token.encode()).hexdigest(), auto)).fetchone()[0]
    return f"{site_url.rstrip('/')}/{slug}/j#{token}", link_id


def stop_link(conn: psycopg.Connection, link_id: str, now: datetime) -> None:
    conn.execute("update join_links set stopped_at = %s where id = %s", (now, link_id))


def send_due_visit_links(conn: psycopg.Connection, wa: WhatsAppClient, template: str, now: datetime, site_url: str) -> int:
    """Sends the visit link of every online visit that is due one. Returns how many were sent."""
    with conn.transaction():
        rows = conn.execute(_DUE, {"now": now}).fetchall()
        for r in rows:
            conn.execute("update appointments set link_sent_at = %s where id = %s", (now, r[0]))
    sent = 0
    for (appt_id, clinic_id, starts_at, slug, tz, pnid, default_lang, clinic_en, clinic_ar, phone, pref_lang,
         doc_en, doc_ar, msg_en, msg_ar) in rows:
        lang = pref_lang if pref_lang in ("ar", "en") else default_lang
        link, link_id = new_join_link(conn, clinic_id, appt_id, slug, site_url, "confirmed", "Visit link sent on WhatsApp")
        params = ([clinic_ar, doc_ar, when_text(starts_at, tz, "ar"), link] if lang == "ar"
                  else [clinic_en, doc_en, when_text(starts_at, tz, "en"), link])
        try:
            wa.send_template(pnid, phone, template, lang, params, [])
            sent += 1
        except Exception:  # noqa: BLE001 - the link is stopped; staff see nothing sent and can send one from the booking
            log.exception("visit link for appointment %s failed", appt_id)
            stop_link(conn, link_id, now)
    return sent


def template_text(message_en: str, message_ar: str) -> dict:
    """The template to create in Meta (WhatsApp Manager > Message templates), category Utility, from the clinic's Settings text."""
    def to_meta(text: str, lang: str) -> str:
        for i, p in enumerate(PLACEHOLDERS, 1):
            text = text.replace(p, "{{%d}}" % i)
        return f"{FIRST_LINE[lang]}\n{text.strip()}\n{LAST_LINE[lang]}"
    return {"en": {"body": to_meta(message_en, "en")}, "ar": {"body": to_meta(message_ar, "ar")}}
