import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from heldout import _dataset_name, _test_cases, compare_results, main


def result_rows(baseline, candidate):
    rows = []
    for prompt_idx, score, passed in (
        (0, baseline, baseline >= 0.8),
        (1, candidate, candidate >= 0.8),
    ):
        rows.append(
            {
                "promptIdx": prompt_idx,
                "testIdx": 0,
                "provider": {"id": "echo"},
                "success": passed,
                "failureReason": 0 if passed else 1,
                "score": score,
            }
        )
    return {"results": {"prompts": [{"label": "baseline"}, {"label": "candidate"}], "results": rows}}


def real_row(prompt_idx, test_idx, *, success, score, reason, error=None, provider_id="echo", label=""):
    """One result row with the field names promptfoo 0.124.1 writes to its JSON output."""
    return {
        "promptIdx": prompt_idx,
        "testIdx": test_idx,
        "testCase": {
            "description": f"test {test_idx}",
            "vars": {"reference": "fixture-answer"},
            "assert": [{"type": "equals", "value": "{{ reference }}"}],
            "options": {},
            "metadata": {},
        },
        "promptId": f"prompt-{prompt_idx}",
        "success": success,
        "score": score,
        "failureReason": reason,
        "error": error,
        "provider": {"id": provider_id, "label": label},
        "gradingResult": {
            "pass": success,
            "score": score,
            "reason": error or "All assertions passed",
            "namedScores": {},
            "componentResults": [],
        },
        "response": {"output": "fixture-answer", "raw": "fixture-answer", "cost": 0, "cached": False},
    }


def real_document(rows, prompt_count=2):
    prompts = [{"label": f"prompt {i}", "raw": f"prompt {i}"} for i in range(prompt_count)]
    return {"results": {"prompts": prompts, "results": rows, "stats": {"successes": 0, "failures": 0}}}


class HeldoutGateTests(unittest.TestCase):
    def test_candidate_equal_to_baseline_passes(self):
        baseline, candidate = compare_results(result_rows(0.8, 0.8))
        self.assertGreaterEqual(candidate, baseline)

    def test_candidate_below_baseline_fails(self):
        baseline, candidate = compare_results(result_rows(1.0, 0.5))
        self.assertLess(candidate, baseline)

    def test_execution_errors_fail_closed(self):
        document = result_rows(1.0, 1.0)
        document["results"]["results"][0]["failureReason"] = 2
        with self.assertRaisesRegex(ValueError, "execution error"):
            compare_results(document)

    def test_cli_exit_status_gates_candidate_score(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            result_path = Path(tmpdir) / "results.json"
            result_path.write_text(json.dumps(result_rows(0.8, 0.8)))
            self.assertEqual(main(["compare", str(result_path)]), 0)
            result_path.write_text(json.dumps(result_rows(1.0, 0.5)))
            self.assertEqual(main(["compare", str(result_path)]), 1)

    def test_dataset_name_always_selects_holdout(self):
        with patch.dict("os.environ", {"LANGFUSE_DATASET_NAME": "sample"}):
            self.assertEqual(_dataset_name(), "sample-holdout")
        with patch.dict("os.environ", {"LANGFUSE_DATASET_NAME": "sample-train"}):
            with self.assertRaises(RuntimeError):
                _dataset_name()

    def test_expected_output_is_only_in_the_assertion(self):
        case = _test_cases(
            [
                {
                    "sourceTraceId": "fixture-trace",
                    "input": {"question": "fixture question"},
                    "expectedOutput": {"answer": "fixture answer"},
                }
            ]
        )[0]
        self.assertNotIn("expectedOutput", case["vars"])
        self.assertIn('"answer": "fixture answer"', case["assert"][0]["value"])


class RealPromptfooShapeTests(unittest.TestCase):
    """Rows copied in shape from real promptfoo 0.124.1 output (negative and smoke runs)."""

    def test_assertion_failure_is_scored_not_an_error(self):
        # Negative control: promptfoo gives the failing candidate failureReason 1
        # (ASSERT) and fills `error`. Rows arrive candidate-first, as in the real file.
        error = 'Expected output "fixture-answer incorrect" to equal "fixture-answer"'
        document = real_document(
            [
                real_row(1, 0, success=False, score=0, reason=1, error=error),
                real_row(0, 0, success=True, score=1, reason=0),
            ]
        )
        self.assertEqual(compare_results(document), (1.0, 0.0))

    def test_assertion_failure_exits_one_from_file(self):
        document = real_document(
            [
                real_row(1, 0, success=False, score=0, reason=1, error="Expected output to equal"),
                real_row(0, 0, success=True, score=1, reason=0),
            ]
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            result_path = Path(tmpdir) / "neg.json"
            result_path.write_text(json.dumps(document))
            self.assertEqual(main(["compare", str(result_path)]), 1)

    def test_identical_text_candidate_passes_with_real_shape(self):
        # Smoke control: both prompts pass with score 1.
        document = real_document(
            [
                real_row(0, 0, success=True, score=1, reason=0),
                real_row(1, 0, success=True, score=1, reason=0),
            ]
        )
        self.assertEqual(compare_results(document), (1.0, 1.0))

    def test_single_prompt_result_fails_closed(self):
        # promptfoo merges identical prompt text into one prompt. Two are required.
        document = real_document([real_row(0, 0, success=True, score=1, reason=0)], prompt_count=1)
        with self.assertRaisesRegex(ValueError, "Expected two prompts"):
            compare_results(document)

    def test_error_row_with_real_shape_fails_closed(self):
        document = real_document(
            [
                real_row(0, 0, success=True, score=1, reason=0),
                real_row(1, 0, success=False, score=0, reason=2, error="Provider request failed"),
            ]
        )
        with self.assertRaisesRegex(ValueError, "execution error"):
            compare_results(document)

    def test_pairs_are_keyed_by_provider_label_and_test(self):
        # Same provider id, different labels: each label is its own pair.
        document = real_document(
            [
                real_row(0, 0, success=True, score=1, reason=0, provider_id="openrouter:x", label="a"),
                real_row(0, 0, success=True, score=1, reason=0, provider_id="openrouter:x", label="b"),
                real_row(1, 0, success=True, score=1, reason=0, provider_id="openrouter:x", label="a"),
                real_row(1, 0, success=False, score=0, reason=1, provider_id="openrouter:x", label="b",
                         error="Expected output to equal"),
            ]
        )
        self.assertEqual(compare_results(document), (1.0, 0.5))

    def test_missing_candidate_pair_fails_closed(self):
        document = real_document(
            [
                real_row(0, 0, success=True, score=1, reason=0, label="a"),
                real_row(0, 0, success=True, score=1, reason=0, label="b"),
                real_row(1, 0, success=True, score=1, reason=0, label="a"),
            ]
        )
        with self.assertRaisesRegex(ValueError, "do not cover identical"):
            compare_results(document)


if __name__ == "__main__":
    unittest.main()
