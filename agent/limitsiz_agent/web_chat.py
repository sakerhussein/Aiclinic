"""Housekeeping for the assistant on the online booking page (agent/web.py): call-back emails and forgetting old chats."""

import smtplib
from datetime import datetime
from email.message import EmailMessage

import psycopg

REASON = {"patient_request": "Wants to talk to a person", "medical_question": "Medical question", "complaint": "Complaint",
          "agent_unsure": "The assistant could not help", "emergency": "POSSIBLE EMERGENCY"}


def record_emergency(conn: psycopg.Connection, clinic_id: str, chat_id: str, text: str) -> None:
    """The page's chat matched an emergency sign: staff are told, as on WhatsApp (there is no number to call back)."""
    conn.execute("""insert into web_callbacks (clinic_id, chat_id, kind, reason, summary)
                    select %s, %s, 'emergency', 'emergency', %s where exists (select 1 from web_chats where id = %s and clinic_id = %s)""",
                 (clinic_id, chat_id, f"Possible emergency in the web chat. Patient wrote: {text[:300]}", chat_id, clinic_id))


def alert_web_callbacks(conn: psycopg.Connection, smtp: dict, default_to: str | None) -> int:
    """Emails the clinic about each new call-back request or emergency from the page, once (like WhatsApp hand-offs)."""
    with conn.transaction():
        rows = conn.execute(
            """select w.id, w.kind, w.reason, w.summary, w.full_name, w.phone_e164, cl.name_en,
                      coalesce(nullif(array_to_string(s.handoff_alert_emails, ', '), ''), cl.staff_alert_email, %s)
               from web_callbacks w join clinics cl on cl.id = w.clinic_id join clinic_settings s on s.clinic_id = cl.id
               where w.alerted_at is null for update of w skip locked""", (default_to,)).fetchall()
        for r in rows:
            conn.execute("update web_callbacks set alerted_at = now() where id = %s", (r[0],))
    sent = 0
    for _, kind, reason, summary, name, phone, clinic, to in rows:
        if not to or not smtp.get("host"):
            continue
        msg = EmailMessage()
        who = f"{name or 'No name'} · {phone}" if phone else "no number left"
        msg["Subject"] = f"{REASON.get(reason, reason)} · online page · {clinic}"
        msg["From"], msg["To"] = smtp.get("sender") or smtp.get("user"), to
        msg.set_content(("Please call back: " if kind == "call_back" else "From the online booking chat: ") + f"{who}\n\n{summary or ''}\n")
        port = int(smtp.get("port") or 465)
        with (smtplib.SMTP_SSL(smtp["host"], port, timeout=20) if port == 465 else smtplib.SMTP(smtp["host"], port, timeout=20)) as s:
            if port != 465:
                s.starttls()
            if smtp.get("user"):
                s.login(smtp["user"], smtp.get("password") or "")
            s.send_message(msg)
        sent += 1
    return sent


def forget_old_chats(conn: psycopg.Connection, now: datetime) -> int:
    """Deletes chats older than the clinic's "keep chats" setting, with the assistant's memory of them and their call-backs."""
    with conn.transaction():
        ids = [r[0] for r in conn.execute(
            """select w.id::text from web_chats w join online_booking o on o.clinic_id = w.clinic_id
               where w.last_at < %s - make_interval(days => o.chat_keep_days)""", (now,)).fetchall()]
        if not ids:
            return 0
        threads = [f"web:{i}" for i in ids]
        for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
            if conn.execute("select to_regclass(%s)", (f"public.{table}",)).fetchone()[0]:
                conn.execute(f"delete from public.{table} where thread_id = any(%s)", (threads,))
        conn.execute("delete from web_callbacks where chat_id::text = any(%s)", (ids,))
        conn.execute("delete from web_chats where id::text = any(%s)", (ids,))
    return len(ids)
