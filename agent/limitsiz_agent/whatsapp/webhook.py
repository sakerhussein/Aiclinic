"""Reading Meta's webhook: checking its signature and turning the payload into incoming messages."""

import hashlib
import hmac
from dataclasses import dataclass


@dataclass(frozen=True)
class Inbound:
    phone_number_id: str     # the clinic's WhatsApp number (Meta's ID for it)
    wa_message_id: str
    sender: str              # '+9627...'
    profile_name: str | None
    kind: str                # 'text', 'button' (our Yes/No or a template button), 'audio', 'image', 'other'
    text: str                # the text, or the button's payload; empty for media
    media_id: str | None = None


def signature_ok(app_secret: str, body: bytes, header: str | None) -> bool:
    """Meta signs every webhook with the app secret: X-Hub-Signature-256: sha256=<hex HMAC of the raw body>."""
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[7:])


def parse(payload: dict) -> list[Inbound]:
    """Incoming messages in a webhook payload. Delivery and read statuses are ignored."""
    out = []
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            if change.get("field") != "messages":
                continue
            value = change.get("value") or {}
            pnid = (value.get("metadata") or {}).get("phone_number_id")
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in value.get("contacts") or []}
            for m in value.get("messages") or []:
                if not pnid or not m.get("id") or not m.get("from"):
                    continue
                kind, text, media = "other", "", None
                t = m.get("type")
                if t == "text":
                    kind, text = "text", (m.get("text") or {}).get("body", "")
                elif t == "interactive":
                    i = m.get("interactive") or {}
                    reply = i.get("button_reply") or i.get("list_reply") or {}
                    kind, text = "button", reply.get("id", "")
                elif t == "button":  # quick-reply button on a template, e.g. a reminder
                    kind, text = "button", (m.get("button") or {}).get("payload", "")
                elif t in ("audio", "voice"):
                    kind, media = "audio", (m.get(t) or {}).get("id")
                elif t in ("image", "document"):
                    kind, media = "image", (m.get(t) or {}).get("id")
                    text = (m.get(t) or {}).get("caption", "")
                out.append(Inbound(pnid, m["id"], "+" + m["from"].lstrip("+"), names.get(m["from"]), kind, text, media))
    return out
