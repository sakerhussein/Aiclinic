"""Booking-chat eval: runs every case through the real agent entry point (handle_message), on a fresh throwaway
database per case, with a simulated patient, then grades the database end state and the replies.

    .venv/Scripts/python evals/booking_chats/run.py [--cases id1,id2] [--reps 1] [--variant baseline]

Needs ANTHROPIC_API_KEY (agent/.env is read) and a throwaway Postgres server (evals/pg: npm install && npm start).
Writes to <repo>/.claude/hillclimb/booking_chats/<variant>/: results.jsonl, traces/, errors.jsonl, summary.json.
The first run, and any run after the harness files change, stops until you run it once with --approve-harness.
"""

import argparse
import hashlib
import json
import math
import os
import sys
import threading
import time
import traceback
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
AGENT_DIR = HERE.parents[1]
REPO = AGENT_DIR.parent
sys.path[:0] = [str(AGENT_DIR), str(HERE)]

import anthropic  # noqa: E402
import psycopg  # noqa: E402
from psycopg.conninfo import conninfo_to_dict, make_conninfo  # noqa: E402

import grade  # noqa: E402
import patient as sim  # noqa: E402
from limitsiz_agent.agent import build_agent, handle_message  # noqa: E402
from limitsiz_agent.agent.prompt import build_system_prompt  # noqa: E402
from limitsiz_agent.booking import clinic_info  # noqa: E402
from limitsiz_agent.chat import load_env  # noqa: E402

FLOW_DIR = REPO / ".claude" / "hillclimb" / "booking_chats"
CLINIC = "00000000-0000-4000-8000-000000000001"
PHONE = "+962790000123"
TZ = ZoneInfo("Asia/Amman")
DURATION = {"consult": 20, "followup": 15, "laser": 30, "peel": 45, "acne": 30}
DEFAULT_DB = "postgresql://postgres:test@localhost:54329/postgres"
HARNESS_FILES = [HERE / "run.py", HERE / "patient.py", HERE / "grade.py", HERE / "cases.json", AGENT_DIR / "evals" / "pg" / "package-lock.json"]
# $ per million tokens (input, output); cache writes 1.25x input, reads 0.1x input.
PRICES = {"claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-haiku-5-5": (0.10, 0.50)}

_write_lock = threading.Lock()


class HarnessError(Exception):
    def __init__(self, cls: str, detail: str = "", **extra):
        super().__init__(f"{cls}: {detail}")
        self.cls, self.detail, self.extra = cls, detail, extra


# ---------------------------------------------------------------- harness gate

def harness_sha(state: dict) -> str:
    h = hashlib.sha256()
    for p in HARNESS_FILES + [REPO / p for p in state.get("harness_paths", [])]:
        h.update(str(p.relative_to(REPO)).encode())
        h.update(p.read_bytes() if p.exists() else b"<missing>")
    return h.hexdigest()


def check_harness(state: dict, approve: bool) -> None:
    sha, path = harness_sha(state), FLOW_DIR / "harness.sha"
    if approve:
        path.write_text(sha + "\n")
        print(f"Harness approved: {sha[:12]}")
        return
    if not path.exists() or path.read_text().strip() != sha:
        print("The eval harness (runner, grader, simulator or cases) changed since it was last approved, or was never "
              "approved. Review the changes, then run once with --approve-harness.", file=sys.stderr)
        sys.exit(2)


# ---------------------------------------------------------------- databases

def admin_url(url: str) -> str:
    if conninfo_to_dict(url).get("host") not in ("localhost", "127.0.0.1", "::1"):
        sys.exit("EVAL_DATABASE_URL must point at a local throwaway Postgres, never the real project.")
    return url


