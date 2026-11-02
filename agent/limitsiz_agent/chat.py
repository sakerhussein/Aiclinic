"""Chat with the booking agent in the terminal, as if from WhatsApp. Uses real Claude and the database in .env.

    .venv/Scripts/python -m limitsiz_agent.chat [--phone +962791234567] [--clinic <clinic id>]

Bookings made here are real rows in that database (the demo clinic by default). Type /quit to stop.
"""

import argparse
import os
import sys
from pathlib import Path

import anthropic
import psycopg

from .agent import build_agent, handle_message

DEMO_CLINIC = "00000000-0000-4000-8000-000000000001"


def load_env(path: Path) -> None:
    """Reads KEY=value lines into the environment, without overriding what is already set."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    load_env(Path(__file__).resolve().parents[1] / ".env")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--phone", default="+962790000001", help="the patient's WhatsApp number")
    p.add_argument("--clinic", default=DEMO_CLINIC)
    args = p.parse_args()

    if not os.environ.get("DATABASE_URL"):
        sys.exit("DATABASE_URL is not set (see .env.example).")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")

    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
        graph = build_agent(
            conn, anthropic.Anthropic(),
            model=os.environ.get("AGENT_MODEL", "claude-opus-5-5"),
            effort=os.environ.get("AGENT_EFFORT", "medium"),
        )
        print(f"Chatting as {args.phone}. Type /quit to stop.\n")
        while True:
            try:
                inbound = input("you > ").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if inbound == "/quit":
                break
            if not inbound:
                continue
            reply = handle_message(graph, args.clinic, args.phone, inbound)
            print(f"\nclinic > {reply}\n" if reply else "\n(no reply: the clinic team is handling this chat)\n")


if __name__ == "__main__":
    main()
