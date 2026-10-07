#!/usr/bin/env python3
"""Seed and run the fixed Hermes job set as a native Langfuse experiment."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATASET_PATH = ROOT / "datasets" / "hermes_jobs.json"
DATASET_VERSION = "1"
DATASET_NAME = f"hermes-agent-jobs-v{DATASET_VERSION}"
TASK_MODEL_ALIAS = "hermes-default"
JUDGE_MODEL_ALIAS = "goal-judge"
PASS_THRESHOLD = 0.75

sys.path.insert(0, str(ROOT / "prompts"))
from load_okf import load_okf  # noqa: E402


def load_cases(path: Path = DATASET_PATH) -> list[dict[str, Any]]:
    """Load and validate the shared Promptfoo/Langfuse fixture file."""
    cases = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(cases, list) or not 5 <= len(cases) <= 15:
        raise ValueError("Hermes task set must contain 5–15 cases")

    ids: set[str] = set()
    grading_counts = {"deterministic": 0, "rubric": 0}
    for case in cases:
        if not isinstance(case, dict) or not isinstance(case.get("vars"), dict):
            raise ValueError("each case must contain a vars object")
        values = case["vars"]
        for field in ("task_id", "job_name", "model_alias", "grading", "input", "expected_outcome"):
            if not isinstance(values.get(field), str) or not values[field]:
                raise ValueError(f"each case needs a non-empty {field}")
        task_id = values["task_id"]
        if task_id in ids:
            raise ValueError(f"duplicate task id: {task_id}")
        ids.add(task_id)
        if values["model_alias"] != TASK_MODEL_ALIAS:
            raise ValueError(f"{task_id} uses an unexpected model alias")
        grading = values["grading"]
        if grading not in grading_counts:
            raise ValueError(f"{task_id} has unsupported grading mode: {grading}")
        grading_counts[grading] += 1
        if grading == "rubric" and not values.get("rubric"):
            raise ValueError(f"{task_id} needs a rubric")
        if "assert" not in case or not case["assert"]:
            raise ValueError(f"{task_id} needs Promptfoo assertions")

    if grading_counts != {"deterministic": 8, "rubric": 2}:
        raise ValueError("fixture set must contain eight deterministic and two rubric tasks")
    return cases


def item_payload(case: dict[str, Any]) -> dict[str, Any]:
    """Map one Promptfoo case to a stable Langfuse dataset item."""
    values = case["vars"]
    metadata_keys = (
        "task_id",
        "job_name",
        "model_alias",
        "grading",
        "exact_output",
        "expected_contains",
        "forbidden",
        "rubric",
    )
    return {
        "id": values["task_id"],
        "input": {"job_name": values["job_name"], "prompt": values["input"]},
        "expected_output": values["expected_outcome"],
        "metadata": {key: values[key] for key in metadata_keys if key in values},
    }


def deterministic_score(output: str, metadata: dict[str, Any]) -> tuple[float, str]:
    """Score the deterministic cases from their declared fixture contract."""
    if "exact_output" in metadata:
        passed = output.strip() == metadata["exact_output"]
        return float(passed), "exact output matched" if passed else "exact output differed"

    normalized = output.casefold()
    missing = [term for term in metadata.get("expected_contains", []) if term.casefold() not in normalized]
    present = [term for term in metadata.get("forbidden", []) if term.casefold() in normalized]
    passed = not missing and not present
    details = []
    if missing:
        details.append(f"missing required terms: {', '.join(missing)}")
    if present:
        details.append(f"contains forbidden terms: {', '.join(present)}")
    return float(passed), "; ".join(details) if details else "required and forbidden terms passed"


def campaign_dimensions(
    *,
    task_pass_rate: float,
    judge_score: float | None,
    task_count: int,
    judged_task_count: int,
) -> dict[str, Any]:
    """Return the additive quality dimensions accepted by mlx-bench-publish."""
    payload = {
        "campaign_dimensions": {
            "quality": {
                "benchmark_name": DATASET_NAME,
                "benchmark_version": DATASET_VERSION,
                "subset": "all",
                "sample_count": task_count,
                "agent_eval_task_pass_rate": task_pass_rate,
                "agent_eval_judge_score": judge_score,
                "agent_eval_judged_task_count": judged_task_count,
                "agent_eval_dataset": DATASET_NAME,
                "agent_eval_model_alias": TASK_MODEL_ALIAS,
                "judge_model": JUDGE_MODEL_ALIAS,
                "contamination_note": "Fixed synthetic tasks derived from recurring job contracts.",
            }
        }
    }
    if judge_score is None:
        payload["dimension_null_reasons"] = {"quality.agent_eval_judge_score": "NOT_SCORED"}
    return payload


def _get_attr(item: Any, name: str) -> Any:
    return item.get(name) if isinstance(item, dict) else getattr(item, name)


def _score_map(item_result: Any) -> dict[str, float]:
    scores = {}
    for evaluation in _get_attr(item_result, "evaluations") or []:
        name = _get_attr(evaluation, "name")
        value = _get_attr(evaluation, "value")
        if isinstance(value, int | float):
            scores[name] = float(value)
    return scores


def _run_evaluator(name: str) -> Callable[..., Any]:
    def evaluate(*, item_results: Sequence[Any], **_: Any) -> Any:
        from langfuse import Evaluation

        scores = [_score_map(result).get(name) for result in item_results]
        valid = [score for score in scores if score is not None]
        value = sum(valid) / len(valid) if valid else 0.0
        return Evaluation(
            name=name,
            value=value,
            comment=f"Mean {name} across {len(valid)} scored task items.",
            data_type="NUMERIC",
        )

    return evaluate


def _langfuse_client() -> Any:
    required = ("LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")
    from langfuse import get_client

    return get_client()


def seed_dataset(client: Any, cases: Sequence[dict[str, Any]]) -> None:
    """Create the versioned dataset and add missing stable fixture items."""
    try:
        dataset = client.get_dataset(DATASET_NAME)
    except Exception as exc:
        if getattr(exc, "status_code", None) != 404:
            raise
        client.create_dataset(
            name=DATASET_NAME,
            description="Fixed synthetic tasks derived from recurring Hermes job contracts.",
            metadata={"version": DATASET_VERSION, "model_alias": TASK_MODEL_ALIAS},
        )
        dataset = client.get_dataset(DATASET_NAME)

    payloads = [item_payload(case) for case in cases]
    existing_items = {_get_attr(item, "id"): item for item in dataset.items}
    expected_ids = {payload["id"] for payload in payloads}
    if existing_items.keys() - expected_ids:
        raise ValueError(
            "Langfuse dataset contains items outside this fixture version; "
            "increment DATASET_VERSION before changing the task set"
        )

    for payload in payloads:
        existing = existing_items.get(payload["id"])
        if existing is not None:
            if any(
                _get_attr(existing, key) != payload[key]
                for key in ("input", "expected_output", "metadata")
            ):
                raise ValueError(
                    f"Langfuse item {payload['id']} differs from its fixture; "
                    "increment DATASET_VERSION before changing an expected outcome"
                )
        else:
            client.create_dataset_item(dataset_name=DATASET_NAME, **payload)


def run_experiment(client: Any, cases: Sequence[dict[str, Any]]) -> Any:
    """Run the hosted dataset against the task and judge router aliases."""
    from openai import OpenAI
    from langfuse import Evaluation

    base_url = os.environ.get("LOCAL_FABRIC_BASE_URL")
    if not base_url:
        raise SystemExit("Missing required environment variable: LOCAL_FABRIC_BASE_URL")
    api_key = os.environ.get("LOCAL_FABRIC_API_KEY") or "sk-local-noauth"
    worker = OpenAI(base_url=base_url, api_key=api_key)
    judge = OpenAI(base_url=base_url, api_key=api_key)
    system_prompt = load_okf("catalog/auto-ai-agent/hermes.md")
    dataset = client.get_dataset(DATASET_NAME)
    expected_ids = {case["vars"]["task_id"] for case in cases}
    actual_ids = {_get_attr(item, "id") for item in dataset.items}
    if actual_ids != expected_ids:
        raise SystemExit(
            "Langfuse dataset items do not match this fixture version. "
            "Run seed first or increment DATASET_VERSION."
        )

    def task(*, item: Any, **_: Any) -> str:
        item_input = _get_attr(item, "input")
        completion = worker.chat.completions.create(
            model=TASK_MODEL_ALIAS,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": item_input["prompt"]},
            ],
            temperature=0,
        )
        return completion.choices[0].message.content or ""

    def item_evaluator(
        *, input: dict[str, Any], output: str, expected_output: str, metadata: dict[str, Any], **_: Any
    ) -> list[Any]:
        if metadata["grading"] == "deterministic":
            score, comment = deterministic_score(output, metadata)
            return [
                Evaluation(name="task_pass", value=score, comment=comment, data_type="NUMERIC")
            ]

        response = judge.chat.completions.create(
            model=JUDGE_MODEL_ALIAS,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a strict evaluation judge. Apply only the supplied rubric. "
                        "Return one JSON object with numeric score from 0 to 1 and a short reason."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "rubric": metadata["rubric"],
                            "expected_outcome": expected_output,
                            "input": input,
                            "output": output,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            temperature=0,
        )
        score, reason = parse_judge_response(response.choices[0].message.content or "")
        return [
            Evaluation(name="judge_score", value=score, comment=reason, data_type="NUMERIC"),
            Evaluation(
                name="task_pass",
                value=float(score >= PASS_THRESHOLD),
                comment=f"Rubric score {score:.2f}; pass threshold {PASS_THRESHOLD:.2f}.",
                data_type="NUMERIC",
            ),
        ]

    run_name = "hermes-agent-jobs-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return dataset.run_experiment(
        name="Hermes recurring-job quality",
        run_name=run_name,
        description="Fixed synthetic tasks using hermes-default and goal-judge router aliases.",
        task=task,
        evaluators=[item_evaluator],
        run_evaluators=[_run_evaluator("task_pass"), _run_evaluator("judge_score")],
        max_concurrency=1,
        metadata={
            "dataset_version": DATASET_VERSION,
            "model_alias": TASK_MODEL_ALIAS,
            "judge_model": JUDGE_MODEL_ALIAS,
        },
    )


def parse_judge_response(content: str) -> tuple[float, str]:
    """Parse a judge score without accepting malformed or out-of-range values."""
    candidate = content.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", candidate, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        candidate = fenced.group(1)
    try:
        payload = json.loads(candidate)
        score = float(payload["score"])
        reason = str(payload.get("reason", ""))
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return 0.0, "judge response was not valid JSON with a score"
    if not 0.0 <= score <= 1.0:
        return 0.0, "judge score was outside 0–1"
    return score, reason


def write_summary(path: Path, result: Any, task_count: int) -> dict[str, Any]:
    item_scores = [_score_map(item) for item in result.item_results]
    task_passes = [scores.get("task_pass", 0.0) for scores in item_scores]
    judged = [scores["judge_score"] for scores in item_scores if "judge_score" in scores]
    summary = campaign_dimensions(
        task_pass_rate=sum(task_passes) / task_count if task_count else 0.0,
        judge_score=sum(judged) / len(judged) if judged else None,
        task_count=task_count,
        judged_task_count=len(judged),
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("validate", help="validate fixtures without network access")
    subparsers.add_parser("seed", help="create or update the Langfuse dataset")
    run_parser = subparsers.add_parser("run", help="run and score the Langfuse experiment")
    run_parser.add_argument(
        "--summary-json",
        type=Path,
        default=ROOT / "output" / "hermes-agent-eval-dimensions.json",
        help="write campaign_dimensions JSON for mlx-bench-publish",
    )
    args = parser.parse_args(argv)
    cases = load_cases()

    if args.command == "validate":
        print(f"Validated {len(cases)} tasks (8 deterministic, 2 rubric).")
        return 0
    client = _langfuse_client()
    if args.command == "seed":
        seed_dataset(client, cases)
        client.flush()
        print(f"Seeded {len(cases)} items in the {DATASET_NAME} dataset.")
        return 0

    result = run_experiment(client, cases)
    summary = write_summary(args.summary_json, result, len(cases))
    client.flush()
    quality = summary["campaign_dimensions"]["quality"]
    print(
        "Hermes task pass rate: "
        f"{quality['agent_eval_task_pass_rate']:.3f}; "
        f"judge score: {quality['agent_eval_judge_score']!s}; "
        f"summary: {args.summary_json}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
