from __future__ import annotations

import importlib.util
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "hermes_langfuse_eval.py"
SPEC = importlib.util.spec_from_file_location("hermes_langfuse_eval", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
EVAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVAL)


def test_fixture_set_has_eight_deterministic_and_two_rubric_tasks() -> None:
    cases = EVAL.load_cases()

    assert len(cases) == 10
    assert sum(case["vars"]["grading"] == "deterministic" for case in cases) == 8
    assert sum(case["vars"]["grading"] == "rubric" for case in cases) == 2
    assert {case["vars"]["model_alias"] for case in cases} == {"hermes-default"}
    assert {case["vars"]["job_name"] for case in cases} == {
        "assistant-task-triage",
        "blocked-parent-triage-digest",
        "daily-summary",
        "github-triage",
        "docs-study",
        "service-pulse",
        "self-audit",
        "assistant-decision-nudge",
        "fleet-health",
        "model-routing-review",
    }


def test_deterministic_grading_checks_required_and_forbidden_terms() -> None:
    score, comment = EVAL.deterministic_score(
        "TASK-42 has a missing field; TASK-08 remains open.",
        {"expected_contains": ["TASK-42", "missing", "TASK-08"], "forbidden": ["all clear"]},
    )

    assert score == 1.0
    assert "passed" in comment


def test_exact_grading_fails_for_extra_output() -> None:
    score, _ = EVAL.deterministic_score("[SILENT]\nExtra text", {"exact_output": "[SILENT]"})

    assert score == 0.0


def test_judge_response_requires_json_and_a_normalized_score() -> None:
    assert EVAL.parse_judge_response('{"score":0.8,"reason":"grounded"}') == (0.8, "grounded")
    assert EVAL.parse_judge_response("not json") == (0.0, "judge response was not valid JSON with a score")
    assert EVAL.parse_judge_response('{"score":5}') == (0.0, "judge score was outside 0–1")


def test_campaign_dimensions_are_mergeable_with_converter_input() -> None:
    payload = EVAL.campaign_dimensions(
        task_pass_rate=0.8,
        judge_score=0.75,
        task_count=10,
        judged_task_count=2,
    )

    quality = payload["campaign_dimensions"]["quality"]
    assert quality["agent_eval_task_pass_rate"] == 0.8
    assert quality["agent_eval_judge_score"] == 0.75
    assert quality["agent_eval_dataset"] == "hermes-agent-jobs-v1"
    assert quality["agent_eval_model_alias"] == "hermes-default"
    assert quality["judge_model"] == "goal-judge"


def test_missing_judge_score_has_a_null_reason() -> None:
    payload = EVAL.campaign_dimensions(
        task_pass_rate=0.8,
        judge_score=None,
        task_count=10,
        judged_task_count=0,
    )

    assert payload["dimension_null_reasons"] == {"quality.agent_eval_judge_score": "NOT_SCORED"}


def test_seed_is_idempotent_and_rejects_changed_fixture_content() -> None:
    class MissingDataset(Exception):
        status_code = 404

    class FakeClient:
        def __init__(self) -> None:
            self.dataset = None
            self.created_items = 0

        def get_dataset(self, name: str) -> SimpleNamespace:
            assert name == EVAL.DATASET_NAME
            if self.dataset is None:
                raise MissingDataset()
            return self.dataset

        def create_dataset(self, **_: object) -> None:
            self.dataset = SimpleNamespace(items=[])

        def create_dataset_item(self, *, dataset_name: str, **payload: object) -> None:
            assert dataset_name == EVAL.DATASET_NAME
            assert self.dataset is not None
            self.dataset.items.append(SimpleNamespace(**payload))
            self.created_items += 1

    client = FakeClient()
    cases = EVAL.load_cases()
    EVAL.seed_dataset(client, cases)
    EVAL.seed_dataset(client, cases)
    assert client.created_items == len(cases)

    changed_cases = deepcopy(cases)
    changed_cases[0]["vars"]["expected_outcome"] = "changed"
    with pytest.raises(ValueError, match="increment DATASET_VERSION"):
        EVAL.seed_dataset(client, changed_cases)
