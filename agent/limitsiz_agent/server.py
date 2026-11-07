"""The agent's web service: WhatsApp webhook (step 5), reminders (step 6) and the staff screen (step 7).

    .venv/bin/python -m limitsiz_agent.server        (settings in agent/.env, see .env.example)

- POST /whatsapp/webhook answers Meta at once and queues the message; one worker thread handles messages in order,
  so a patient's quick messages never race each other.
- Every minute a scheduler sends due reminders and emails staff about new hand-offs.
- Conversations are saved in Postgres (LangGraph checkpoints), so they survive a restart.
"""

import logging
import os
import queue
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import anthropic
import psycopg
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from psycopg.rows import dict_row

from .agent import build_agent
from .chat import load_env
from .staff import alert_new_handoffs, create_router
from .whatsapp import links, reminders
from .whatsapp.client import WhatsAppClient
from .whatsapp.processor import Processor
from .whatsapp.webhook import parse, signature_ok

log = logging.getLogger("limitsiz.server")
REQUIRED = ("DATABASE_URL", "ANTHROPIC_API_KEY", "STAFF_PASSWORD")
# Without these the service still runs (staff screen, alerts); the webhook answers 503 and reminders are off.
WHATSAPP = ("WA_TOKEN", "WA_APP_SECRET", "WA_VERIFY_TOKEN")


def open_checkpointer(url: str):
    """LangGraph's Postgres checkpointer, with Row Level Security switched on for its tables: in Supabase any public
    table without RLS can be read through the public API, and these tables hold the conversations."""
    from langgraph.checkpoint.postgres import PostgresSaver
    conn = psycopg.connect(url, autocommit=True, prepare_threshold=0, row_factory=dict_row)
    saver = PostgresSaver(conn)
    saver.setup()
    tables = conn.execute(
        "select tablename from pg_tables where schemaname = 'public' and tablename like 'checkpoint%'").fetchall()
    for row in tables:
        conn.execute(f'alter table public."{row["tablename"]}" enable row level security')
    return saver


def create_app(env: dict) -> FastAPI:
    missing = [k for k in REQUIRED if not env.get(k)]
    if missing:
        raise SystemExit(f"Missing settings: {', '.join(missing)} (see agent/.env.example)")
    url = env["DATABASE_URL"]
    whatsapp_on = all(env.get(k) for k in WHATSAPP)
    wa = WhatsAppClient(env["WA_TOKEN"], env.get("WA_GRAPH_VERSION") or "v23.0") if whatsapp_on else None
    if not whatsapp_on:
        log.warning("WhatsApp settings missing: webhook off, reminders off (staff screen and alerts still work)")
    inbox: queue.Queue = queue.Queue()

    @asynccontextmanager
    async def lifespan(_app):
        threading.Thread(target=worker, name="worker", daemon=True).start()
        if env.get("REMINDERS_ENABLED", "true").lower() != "false":
            threading.Thread(target=scheduler, name="scheduler", daemon=True).start()
        yield

    app = FastAPI(title="Limitsiz booking agent", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    def connect() -> psycopg.Connection:
        # prepare_threshold=0: works through Supabase's connection pooler.
        return psycopg.connect(url, autocommit=True, prepare_threshold=0)

    def worker():
        conn = connect()
        graph = build_agent(conn, anthropic.Anthropic(), model=env.get("AGENT_MODEL") or "claude-opus-5-5",
                            effort=env.get("AGENT_EFFORT") or "medium", checkpointer=open_checkpointer(url))
        proc = Processor(conn, graph, wa, on_button=reminders.handle_button)
        log.info("worker ready")
        while True:
            m = inbox.get()
            try:
                proc.handle(m)
            except Exception:  # noqa: BLE001 - one bad message must not stop the worker
                log.exception("handling %s failed", m.wa_message_id)
                if conn.closed:
                    conn = connect()
                    proc.conn = conn

    def scheduler():
        conn = connect()
        smtp = {"host": env.get("SMTP_HOST"), "port": env.get("SMTP_PORT"), "user": env.get("SMTP_USER"),
                "password": env.get("SMTP_PASS"), "sender": env.get("ALERT_EMAIL_FROM")}
        while True:
            try:
                if conn.closed:
                    conn = connect()
                if wa:
                    n = reminders.send_due_reminders(conn, wa, env.get("WA_REMINDER_TEMPLATE") or "appointment_reminder",
                                                     datetime.now(timezone.utc))
                    if n:
                        log.info("sent %d reminders", n)
                    n = links.send_due_links(conn, wa, env.get("WA_LINK_TEMPLATE") or "booking_link", datetime.now(timezone.utc),
                                             env.get("BOOK_SITE_URL") or "https://book.limitsiz.si")
                    if n:
                        log.info("sent %d booking links", n)
                links.forget_old_requests(conn, datetime.now(timezone.utc))
                alert_new_handoffs(conn, smtp, env.get("AGENT_BASE_URL") or "", env.get("STAFF_ALERT_EMAIL"))
            except Exception:  # noqa: BLE001
                log.exception("scheduler round failed")
            time.sleep(60)

    @app.get("/health")
    def health():
        return {"ok": True, "whatsapp": whatsapp_on, "queued": inbox.qsize()}

    @app.get("/whatsapp/webhook")
    def verify(request: Request):
        if not whatsapp_on:
            raise HTTPException(503, "WhatsApp is not connected yet")
        q = request.query_params
        if q.get("hub.mode") == "subscribe" and q.get("hub.verify_token") == env["WA_VERIFY_TOKEN"]:
            return PlainTextResponse(q.get("hub.challenge", ""))
        raise HTTPException(403)

    @app.post("/whatsapp/webhook")
    async def receive(request: Request):
        if not whatsapp_on:
            raise HTTPException(503, "WhatsApp is not connected yet")
        body = await request.body()
        if not signature_ok(env["WA_APP_SECRET"], body, request.headers.get("x-hub-signature-256")):
            raise HTTPException(401)
        for m in parse(await request.json()):
            inbox.put(m)
        return {"ok": True}

    app.include_router(create_router(connect, wa, env["STAFF_PASSWORD"]))
    app.state.inbox = inbox
    return app


def main() -> None:
    load_env(Path(__file__).resolve().parents[1] / ".env")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app = create_app(dict(os.environ))
    uvicorn.run(app, host=os.environ.get("AGENT_HOST", "127.0.0.1"), port=int(os.environ.get("AGENT_PORT", "3002")),
                proxy_headers=True)


if __name__ == "__main__":
    main()
