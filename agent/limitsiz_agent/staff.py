"""The staff screen (step 7): today's appointments, the hand-off inbox, and the chat where staff reply.

Plain HTML pages behind one password (HTTP Basic, user "staff"). Every value shown is HTML-escaped (patients write
the messages), and every form POST must come from this site (Origin / Referer check), so a link elsewhere cannot
make a logged-in browser act.
"""

import html
import secrets
import smtplib
from datetime import datetime, time, timedelta, timezone
from email.message import EmailMessage
from typing import Callable
from urllib.parse import urlparse

import psycopg
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from zoneinfo import ZoneInfo

from .whatsapp.client import WhatsAppClient

STATUS_LABEL = {"booked": "Booked", "confirmed": "Confirmed ✅", "cancelled": "Cancelled", "completed": "Done",
                "no_show": "No-show"}
REASON_LABEL = {"emergency": "🚨 Emergency", "medical_question": "Medical question", "patient_request": "Patient request",
                "complaint": "Complaint", "agent_unsure": "AI unsure"}
STYLE = """
:root{--ink:#0A0F14;--paper:#F2F4F3;--mint:#2EE6B5;--accent:#0B7A64;--amber:#FFB23E;--line:#d6dbd9}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,"IBM Plex Sans Arabic",sans-serif;background:var(--paper);color:var(--ink)}
header{background:var(--ink);color:#fff;padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header a{color:var(--mint);text-decoration:none}main{padding:16px;max-width:960px;margin:auto}
table{width:100%;border-collapse:collapse;background:#fff}td,th{padding:8px;border-bottom:1px solid var(--line);text-align:start;vertical-align:top}
.msg{max-width:80%;padding:8px 12px;border-radius:10px;margin:6px 0;white-space:pre-wrap;background:#fff}
.out{margin-inline-start:auto;background:#dff7ef}.staff{background:#fff1d6}.meta{font-size:12px;color:#5a6670}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:6px 12px;cursor:pointer}
button.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}textarea{width:100%;min-height:80px;padding:8px}
.pill{padding:2px 8px;border-radius:99px;background:#e6ebe9;font-size:12px}.warn{color:#9a5b00}form.inline{display:inline}
"""


