"""Sending WhatsApp messages through Meta's WhatsApp Cloud API (Graph API)."""

import httpx

from ..agent.safety import NO_PAYLOAD, YES_PAYLOAD

BUTTON_TITLES = {  # at most 20 characters each
    "ar": {"yes": "نعم، أكّد", "no": "لا"},
    "en": {"yes": "Yes, confirm", "no": "No"},
}


class WhatsAppError(Exception):
    pass


class WhatsAppClient:
    def __init__(self, token: str, graph_version: str = "v23.0", http: httpx.Client | None = None):
        self.base = f"https://graph.facebook.com/{graph_version}"
        self.http = http or httpx.Client(timeout=20)
        self.headers = {"Authorization": f"Bearer {token}"}

    def _post(self, phone_number_id: str, body: dict) -> dict:
        r = self.http.post(f"{self.base}/{phone_number_id}/messages", headers=self.headers,
                           json={"messaging_product": "whatsapp", **body})
        if r.status_code >= 400:
            raise WhatsAppError(f"{r.status_code} {r.text[:500]}")
        return r.json()

    @staticmethod
    def _message_id(response: dict) -> str | None:
        return (response.get("messages") or [{}])[0].get("id")

    def send_text(self, phone_number_id: str, to: str, text: str) -> str | None:
        return self._message_id(self._post(phone_number_id, {
            "to": to.lstrip("+"), "type": "text", "text": {"body": text[:4096], "preview_url": False}}))

    def send_confirm_buttons(self, phone_number_id: str, to: str, text: str, language: str) -> str | None:
        """The reply with Yes / No buttons; a tap comes back as YES_PAYLOAD / NO_PAYLOAD."""
        titles = BUTTON_TITLES.get(language, BUTTON_TITLES["ar"])
        return self._message_id(self._post(phone_number_id, {
            "to": to.lstrip("+"), "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": text[:1024]},
                "action": {"buttons": [
                    {"type": "reply", "reply": {"id": YES_PAYLOAD, "title": titles["yes"]}},
                    {"type": "reply", "reply": {"id": NO_PAYLOAD, "title": titles["no"]}},
                ]},
            }}))

    def send_template(self, phone_number_id: str, to: str, name: str, language: str,
                      body_params: list[str], button_payloads: list[str]) -> str | None:
        """An approved template (needed outside the 24-hour window, e.g. reminders), with quick-reply buttons."""
        components = [{"type": "body", "parameters": [{"type": "text", "text": p} for p in body_params]}]
        for i, payload in enumerate(button_payloads):
            components.append({"type": "button", "sub_type": "quick_reply", "index": str(i),
                               "parameters": [{"type": "payload", "payload": payload}]})
        return self._message_id(self._post(phone_number_id, {
            "to": to.lstrip("+"), "type": "template",
            "template": {"name": name, "language": {"code": language}, "components": components}}))

    def mark_read(self, phone_number_id: str, message_id: str) -> None:
        self._post(phone_number_id, {"status": "read", "message_id": message_id})
