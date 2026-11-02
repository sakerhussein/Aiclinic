"""The booking agent as a LangGraph graph. One conversation (thread) per clinic and WhatsApp number.

    intake ──> agent ──> tools ──> agent ... ──> reply
      │                    └──> finish (too many steps: hand to staff)
      └──> reply (emergency, or staff are handling the chat: no AI)

- intake: works without the AI. Stays silent while staff handle the chat; answers emergencies with a fixed
  message and alerts staff; settles a change that was waiting for the patient's yes; adds the current time.
- agent: one Claude call (Anthropic SDK). Thinking blocks and all other content are stored exactly as returned
  and the history is only ever appended to, as the API requires.
- tools: runs Claude's tool calls for this patient only. Book, cancel and reschedule are checked and then held
  until the patient replies yes; only then does intake run them for real.

Per-turn facts (time, confirmation results) go in as mid-conversation system messages, which patients cannot fake.
"""

import operator
import time
from datetime import datetime, timezone
from typing import Annotated, Callable, TypedDict

import anthropic
import psycopg
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from zoneinfo import ZoneInfo

from ..booking import BookingError, clinic_info, hand_off, normalize_phone
from .prompt import build_system_prompt
from .safety import confirmation_answer, emergency_reply, guess_language, is_emergency
from .tools import CHANGE_TOOLS, TOOLS, WEEKDAYS_EN, ToolBox, ToolInputError, to_json

MAX_TOOL_ROUNDS = 6
CLINIC_INFO_TTL_SECONDS = 300
FALLBACK_BETA = "server-side-fallback-2026-07-01"

SORRY = {
    "ar": "عذراً، حدث خلل تقني. يرجى إرسال رسالتك مرة أخرى بعد قليل.",
    "en": "Sorry, something went wrong on our side. Please send your message again in a moment.",
}
PASSED_TO_TEAM = {
    "ar": "سأحوّل محادثتك إلى فريق العيادة، وسيردّون عليك هنا قريباً.",
    "en": "I'm passing your conversation to the clinic team. They will reply here soon.",
}


class State(TypedDict, total=False):
    messages: Annotated[list[dict], operator.add]  # Claude API messages, append-only
    inbound: str           # the patient's message for this turn
    language: str          # 'ar' or 'en', from the patient's messages
    pending: dict | None   # a change waiting for the patient's yes: {tool, args, preview}
    rounds: int            # tool rounds in this turn
    reply: str | None      # what to send back this turn (None: send nothing)
    done: bool             # intake already answered this turn


