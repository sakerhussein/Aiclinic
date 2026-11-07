"""What happens to one incoming WhatsApp message. Plain code around the agent; no web server here.

Every incoming message is saved first (once: Meta can deliver the same webhook twice), then:
- reminder buttons (step 6) are handled without the AI;
- while staff handle the conversation, nothing is sent back (staff see it on their screen);
- voice notes and other media get a fixed reply, photos and documents go to staff;
- text and Yes / No buttons go to the agent, and its reply is sent and saved.
"""

import logging
from datetime import datetime, timezone
from typing import Callable

import psycopg

from ..agent import run_turn
from ..agent.safety import message_language
from ..booking import hand_off
from .client import WhatsAppClient
from .webhook import Inbound

log = logging.getLogger("limitsiz.whatsapp")

FIXED = {
    "audio": {"ar": "عذراً، لا أستطيع الاستماع للرسائل الصوتية حالياً. ممكن تكتبلي طلبك برسالة نصية؟",
              "en": "Sorry, I can't listen to voice messages yet. Could you type your request instead?"},
    "image": {"ar": "وصلتني الصورة، وحوّلتها لفريق العيادة وسيردّون عليك هنا قريباً.",
              "en": "Thanks, I've received it and passed it to the clinic team. They will reply here soon."},
    "other": {"ar": "عذراً، أستطيع قراءة الرسائل النصية فقط. ممكن تكتبلي طلبك؟",
              "en": "Sorry, I can only read text messages. Could you type your request?"},
}


class Processor:
    def __init__(self, conn: psycopg.Connection, graph, wa: WhatsAppClient,
                 on_button: Callable[["Processor", dict, Inbound], bool] | None = None,
                 now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        """conn: autocommit connection to the booking database. on_button: reminder-button handler (step 6);
        returns True when it handled the message."""
        self.conn, self.graph, self.wa, self.on_button, self.now = conn, graph, wa, on_button, now

    def handle(self, m: Inbound) -> None:
        clinic = self.conn.execute(
            "select id::text, default_language from clinics where wa_phone_number_id = %s and active",
            (m.phone_number_id,)).fetchone()
        if not clinic:
            log.warning("message for unknown WhatsApp number %s", m.phone_number_id)
            return
        clinic_id, default_language = clinic
        conv_id, status, language = self.conn.execute(
            """insert into conversations (clinic_id, wa_phone, profile_name, last_inbound_at,
                                          patient_id)
               values (%s, %s, %s, %s, (select id from patients where clinic_id = %s and phone_e164 = %s))
               on conflict (clinic_id, wa_phone) do update
                 set last_inbound_at = excluded.last_inbound_at,
                     profile_name = coalesce(excluded.profile_name, conversations.profile_name),
                     patient_id = coalesce(conversations.patient_id, excluded.patient_id)
               returning id, status, language""",
            (clinic_id, m.sender, m.profile_name, self.now(), clinic_id, m.sender)).fetchone()
        saved = self.conn.execute(
            """insert into messages (clinic_id, conversation_id, direction, kind, body, wa_message_id, author, media_type, media_id)
               values (%s, %s, 'in', %s, %s, %s, 'patient', %s, %s)
               on conflict (wa_message_id) do nothing returning id""",
            (clinic_id, conv_id, "interactive" if m.kind == "button" else "text", m.text or None, m.wa_message_id,
             m.kind if m.media_id else None, m.media_id)).fetchone()
        if not saved:
            return  # already handled: Meta delivered this webhook twice
        try:
            self.wa.mark_read(m.phone_number_id, m.wa_message_id)
        except Exception:  # noqa: BLE001 - a missing read receipt must not stop the reply
            log.exception("mark_read failed")

        # Only text the patient typed tells the language; button payloads and media do not.
        if m.kind in ("text", "image") and m.text.strip():
            lang = message_language(m.text, language)      # a time or "ok" keeps the conversation's language
            if lang != language:
                self.conn.execute("update conversations set language = %s where id = %s", (lang, conv_id))
        else:
            preferred = self.conn.execute(
                "select preferred_language from patients where clinic_id = %s and phone_e164 = %s",
                (clinic_id, m.sender)).fetchone()
            lang = language or (preferred and preferred[0]) or default_language
        ctx = {"clinic_id": clinic_id, "conversation_id": conv_id, "language": lang}
        if m.kind == "button" and self.on_button and self.on_button(self, ctx, m):
            return
        if status == "handed_off":
            return  # staff are answering; they see this message on their screen
        if not self.conn.execute("select assistant_enabled from clinic_settings where clinic_id = %s", (clinic_id,)).fetchone()[0]:
            return  # the clinic switched the assistant off in Settings; the message is saved for staff
        if m.kind in ("audio", "other"):
            self.send(ctx, m, FIXED[m.kind][lang])
            return
        if m.kind == "image":
            hand_off(self.conn, clinic_id, m.sender, "patient_request",
                     "Patient sent a photo or document (for example an insurance card). See it in the chat.")
            self.send(ctx, m, FIXED["image"][lang])
            return

        reply, awaiting_yes = run_turn(self.graph, clinic_id, m.sender, m.text)
        if reply:
            self.send(ctx, m, reply, buttons=awaiting_yes)

    def send(self, ctx: dict, m: Inbound, text: str, *, buttons: bool = False, author: str = "agent") -> None:
        try:
            if buttons:
                wa_id = self.wa.send_confirm_buttons(m.phone_number_id, m.sender, text, ctx["language"])
            else:
                wa_id = self.wa.send_text(m.phone_number_id, m.sender, text)
        except Exception:
            log.exception("sending to %s failed", m.sender)
            wa_id = None
        self.conn.execute(
            """insert into messages (clinic_id, conversation_id, direction, kind, body, wa_message_id, author)
               values (%s, %s, 'out', %s, %s, %s, %s)""",
            (ctx["clinic_id"], ctx["conversation_id"], "interactive" if buttons else "text", text, wa_id, author))
