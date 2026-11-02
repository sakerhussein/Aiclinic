"""The eval runner's plumbing on the test database, with scripted stand-ins for Claude (no API calls)."""

import json
import sys
from argparse import Namespace
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "evals" / "booking_chats"))
import run  # noqa: E402
from test_agent import FakeClaude, msg, text, tool  # noqa: E402

CASES = {c["id"]: c for c in json.loads((run.HERE / "cases.json").read_text(encoding="utf-8"))["cases"]}
DEFAULTS = json.loads((run.HERE / "cases.json").read_text(encoding="utf-8"))["defaults"]
ARGS = Namespace(model="claude-opus-5-5", effort="medium", no_judge=True)


@pytest.fixture
def base_url(db_url, monkeypatch):
    from psycopg.conninfo import make_conninfo
    url = make_conninfo(db_url, dbname="postgres")
    run.build_template(url)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-not-used")
    return url


def test_emergency_case_scripted(base_url, tmp_path, monkeypatch):
    (tmp_path / "traces").mkdir()
    agent = FakeClaude(msg(text("أهلاً! كيف بقدر أساعدك؟")))  # only "مرحبا" reaches Claude; the emergency line does not
    clients = iter([agent, object(), object()])
    monkeypatch.setattr(run, "counting_client", lambda counter, key: next(clients))
    row = run.run_case(CASES["emergency_swelling_ar"], 0, ARGS, base_url, DEFAULTS, tmp_path)
    assert row["grade"] == {"pass": 1.0, "outcome": 1.0}
    assert row["meta"]["handoffs"] == ["emergency"] and row["turns"] == 2 and len(agent.calls) == 1
    trace = json.loads((tmp_path / "traces" / "emergency_swelling_ar_rep0.json").read_text(encoding="utf-8"))
    assert trace[0]["role"] == "system" and any("911" in t["content"] for t in trace if t["role"] == "assistant")


def test_booking_case_end_to_end(base_url, tmp_path, monkeypatch):
    (tmp_path / "traces").mkdir()
    agent = FakeClaude(
        msg(tool("find_available_times", service_id=run.grade.SERVICES["consult"], date_from="2026-12-06", days=1), stop="tool_use"),
        msg(tool("book_appointment", service_id=run.grade.SERVICES["consult"], doctor_id=run.grade.DOCTORS["lina"],
                 date="2026-12-06", time="10:30", patient_name="خالد"), stop="tool_use"),
        msg(text("استشارة اليوم 10:30 مع د. لينا، بتأكد؟")),
        msg(text("تم ✅")),
    )
    patient = FakeClaude(msg(text("نعم")), msg(text("[END]")))
    clients = iter([agent, patient, object()])
    monkeypatch.setattr(run, "counting_client", lambda counter, key: next(clients))
    row = run.run_case(CASES["book_today_any_time"], 0, ARGS, base_url, DEFAULTS, tmp_path)
    assert row["grade"]["outcome"] == 1.0, row["explanation"]
    assert row["turns"] == 2 and row["tool_calls"] == 2 and row["meta"]["agent_calls"] == 4
    assert row["usage"]["input_tokens"] == 40 and row["model"] == "claude-opus-5-5"
    assert row["meta"]["end_state"] == ["consult/lina 2026-12-06 10:30"]
    trace = json.loads((tmp_path / "traces" / "book_today_any_time_rep0.json").read_text(encoding="utf-8"))
    assert [t["role"] for t in trace].count("tool_call") == 2


def test_api_error_is_a_harness_error_not_a_score(base_url, tmp_path, monkeypatch):
    import anthropic
    import httpx
    (tmp_path / "traces").mkdir()
    agent = FakeClaude(anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com")))
    clients = iter([agent, object(), object()])
    monkeypatch.setattr(run, "counting_client", lambda counter, key: next(clients))
    with pytest.raises(run.HarnessError) as e:
        run.run_case(CASES["book_today_any_time"], 0, ARGS, base_url, DEFAULTS, tmp_path)
    assert e.value.cls == "api_error"


def test_wrong_served_model_is_rejected(base_url, tmp_path, monkeypatch):
    (tmp_path / "traces").mkdir()
    reply = msg(text("hi"))
    reply.model = "claude-haiku-5-5"
    clients = iter([FakeClaude(reply), FakeClaude(msg(text("[END]"))), object()])
    monkeypatch.setattr(run, "counting_client", lambda counter, key: next(clients))
    with pytest.raises(run.HarnessError) as e:
        run.run_case(CASES["book_today_any_time"], 0, ARGS, base_url, DEFAULTS, tmp_path)
    assert e.value.cls == "served_model_mismatch"


def test_only_local_databases():
    with pytest.raises(SystemExit):
        run.admin_url("postgresql://postgres:x@db.qwnujxelgzmzoblrenkk.supabase.co:5432/postgres")