def create_router(connect: Callable[[], psycopg.Connection], wa: WhatsAppClient | None, password: str,
                  now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> APIRouter:
    router = APIRouter(prefix="/staff")
    security = HTTPBasic(realm="Limitsiz staff")

    def auth(creds: HTTPBasicCredentials = Depends(security)) -> None:
        ok_user = secrets.compare_digest(creds.username.encode(), b"staff")
        ok_pass = bool(password) and secrets.compare_digest(creds.password.encode(), password.encode())
        if not (ok_user and ok_pass):
            raise HTTPException(401, "Wrong password", headers={"WWW-Authenticate": 'Basic realm="Limitsiz staff"'})

    def same_site(request: Request) -> None:
        source = request.headers.get("origin") or request.headers.get("referer")
        if not source or urlparse(source).netloc != request.url.netloc:
            raise HTTPException(403, "Form must be sent from the staff screen")

    def page(title: str, body: str) -> HTMLResponse:
        return HTMLResponse(
            f'<!doctype html><html dir="auto"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f"<title>{html.escape(title)} · Limitsiz staff</title><style>{STYLE}</style></head><body>"
            '<header><strong>Limitsiz Clinic · staff</strong><a href="/staff">Today</a><a href="/staff/inbox">Inbox</a></header>'
            f"<main>{body}</main></body></html>")

    e = html.escape

    @router.get("", dependencies=[Depends(auth)])
    def today(day: str | None = None):
        with connect() as conn:
            clinics = conn.execute("select id, name_en, timezone from clinics where active order by name_en").fetchall()
            parts, open_count = [], conn.execute("select count(*) from handoffs where status = 'open'").fetchone()[0]
            for clinic_id, name, tz in clinics:
                local_day = datetime.fromisoformat(day).date() if day else now().astimezone(ZoneInfo(tz)).date()
                start = datetime.combine(local_day, time(0), ZoneInfo(tz))
                rows = conn.execute(
                    """select a.id, a.starts_at, a.status::text, coalesce(p.full_name, ''), p.phone_e164, s.name_en, d.name_en,
                              (select c.id from conversations c where c.clinic_id = a.clinic_id and c.wa_phone = p.phone_e164)
                       from appointments a join patients p on p.id = a.patient_id join services s on s.id = a.service_id
                       join doctors d on d.id = a.doctor_id
                       where a.clinic_id = %s and a.starts_at >= %s and a.starts_at < %s order by a.starts_at, d.name_en""",
                    (clinic_id, start, start + timedelta(days=1))).fetchall()
                trs = []
                for appt_id, starts, status, pname, phone, svc, doc, conv in rows:
                    actions = "" if status not in ("booked", "confirmed") else "".join(
                        f'<form class="inline" method="post" action="/staff/appointment/{appt_id}/status">'
                        f'<input type="hidden" name="status" value="{v}"><button class="secondary">{label}</button></form> '
                        for v, label in (("completed", "Done"), ("no_show", "No-show")))
                    chat = f'<a href="/staff/chat/{conv}">chat</a>' if conv else ""
                    trs.append(f"<tr><td>{starts.astimezone(ZoneInfo(tz)):%H:%M}</td><td>{e(pname)}<br><span class='meta'>{e(phone)}</span> {chat}</td>"
                               f"<td>{e(svc)}</td><td>{e(doc)}</td><td><span class='pill'>{STATUS_LABEL.get(status, status)}</span></td><td>{actions}</td></tr>")
                prev, nxt = local_day - timedelta(days=1), local_day + timedelta(days=1)
                parts.append(f"<h2>{e(name)} · {local_day:%A %d %B %Y}</h2>"
                             f'<p><a href="/staff?day={prev}">← {prev:%a %d}</a> · <a href="/staff?day={nxt}">{nxt:%a %d} →</a></p>'
                             + ("<table><tr><th>Time</th><th>Patient</th><th>Service</th><th>Doctor</th><th>Status</th><th></th></tr>"
                                + "".join(trs) + "</table>" if trs else "<p>No appointments.</p>"))
        banner = f'<p class="warn"><a href="/staff/inbox">{open_count} open hand-off(s) waiting</a></p>' if open_count else ""
        return page("Today", banner + "".join(parts))

    @router.get("/inbox", dependencies=[Depends(auth)])
    def inbox():
        with connect() as conn:
            rows = conn.execute(
                """select h.reason, h.summary, h.created_at, c.id, c.wa_phone, coalesce(p.full_name, c.profile_name, ''), cl.timezone
                   from handoffs h join conversations c on c.id = h.conversation_id join clinics cl on cl.id = h.clinic_id
                   left join patients p on p.id = c.patient_id
                   where h.status = 'open' order by (h.reason = 'emergency') desc, h.created_at""").fetchall()
        trs = "".join(
            f"<tr><td>{REASON_LABEL.get(r, e(r))}</td><td>{e(name)}<br><span class='meta'>{e(phone)}</span></td>"
            f"<td>{e(summary or '')}</td><td class='meta'>{created.astimezone(ZoneInfo(tz)):%d/%m %H:%M}</td>"
            f'<td><a href="/staff/chat/{conv}">Open chat</a></td></tr>'
            for r, summary, created, conv, phone, name, tz in rows)
        return page("Inbox", "<h2>Hand-offs waiting for the team</h2>" + (
            f"<table><tr><th>Reason</th><th>Patient</th><th>Summary</th><th>Since</th><th></th></tr>{trs}</table>" if rows
            else "<p>Nothing waiting. 🎉</p>"))

    @router.get("/chat/{conversation_id}", dependencies=[Depends(auth)])
    def chat(conversation_id: str, error: str | None = None):
        with connect() as conn:
            conv = conn.execute(
                """select c.wa_phone, coalesce(p.full_name, c.profile_name, ''), c.status, c.last_inbound_at, cl.timezone
                   from conversations c join clinics cl on cl.id = c.clinic_id left join patients p on p.id = c.patient_id
                   where c.id::text = %s""", (conversation_id,)).fetchone()
            if not conv:
                raise HTTPException(404)
            phone, name, status, last_in, tz = conv
            msgs = conn.execute(
                """select direction, author, body, media_type, created_at from messages
                   where conversation_id::text = %s order by created_at desc limit 200""", (conversation_id,)).fetchall()[::-1]
        bubbles = "".join(
            f'<div class="msg {"out" if d == "out" else ""} {"staff" if a == "staff" else ""}">'
            f"{e(b or '')}{f'<em>[{e(mt)} — open WhatsApp Business to view]</em>' if mt else ''}"
            f'<div class="meta">{e(a or "")} · {t.astimezone(ZoneInfo(tz)):%d/%m %H:%M}</div></div>'
            for d, a, b, mt, t in msgs)
        window_open = bool(last_in and now() - last_in < timedelta(hours=24))
        if status == "handed_off":
            controls = (f'<form method="post" action="/staff/chat/{conversation_id}/reply"><textarea name="text" dir="auto" required '
                        f'placeholder="Reply to the patient on WhatsApp"></textarea><p><button>Send</button></p></form>'
                        if window_open else
                        "<p class='warn'>The patient's last message is more than 24 hours old, so WhatsApp only allows "
                        "template messages now. Call the patient instead.</p>")
            controls += (f'<form method="post" action="/staff/chat/{conversation_id}/hand-back"><button class="secondary">'
                         "Done: hand the chat back to the AI</button></form>")
        else:
            controls = (f'<form method="post" action="/staff/chat/{conversation_id}/take-over"><button class="secondary">'
                        "Take over this chat (the AI stops replying)</button></form>")
        err = f"<p class='warn'>{e(error)}</p>" if error else ""
        return page(name or phone, f"<h2>{e(name)} <span class='meta'>{e(phone)}</span> <span class='pill'>"
                                   f"{'Staff handling' if status == 'handed_off' else 'AI handling'}</span></h2>{err}{bubbles}<hr>{controls}")

    @router.post("/chat/{conversation_id}/reply", dependencies=[Depends(auth), Depends(same_site)])
    def reply(conversation_id: str, text: str = Form(...)):
        with connect() as conn:
            row = conn.execute(
                """select c.clinic_id, c.wa_phone, c.last_inbound_at, cl.wa_phone_number_id from conversations c
                   join clinics cl on cl.id = c.clinic_id where c.id::text = %s and c.status = 'handed_off'""",
                (conversation_id,)).fetchone()
            if not row:
                raise HTTPException(404)
            clinic_id, phone, last_in, pnid = row
            if wa is None:
                return RedirectResponse(f"/staff/chat/{conversation_id}?error=WhatsApp+is+not+connected+yet", 303)
            if not (last_in and now() - last_in < timedelta(hours=24)) or not pnid:
                return RedirectResponse(f"/staff/chat/{conversation_id}?error=Cannot+send:+outside+the+24-hour+window", 303)
            try:
                wa_id = wa.send_text(pnid, phone, text.strip())
            except Exception as ex:  # noqa: BLE001 - shown to staff
                return RedirectResponse(f"/staff/chat/{conversation_id}?error=" + str(ex)[:200].replace(" ", "+"), 303)
            conn.execute(
                """insert into messages (clinic_id, conversation_id, direction, kind, body, wa_message_id, author)
                   values (%s, %s, 'out', 'text', %s, %s, 'staff')""", (clinic_id, conversation_id, text.strip(), wa_id))
        return RedirectResponse(f"/staff/chat/{conversation_id}", 303)

    @router.post("/chat/{conversation_id}/hand-back", dependencies=[Depends(auth), Depends(same_site)])
    def hand_back(conversation_id: str):
        with connect() as conn, conn.transaction():
            conn.execute("update conversations set status = 'active' where id::text = %s", (conversation_id,))
            conn.execute("""update handoffs set status = 'resolved', resolved_at = %s, resolved_by = 'staff'
                            where conversation_id::text = %s and status = 'open'""", (now(), conversation_id))
        return RedirectResponse("/staff/inbox", 303)

    @router.post("/chat/{conversation_id}/take-over", dependencies=[Depends(auth), Depends(same_site)])
    def take_over(conversation_id: str):
        with connect() as conn:
            conn.execute("update conversations set status = 'handed_off' where id::text = %s", (conversation_id,))
        return RedirectResponse(f"/staff/chat/{conversation_id}", 303)

    @router.post("/appointment/{appointment_id}/status", dependencies=[Depends(auth), Depends(same_site)])
    def set_status(appointment_id: str, status: str = Form(...)):
        if status not in ("completed", "no_show"):
            raise HTTPException(400)
        with connect() as conn, conn.transaction():
            clinic = conn.execute("select clinic_id from appointments where id::text = %s", (appointment_id,)).fetchone()
            conn.execute("select audit.set_actor('system', 'agent-staff-screen', 'Basic staff screen (shared password)', "
                         "null, null, null, null, %s)", (clinic[0] if clinic else None,))
            conn.execute("update appointments set status = %s where id::text = %s and status in ('booked', 'confirmed')",
                         (status, appointment_id))
        return RedirectResponse("/staff", 303)

    return router


def alert_new_handoffs(conn: psycopg.Connection, smtp: dict, base_url: str, default_to: str | None) -> int:
    """Emails the clinic about each new hand-off once. smtp: host, port, user, password, sender."""
    with conn.transaction():
        rows = conn.execute(
            """select h.id, h.reason, h.summary, c.id, c.wa_phone, coalesce(cl.staff_alert_email, %s), cl.name_en
               from handoffs h join conversations c on c.id = h.conversation_id join clinics cl on cl.id = h.clinic_id
               where h.alerted_at is null and h.status = 'open' for update of h skip locked""", (default_to,)).fetchall()
        for row in rows:
            conn.execute("update handoffs set alerted_at = now() where id = %s", (row[0],))
    sent = 0
    for _, reason, summary, conv, phone, to, clinic in rows:
        if not to or not smtp.get("host"):
            continue
        msg = EmailMessage()
        msg["Subject"] = f"{REASON_LABEL.get(reason, reason)} · WhatsApp {phone} · {clinic}"
        msg["From"], msg["To"] = smtp.get("sender") or smtp.get("user"), to
        msg.set_content(f"{summary or ''}\n\nOpen the chat: {base_url.rstrip('/')}/staff/chat/{conv}\n")
        port = int(smtp.get("port") or 465)
        with (smtplib.SMTP_SSL(smtp["host"], port, timeout=20) if port == 465 else smtplib.SMTP(smtp["host"], port, timeout=20)) as s:
            if port != 465:
                s.starttls()
            if smtp.get("user"):
                s.login(smtp["user"], smtp.get("password") or "")
            s.send_message(msg)
        sent += 1
    return sent
