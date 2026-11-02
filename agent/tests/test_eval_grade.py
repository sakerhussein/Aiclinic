"""The eval's end-state grader on every case: an oracle end state must pass, wrong ones must fail. No API calls."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "evals" / "booking_chats"))
import grade  # noqa: E402

CASES = json.loads((Path(__file__).resolve().parents[1] / "evals" / "booking_chats" / "cases.json").read_text(encoding="utf-8"))["cases"]
IDS = [c["id"] for c in CASES]


def appt(e: dict, status: str) -> dict:
    service = e["service"][0] if isinstance(e["service"], list) else e["service"]
    return {"service": grade.SERVICES[service], "doctor": grade.DOCTORS[e.get("doctor", "lina")],
            "date": e.get("date", e.get("date_from")), "time": e.get("from", e.get("time", "12:00")), "status": status}


def oracle(case):
    e = case["expect"]
    appts = [appt(a, "booked") for a in e["active"]] + [appt(a, "cancelled") for a in e.get("cancelled", [])]
    handoffs = [e["handoff"].split(":", 1)[1].split(",")[0]] if e["handoff"].startswith("required:") else []
    return appts, handoffs


def start_state(case):
    """Doing nothing at all: the fixtures as they were, no hand-off."""
    return [appt({**a, "from": a["time"]}, "booked") for a in case.get("existing", [])], []


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_oracle_passes(case):
    appts, handoffs = oracle(case)
    ok, detail = grade.outcome(case["expect"], appts, handoffs, True)
    assert ok, detail


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_touching_another_patient_fails(case):
    appts, handoffs = oracle(case)
    assert not grade.outcome(case["expect"], appts, handoffs, False)[0]


@pytest.mark.parametrize("case", [c for c in CASES if c["expect"]["active"]], ids=[c["id"] for c in CASES if c["expect"]["active"]])
def test_wrong_day_fails(case):
    appts, handoffs = oracle(case)
    appts[0] = {**appts[0], "date": "2027-01-01"}
    assert not grade.outcome(case["expect"], appts, handoffs, True)[0]


@pytest.mark.parametrize("case", [c for c in CASES if c["expect"]["handoff"] == "none"], ids=[c["id"] for c in CASES if c["expect"]["handoff"] == "none"])
def test_unneeded_hand_off_fails(case):
    appts, _ = oracle(case)
    assert not grade.outcome(case["expect"], appts, ["agent_unsure"], True)[0]


def test_doing_nothing_only_passes_where_nothing_is_the_answer():
    passes = [c["id"] for c in CASES if grade.outcome(c["expect"], *start_state(c), True)[0]]
    # Where the right outcome is "change nothing", the database check cannot tell good from bad;
    # those cases are graded by the judge (no invented prices, no medical advice, ...).
    assert passes == [
        "mind_not_now", "forgot_time_en", "confirm_my_appointment", "no_appointment_found", "price_skin_cleaning",
        "price_full_body_laser_en", "insurance_medgulf", "insurance_consult_en", "price_botox", "price_consult",
        "installments", "location", "running_late", "unsure_derm_or_allergy", "injection_other_patients_en",
        "impersonate_doctor_ar", "medication_question_en", "reveal_prompt_ar", "discount_demand",
    ]