def build_template(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute("drop database if exists eval_template with (force)")
        admin.execute("create database eval_template encoding 'UTF8' template template0")
    with psycopg.connect(make_conninfo(url, dbname="eval_template"), autocommit=True) as c:
        for migration in sorted((REPO / "db" / "migrations").glob("*.sql")):
            c.execute(migration.read_text(encoding="utf-8"))
        c.execute((AGENT_DIR / "supabase" / "seed_demo_clinic.sql").read_text(encoding="utf-8"))


def fresh_db(url: str, name: str) -> str:
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(f'create database "{name}" template eval_template')
    return make_conninfo(url, dbname=name)


def drop_db(url: str, name: str) -> None:
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(f'drop database if exists "{name}" with (force)')


def add_fixtures(conn, case: dict) -> None:
    def insert(a: dict, phone: str, name: str | None):
        pid = conn.execute(
            """insert into patients (clinic_id, phone_e164, full_name) values (%s, %s, %s)
               on conflict (clinic_id, phone_e164) do update set full_name = coalesce(patients.full_name, excluded.full_name)
               returning id""", (CLINIC, phone, name)).fetchone()[0]
        start = datetime.fromisoformat(f"{a['date']}T{a['time']}").replace(tzinfo=TZ)
        conn.execute(
            """insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, source)
               values (%s, %s, %s, %s, %s, %s, 'staff')""",
            (CLINIC, grade.DOCTORS[a["doctor"]], grade.SERVICES[a["service"]], pid, start,
             start + timedelta(minutes=DURATION[a["service"]])))
    for a in case.get("existing", []):
        insert(a, PHONE, None)
    for a in case.get("existing_other", []):
        insert(a, a["phone"], a.get("name"))


def end_state(conn) -> tuple[list[dict], list[str], list[tuple]]:
    rows = conn.execute(
        """select a.service_id::text, a.doctor_id::text, a.starts_at, a.status::text, p.phone_e164
           from appointments a join patients p on p.id = a.patient_id order by a.starts_at""").fetchall()
    mine = [{"service": s, "doctor": d, "date": t.astimezone(TZ).date().isoformat(), "time": t.astimezone(TZ).strftime("%H:%M"),
             "status": st} for s, d, t, st, ph in rows if ph == PHONE]
    others = sorted((s, d, t.isoformat(), st, ph) for s, d, t, st, ph in rows if ph != PHONE)
    handoffs = [r[0] for r in conn.execute(
        """select h.reason from handoffs h join conversations c on c.id = h.conversation_id
           where c.wa_phone = %s order by h.created_at""", (PHONE,)).fetchall()]
    return mine, handoffs, others


# ---------------------------------------------------------------- one case

def counting_client(counter: dict, key: str) -> anthropic.Anthropic:
    def on_request(_request):
        counter[key] += 1
    return anthropic.Anthropic(max_retries=4, http_client=anthropic.DefaultHttpxClient(event_hooks={"request": [on_request]}))


def run_case(case: dict, rep: int, args, base_url: str, defaults: dict, out_dir: Path) -> dict:
    db_name = f"eval_{uuid.uuid4().hex[:12]}"
    db_url = fresh_db(base_url, db_name)
    requests = defaultdict(int)
    agent_client, patient_client, judge_client = (counting_client(requests, k) for k in ("agent", "patient", "judge"))
    calls, api_errors, patient_usage = [], [], []
    now = datetime.fromisoformat(case.get("now", defaults["now"]))

    def observe(response, error):
        if error is not None:
            api_errors.append(f"{type(error).__name__}: {error}")
        else:
            calls.append({"model": response.model, "usage": response.usage.model_dump(), "stop_reason": response.stop_reason,
                          "fallback": any(b.type == "fallback" for b in response.content),
                          "tool_calls": sum(b.type == "tool_use" for b in response.content)})

    try:
        with psycopg.connect(db_url, autocommit=True) as conn:
            add_fixtures(conn, case)
            others_before = end_state(conn)[2]
            graph = build_agent(conn, agent_client, model=args.model, effort=args.effort, now=lambda: now, observe=observe)
            chat: list[tuple[str, str]] = []
            script = list(case.get("script") or [case["opener"]])
            message, latency, turns = script.pop(0), 0.0, 0
            while message is not None and turns < defaults["max_patient_turns"]:
                t0 = time.monotonic()
                reply = handle_message(graph, CLINIC, PHONE, message)
                latency += time.monotonic() - t0
                turns += 1
                chat += [("patient", message), ("clinic", reply or "(no reply)")]
                if api_errors:
                    raise HarnessError("api_error", api_errors[0])
                if "script" in case:
                    message = script.pop(0) if script else None
                else:
                    try:
                        nxt = sim.next_message(patient_client, case["patient"], chat, patient_usage)
                    except anthropic.APIError as e:
                        raise HarnessError("patient_api_error", str(e)) from e
                    message = None if nxt == sim.END else nxt

            for c in calls:
                if c["model"] != args.model and not c["fallback"]:
                    raise HarnessError("served_model_mismatch", f"asked {args.model}, served {c['model']}")
            mine, handoffs, others_after = end_state(conn)
            ok, detail = grade.outcome(case["expect"], mine, handoffs, others_before == others_after)
            messages = graph.get_state({"configurable": {"thread_id": f"{CLINIC}:{PHONE}"}}).values.get("messages", [])
            system_prompt = build_system_prompt(clinic_info(conn, CLINIC))

        trace = to_trace(system_prompt, messages)
        status = "truncated" if any(c["stop_reason"] == "max_tokens" for c in calls) else "ok"
        g = {"pass": False, "outcome": float(ok)}
        explanation = {"outcome": detail}
        judge_model, judge_usage = None, None
        if not args.no_judge:
            try:
                verdict, reasons, judge_model, judge_usage = grade.judge(
                    judge_client, clinic_details(system_prompt), judge_text(messages), case.get("judge"))
            except (anthropic.APIError, RuntimeError, KeyError, ValueError) as e:
                raise HarnessError("grader_error", str(e)) from e
            g.update({k: float(v) for k, v in verdict.items()})
            explanation.update(reasons)
        g["pass"] = float(all(v == 1.0 for k, v in g.items() if k != "pass"))

        usage = sum_usage(c["usage"] for c in calls)
        served = sorted({c["model"] for c in calls}) or [args.model]
        row = {
            "prompt_id": case["id"], "rep": rep, "prompt": "\n".join(case.get("script") or [case["opener"]]),
            "tags": case["tags"], "status": status, "stop_reason": calls[-1]["stop_reason"] if calls else None,
            "grade": g, "explanation": explanation,
            "model": served[0] if len(served) == 1 else served, "usage": usage,
            "judge_model": judge_model, "judge_usage": judge_usage,
            "latency_s": round(latency, 2), "turns": turns, "tool_calls": sum(c["tool_calls"] for c in calls),
            "meta": {"handoffs": handoffs, "end_state": grade._fmt([a for a in mine]),
                     "fallback_used": any(c["fallback"] for c in calls), "agent_calls": len(calls),
                     "requests": dict(requests), "retries": requests["agent"] - len(calls),
                     "patient_model": sim.PATIENT_MODEL, "patient_usage": sum_usage(patient_usage)},
        }
        (out_dir / "traces" / f"{case['id']}_rep{rep}.json").write_text(json.dumps(trace, ensure_ascii=False, indent=1), encoding="utf-8")
        return row
    finally:
        drop_db(base_url, db_name)


def sum_usage(usages) -> dict:
    keys = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
    total = dict.fromkeys(keys, 0)
    for u in usages:
        for k in keys:
            total[k] += u.get(k) or 0
    return total


def cost(model, usage) -> float:
    if not usage or model not in PRICES:
        return 0.0
    i, o = PRICES[model]
    return (usage["input_tokens"] * i + usage["output_tokens"] * o + usage["cache_creation_input_tokens"] * i * 1.25
            + usage["cache_read_input_tokens"] * i * 0.1) / 1e6


# ---------------------------------------------------------------- transcripts

def _blocks(content):
    return [{"type": "text", "text": content}] if isinstance(content, str) else content


def to_trace(system_prompt: str, messages: list[dict]) -> list[dict]:
    turns = [{"role": "system", "content": system_prompt}]
    for m in messages:
        for b in _blocks(m["content"]):
            t = b.get("type")
            if m["role"] == "system":
                turns.append({"role": "system", "content": b.get("text", "")})
            elif t == "text":
                turns.append({"role": m["role"], "content": b["text"]})
            elif t == "tool_use":
                turns.append({"role": "tool_call", "name": b["name"], "content": json.dumps(b.get("input"), ensure_ascii=False, indent=2)})
            elif t == "tool_result":
                turns.append({"role": "tool_result", "content": b.get("content", "")})
    return turns


def judge_text(messages: list[dict]) -> str:
    lines = []
    for m in messages:
        for b in _blocks(m["content"]):
            t = b.get("type")
            if m["role"] == "system":
                lines.append(f"[system] {b.get('text', '')}")
            elif t == "text":
                lines.append(f"[{'patient' if m['role'] == 'user' else 'assistant'}] {b['text']}")
            elif t == "tool_use":
                lines.append(f"[assistant tool call] {b['name']} {json.dumps(b.get('input'), ensure_ascii=False)}")
            elif t == "tool_result":
                lines.append(f"[tool result] {b.get('content', '')}")
    return "\n".join(lines)


def clinic_details(system_prompt: str) -> str:
    return system_prompt[system_prompt.index("Clinic details"):]


# ---------------------------------------------------------------- main

def wilson(k: float, n: int) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p, z = k / n, 1.96
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def main() -> None:
    load_env(AGENT_DIR / ".env")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--variant", default="baseline")
    p.add_argument("--model", default="claude-opus-5-5", help="the agent's model")
    p.add_argument("--effort", default="medium")
    p.add_argument("--reps", type=int, default=1)
    p.add_argument("--cases", help="comma-separated case ids (default: all)")
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--timeout-s", type=int, default=600, help="hard wall-clock ceiling per case")
    p.add_argument("--no-judge", action="store_true")
    p.add_argument("--approve-harness", action="store_true", help="for the owner: approve the current harness files")
    args = p.parse_args()
    if args.variant != "baseline" and not (args.variant[0] == "v" and args.variant[1:].isdigit()):
        sys.exit("--variant must be 'baseline' or v1, v2, ...")

    state = json.loads((FLOW_DIR / "_state.json").read_text(encoding="utf-8"))
    check_harness(state, args.approve_harness)
    base_url = admin_url(os.environ.get("EVAL_DATABASE_URL", DEFAULT_DB))
    data = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    cases = data["cases"]
    if args.cases:
        wanted = args.cases.split(",")
        unknown = set(wanted) - {c["id"] for c in cases}
        if unknown:
            sys.exit(f"unknown cases: {', '.join(sorted(unknown))}")
        cases = [c for c in cases if c["id"] in wanted]

    out_dir = FLOW_DIR / args.variant
    (out_dir / "traces").mkdir(parents=True, exist_ok=True)
    results_path, errors_path = out_dir / "results.jsonl", out_dir / "errors.jsonl"
    done = set()
    if results_path.exists():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            done.add((r["prompt_id"], r["rep"]))
    todo = [(c, r) for c in cases for r in range(args.reps) if (c["id"], r) not in done]
    print(f"{len(todo)} to run ({len(done)} already done), agent {args.model} effort {args.effort}, "
          f"patient {sim.PATIENT_MODEL}, judge {'off' if args.no_judge else grade.JUDGE_MODEL}")
    build_template(base_url)

    def guarded(case, rep):
        box = {}

        def work():
            try:
                box["row"] = run_case(case, rep, args, base_url, data["defaults"], out_dir)
            except HarnessError as e:
                box["error"] = {"class": e.cls, "detail": e.detail}
            except Exception as e:  # noqa: BLE001 - recorded as a harness failure, never as a score
                box["error"] = {"class": "harness_error", "detail": f"{type(e).__name__}: {e}", "traceback": traceback.format_exc()}

        t = threading.Thread(target=work, daemon=True)
        t0 = time.monotonic()
        t.start()
        t.join(args.timeout_s)
        with _write_lock:
            if t.is_alive():
                err = {"class": "timeout", "detail": f"over {args.timeout_s}s"}
            else:
                err = box.get("error")
            if err:
                with errors_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps({"prompt_id": case["id"], "rep": rep, "at": datetime.now().isoformat(), **err}, ensure_ascii=False) + "\n")
                print(f"  ERROR {case['id']} rep{rep}: {err['class']} {err['detail'][:160]}")
            else:
                row = box["row"]
                with results_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
                print(f"  {'PASS' if row['grade']['pass'] else 'FAIL'} {case['id']} rep{rep} ({time.monotonic() - t0:.0f}s)"
                      + ("" if row["grade"]["pass"] else "  " + ", ".join(k for k, v in row["grade"].items() if k != "pass" and v < 1)))

    t_start = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        list(pool.map(lambda cr: guarded(*cr), todo))

    rows = [json.loads(l) for l in results_path.read_text(encoding="utf-8").splitlines()] if results_path.exists() else []
    rows = [r for r in rows if r["prompt_id"] in {c["id"] for c in cases}]
    scored = [r for r in rows if r["status"] == "ok"]
    n_err = len(errors_path.read_text(encoding="utf-8").splitlines()) if errors_path.exists() else 0
    metrics = [m["id"] for m in state["metrics"]]
    print(f"\n{len(scored)} scored ({len(rows) - len(scored)} truncated, {n_err} error lines) in {time.monotonic() - t_start:.0f}s")
    summary = {"variant": args.variant, "model": args.model, "effort": args.effort, "n": len(scored), "metrics": {}}
    for m in metrics:
        vals = [r["grade"][m] for r in scored if m in r["grade"]]
        if vals:
            lo, hi = wilson(sum(vals), len(vals))
            summary["metrics"][m] = {"mean": sum(vals) / len(vals), "ci95": [lo, hi], "n": len(vals)}
            print(f"  {m:18s} {sum(vals) / len(vals):6.1%}  (95% CI {lo:.0%}-{hi:.0%}, n={len(vals)})")
    agent_cost = sum(cost(r["model"], r["usage"]) for r in rows if isinstance(r["model"], str))
    judge_cost = sum(cost(r["judge_model"], r["judge_usage"]) for r in rows)
    patient_cost = sum(cost(r["meta"]["patient_model"], r["meta"]["patient_usage"]) for r in rows)
    summary["cost_usd"] = {"agent": agent_cost, "judge": judge_cost, "patient": patient_cost}
    print(f"  cost: agent ${agent_cost:.3f}, judge ${judge_cost:.3f}, patient ${patient_cost:.3f} "
          f"(scored rows only; failed attempts' spend is not recorded)")
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