def build_agent(
    conn: psycopg.Connection,
    client: anthropic.Anthropic,
    *,
    model: str = "claude-opus-5-5",
    effort: str = "medium",
    checkpointer=None,
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    observe: Callable[[object | None, Exception | None], None] | None = None,
):
    """Compiles the graph. `conn` must be an autocommit psycopg connection to the booking database.
    `observe(response, error)` is called after every Claude call (used by the eval to record usage and errors)."""
    info_cache: dict[str, tuple[float, dict, str]] = {}

    def clinic(clinic_id: str) -> tuple[dict, str]:
        hit = info_cache.get(clinic_id)
        if hit and time.monotonic() - hit[0] < CLINIC_INFO_TTL_SECONDS:
            return hit[1], hit[2]
        info = clinic_info(conn, clinic_id)
        info_cache[clinic_id] = (time.monotonic(), info, build_system_prompt(info))
        return info, info_cache[clinic_id][2]

    def ids(config) -> tuple[str, str]:
        c = config["configurable"]
        return c["clinic_id"], c["phone"]

    # ------------------------------------------------------------ nodes

    def intake(state: State, config) -> dict:
        clinic_id, phone = ids(config)
        text = state["inbound"]
        language = guess_language(text) if text.strip() else state.get("language", "ar")
        if _staff_handling(conn, clinic_id, phone):
            return {"reply": None, "done": True, "pending": None}

        user = {"role": "user", "content": [{"type": "text", "text": text}]}
        if is_emergency(text):
            hand_off(conn, clinic_id, phone, "emergency", f"Possible emergency. Patient wrote: {text[:300]}")
            reply = emergency_reply(language)
            return {"messages": [user, {"role": "assistant", "content": [{"type": "text", "text": reply}]}],
                    "reply": reply, "done": True, "pending": None, "language": language}

        info, _ = clinic(clinic_id)
        tz = ZoneInfo(info["timezone"])
        local = now().astimezone(tz)
        notes = [f"Current time at the clinic: {WEEKDAYS_EN[local.weekday()]} {local:%Y-%m-%d %H:%M} ({info['timezone']})."]
        if not state.get("messages"):
            notes.append("This is the patient's first message.")
        pending = state.get("pending")
        if pending:
            notes.append(_settle(pending, confirmation_answer(text), ToolBox(conn, clinic_id, phone, info["timezone"], now())))
        return {"messages": [user, {"role": "system", "content": " ".join(notes)}],
                "pending": None, "rounds": 0, "reply": None, "done": False, "language": language}

    def agent(state: State, config) -> dict:
        clinic_id, _ = ids(config)
        language = state.get("language", "ar")
        _, system_prompt = clinic(clinic_id)
        try:
            response = client.beta.messages.create(
                model=model,
                max_tokens=16000,
                system=system_prompt,
                tools=TOOLS,
                messages=state["messages"],
                output_config={"effort": effort},
                cache_control={"type": "ephemeral"},
                betas=[FALLBACK_BETA],
                fallbacks="default",
            )
        except anthropic.APIError as e:
            if observe:
                observe(None, e)
            # Answer anyway, so the history stays a valid conversation for the next message.
            return _say(SORRY[language])
        if observe:
            observe(response, None)

        if response.stop_reason == "refusal":
            return _say(SORRY[language])
        if response.stop_reason == "max_tokens":
            return _say(SORRY[language])

        content = [b.model_dump(mode="json", exclude_none=True) for b in response.content]
        text = "\n".join(b["text"] for b in content if b.get("type") == "text").strip()
        has_tools = any(b.get("type") == "tool_use" for b in content)
        if not has_tools and not text:
            content.append({"type": "text", "text": SORRY[language]})
            text = SORRY[language]
        return {"messages": [{"role": "assistant", "content": content}], "reply": None if has_tools else text}

    def tools(state: State, config) -> dict:
        clinic_id, phone = ids(config)
        info, _ = clinic(clinic_id)
        box = ToolBox(conn, clinic_id, phone, info["timezone"], now())
        rounds = state.get("rounds", 0) + 1
        calls = [b for b in state["messages"][-1]["content"] if b.get("type") == "tool_use"]

        if rounds > MAX_TOOL_ROUNDS:
            hand_off(conn, clinic_id, phone, "agent_unsure", "The assistant needed too many steps for this request.")
            results = [_result(c["id"], {"error": "too_many_steps"}, error=True) for c in calls]
            return {"messages": [{"role": "user", "content": results}], "rounds": rounds}

        pending = state.get("pending")
        held_this_round = False
        results = []
        for c in calls:
            name, args = c["name"], c.get("input") or {}
            try:
                if name in CHANGE_TOOLS:
                    if held_this_round:
                        results.append(_result(c["id"], {"error": "one_change_at_a_time",
                                                         "detail": "Ask the patient about the first change before another."}, error=True))
                        continue
                    preview = box.run(name, args, dry_run=True)
                    pending, held_this_round = {"tool": name, "args": args, "preview": preview}, True
                    results.append(_result(c["id"], {
                        "status": "waiting_for_patient_confirmation",
                        "will_do": preview,
                        "next": "Nothing has changed yet. Show the patient these details and ask them to reply yes (نعم) to confirm.",
                    }))
                else:
                    results.append(_result(c["id"], box.run(name, args)))
            except ToolInputError as e:
                results.append(_result(c["id"], {"error": "invalid_arguments", "detail": str(e)}, error=True))
            except BookingError as e:
                results.append(_result(c["id"], {"error": e.code, "detail": e.detail}, error=True))
        return {"messages": [{"role": "user", "content": results}], "pending": pending, "rounds": rounds}

    def finish(state: State, config) -> dict:
        return _say(PASSED_TO_TEAM[state.get("language", "ar")])

    # ------------------------------------------------------------ wiring

    g = StateGraph(State)
    g.add_node("intake", intake)
    g.add_node("agent", agent)
    g.add_node("tools", tools)
    g.add_node("finish", finish)
    g.add_edge(START, "intake")
    g.add_conditional_edges("intake", lambda s: END if s.get("done") else "agent", ["agent", END])
    g.add_conditional_edges("agent", lambda s: "tools" if s.get("reply") is None else END, ["tools", END])
    g.add_conditional_edges("tools", lambda s: "finish" if s.get("rounds", 0) > MAX_TOOL_ROUNDS else "agent", ["agent", "finish"])
    g.add_edge("finish", END)
    return g.compile(checkpointer=checkpointer or InMemorySaver())


def handle_message(graph, clinic_id: str, phone: str, text: str) -> str | None:
    """Runs one incoming patient message and returns the reply to send (None: send nothing)."""
    phone = normalize_phone(phone)
    config = {"configurable": {"thread_id": f"{clinic_id}:{phone}", "clinic_id": str(clinic_id), "phone": phone}}
    return graph.invoke({"inbound": text}, config).get("reply")


# ---------------------------------------------------------------- helpers


def _say(text: str) -> dict:
    return {"messages": [{"role": "assistant", "content": [{"type": "text", "text": text}]}], "reply": text}


def _result(tool_use_id: str, payload: dict, error: bool = False) -> dict:
    block = {"type": "tool_result", "tool_use_id": tool_use_id, "content": to_json(payload)}
    if error:
        block["is_error"] = True
    return block


def _settle(pending: dict, answer: str | None, box: ToolBox) -> str:
    """Runs or drops the waiting change and says what happened, for the system message."""
    tool = pending["tool"]
    if answer == "yes":
        try:
            return f"The patient confirmed. {tool} was done: {to_json(box.run(tool, pending['args']))}"
        except (BookingError, ToolInputError) as e:
            code = getattr(e, "code", "invalid_arguments")
            return f"The patient confirmed, but {tool} could not be done ({code}). Nothing was changed."
    if answer == "no":
        return f"The patient said no. {tool} was not done and nothing was changed."
    return (f"The patient did not confirm, so the waiting {tool} was dropped and nothing was changed. "
            "If they still want it, call the tool again.")


def _staff_handling(conn: psycopg.Connection, clinic_id: str, phone: str) -> bool:
    row = conn.execute("select status from conversations where clinic_id = %s and wa_phone = %s",
                       (clinic_id, phone)).fetchone()
    return bool(row and row[0] == "handed_off")
