"""Writes cases.md (for review) from cases.json.   python evals/booking_chats/render_cases.py"""

import json
import re
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
SERVICE = {"consult": "Consultation", "followup": "Follow-up", "laser": "Laser", "peel": "Chemical peel", "acne": "Acne session"}
DOCTOR = {"lina": "Dr. Lina", "omar": "Dr. Omar"}


def fence(text: str) -> str:
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    ticks = "`" * max(3, longest + 1)
    return f"{ticks}text\n{text}\n{ticks}"


def appt(a: dict) -> str:
    services = a["service"] if isinstance(a["service"], list) else [a["service"]]
    parts = [" or ".join(SERVICE[s] for s in services)]
    if "doctor" in a:
        parts.append(DOCTOR[a["doctor"]])
    if "date" in a:
        parts.append(a["date"])
    if "date_from" in a:
        parts.append(f"{a['date_from']} to {a['date_to']}")
    if "time" in a:
        parts.append(a["time"])
    if "from" in a:
        parts.append(a["from"] if a["from"] == a["to"] else f"{a['from']}-{a['to']}")
    return ", ".join(parts)


def expected(e: dict) -> str:
    out = []
    out.append("active: " + ("; ".join(appt(a) for a in e["active"]) if e["active"] else "none"))
    if e.get("cancelled"):
        out.append("cancelled: " + "; ".join(appt(a) for a in e["cancelled"]))
    h = e["handoff"]
    out.append({"none": "no hand-off", "optional": "hand-off allowed"}.get(h, "hand-off required (" + h.split(":", 1)[-1].replace(",", " / ") + ")"))
    return " · ".join(out)


def main() -> None:
    data = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    cases = data["cases"]
    groups = Counter(c["tags"][0] for c in cases)
    langs = Counter(c["tags"][1] for c in cases)
    lines = ["# Booking-chat eval cases", "", data["about"], "",
             f"**{len(cases)} cases.** By group: " + ", ".join(f"{k} {v}" for k, v in groups.items())
             + ". By language: " + ", ".join(f"{k} {v}" for k, v in langs.items())
             + f". Simulated patient: {sum('patient' in c for c in cases)}, fixed script: {sum('script' in c for c in cases)}.", "",
             "Source: `owner` = your message word for word; `added` = written by Claude to cover a case "
             "(mind changes, safety, a missing appointment).", "",
             "| # | id | group | lang | source | expected end state |", "|---|---|---|---|---|---|"]
    for i, c in enumerate(cases, 1):
        lines.append(f"| {i} | `{c['id']}` | {c['tags'][0]} | {c['tags'][1]} | {c['tags'][2]} | {expected(c['expect'])} |")
    for i, c in enumerate(cases, 1):
        lines += ["", f"## {i}. `{c['id']}`", ""]
        if c.get("now"):
            lines.append(f"- Clock: {c['now']}")
        for a in c.get("existing", []):
            lines.append(f"- Already booked (this patient): {appt({**a})}")
        for a in c.get("existing_other", []):
            lines.append(f"- Already booked (another patient): {appt({**a})}")
        lines.append(f"- Expected: {expected(c['expect'])}")
        if c.get("judge"):
            lines.append(f"- Judge also checks: {c['judge']}")
        if "script" in c:
            lines += ["", "Fixed patient messages:", ""] + [fence(m) for m in c["script"]]
        else:
            lines += ["", "Opening message:", "", fence(c["opener"]), "", f"Patient's goal (for the simulated patient): {c['patient']}"]
    (HERE / "cases.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(cases)} cases -> cases.md; groups {dict(groups)}; languages {dict(langs)}")


if __name__ == "__main__":
    main()
