"""Find my booking (online booking page): sends a NEW private link by WhatsApp to a patient who lost theirs.

The page only queues requests (public.online_find, migration 0013). Here, every minute:
- the new link is made at the moment it is sent, so it is never stored: only its SHA-256 replaces the old one on the booking,
  and the old hash is kept on the request so the old link can say "replaced" instead of "not found";
- a request is marked as sent before the message goes out, so a crash can cost a message but never repeat one;
- a request whose booking is no longer upcoming, whose number changed, or whose clinic switched the feature off is skipped.
The message is an approved WhatsApp template ("booking link"); its text is in Settings > Online booking (find_message_*),
with {clinic}, {when}, {doctor} and {link} as the template's {{1}}..{{4}}.
"""

import hashlib
import logging
import secrets
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg

from ..agent.tools import WEEKDAYS_AR, WEEKDAYS_EN
from ..booking import set_actor
from .client import WhatsAppClient

log = logging.getLogger("limitsiz.links")

PLACEHOLDERS = ["{clinic}", "{when}", "{doctor}", "{link}"]

_DUE = """
    select r.id::text, r.clinic_id::text, a.id::text, a.manage_token_hash, a.starts_at, a.status, r.phone_e164,
           c.slug, c.timezone, c.wa_phone_number_id, c.default_language, c.name_en, c.name_ar,
           p.phone_e164, p.preferred_language, d.name_en, d.name_ar, (o.enabled and o.find_enabled and c.active) as on_
    from link_requests r
    join appointments a on a.id = r.appointment_id
    join clinics c on c.id = r.clinic_id
    join patients p on p.id = a.patient_id
    join doctors d on d.id = a.doctor_id
    join online_booking o on o.clinic_id = r.clinic_id
    where r.status = 'pending' and c.wa_phone_number_id is not null
    order by r.created_at
    limit 50
    for update of r skip locked"""


def when_text(starts_at: datetime, tz: str, lang: str) -> str:
    local = starts_at.astimezone(ZoneInfo(tz))
    if lang == "ar":
        return f"{WEEKDAYS_AR[local.weekday()]} {local:%d/%m} الساعة {local:%H:%M}"
    return f"{WEEKDAYS_EN[local.weekday()]} {local:%d/%m} at {local:%H:%M}"


def send_due_links(conn: psycopg.Connection, wa: WhatsAppClient, template: str, now: datetime, site_url: str) -> int:
    """Sends every queued "Find my booking" link. Returns how many were sent."""
    out = []
    with conn.transaction():
        for (req_id, clinic_id, appt_id, old_hash, starts_at, status, asked_phone, slug, tz, pnid, default_lang,
             clinic_en, clinic_ar, phone, pref_lang, doc_en, doc_ar, on) in conn.execute(_DUE).fetchall():
            if not on or status not in ("booked", "confirmed") or starts_at <= now or phone != asked_phone or not old_hash:
                conn.execute("update link_requests set status = 'skipped' where id = %s", (req_id,))
                continue
            token = secrets.token_urlsafe(32)                   # 43 characters, like the page's own links
            set_actor(conn, clinic_id, "Patient asked for a new booking link (Find my booking)")
            conn.execute("update appointments set manage_token_hash = %s where id = %s",
                         (hashlib.sha256(token.encode()).hexdigest(), appt_id))
            conn.execute("update link_requests set status = 'sent', sent_at = %s, old_token_hash = %s where id = %s",
                         (now, old_hash, req_id))
            lang = pref_lang or default_lang
            link = f"{site_url.rstrip('/')}/{slug}/manage#{token}"
            params = ([clinic_ar, when_text(starts_at, tz, "ar"), doc_ar, link] if lang == "ar"
                      else [clinic_en, when_text(starts_at, tz, "en"), doc_en, link])
            out.append((req_id, pnid, phone, lang, params))
    sent = 0
    for req_id, pnid, phone, lang, params in out:
        try:
            wa.send_template(pnid, phone, template, lang, params, [])
            sent += 1
        except Exception as e:  # noqa: BLE001 - recorded; the patient can ask again or call the clinic
            log.exception("booking link %s failed", req_id)
            conn.execute("update link_requests set status = 'failed', error = %s where id = %s", (str(e)[:300], req_id))
    return sent


def forget_old_requests(conn: psycopg.Connection, now: datetime) -> int:
    """Requests hold a phone number and an address: kept only until the appointment is over (a day after)."""
    return conn.execute("""delete from link_requests r using appointments a
                           where a.id = r.appointment_id and a.ends_at < %s - interval '1 day'""", (now,)).rowcount


def template_text(message_en: str, message_ar: str) -> dict:
    """The template to create in Meta (WhatsApp Manager > Message templates), category Utility, from the clinic's Settings text."""
    def to_meta(text: str) -> str:
        for i, p in enumerate(PLACEHOLDERS, 1):
            text = text.replace(p, "{{%d}}" % i)
        return text
    return {"en": {"body": to_meta(message_en)}, "ar": {"body": to_meta(message_ar)}}
