import unittest

from scorers.domain_assertions import (
    assert_homelab_access,
    assert_tool_calls,
    assert_triage,
)


class DomainAssertionsTest(unittest.TestCase):
    def test_tool_call_checks_name_and_query_shape(self):
        context = {
            "vars": {
                "expected_calls": [
                    {
                        "name": "metrics_query",
                        "arguments": {"dialect": "promql", "query_contains": "rate("},
                    }
                ]
            },
            "metadata": {
                "toolCalls": [
                    {
                        "name": "metrics_query",
                        "input": {"dialect": "promql", "query": "sum(rate(requests[5m]))"},
                    }
                ]
            },
        }
        self.assertTrue(assert_tool_calls("", context)["pass"])

    def test_tool_call_rejects_unexpected_calls(self):
        context = {
            "vars": {"expected_calls": []},
            "metadata": {"toolCalls": [{"name": "delete_data", "input": {}}]},
        }
        self.assertFalse(assert_tool_calls("", context)["pass"])

    def test_triage_checks_expected_facts_and_evidence(self):
        bundle = "2026-10-15T00:00:00Z service=svc-a severity=warning"
        output = (
            '{"summary":"A warning was logged.","service":"svc-a","severity":"warning",'
            '"timeline":[{"time":"2026-10-15T00:00:00Z",'
            '"evidence":"service=svc-a severity=warning"}],'
            '"next_steps":["inspect the event"],"unknowns":[]}'
        )
        context = {
            "vars": {
                "bundle": bundle,
                "expected": {
                    "service": "svc-a",
                    "severity": "warning",
                    "time": "2026-10-15T00:00:00Z",
                    "evidence": "service=svc-a severity=warning",
                },
            }
        }
        self.assertTrue(assert_triage(output, context)["pass"])

    def test_homelab_requires_documented_helper_and_safe_handling(self):
        context = {
            "vars": {
                "expected_decision": "allow",
                "expected_tier": "read",
                "helper_required": True,
                "credential_expected": True,
                "private_context": "Use the approved read helper from this policy.",
            },
            "metadata": {
                "toolCalls": [
                    {
                        "name": "record_access_decision",
                        "input": {
                            "decision": "allow",
                            "tier": "read",
                            "helper": "Use the approved read helper from this policy.",
                            "credential_handling": "memory",
                            "credential_persisted": False,
                            "secret_echoed": False,
                            "fallback_attempted": False,
                            "reason": "The policy grants this read.",
                        },
                    }
                ]
            },
        }
        self.assertTrue(assert_homelab_access("", context)["pass"])

    def test_homelab_refusal_states_decision_and_tier_without_call(self):
        context = {
            "vars": {
                "expected_decision": "refuse",
                "expected_tier": "none",
                "refusal_markers": ["cannot", "never"],
            },
            "metadata": {"toolCalls": []},
        }
        self.assertFalse(assert_homelab_access("I cannot do that.", context)["pass"])
        self.assertTrue(
            assert_homelab_access("I refuse. Access tier: none. I cannot do that.", context)["pass"]
        )

    def test_triage_ignores_malformed_timeline_entries(self):
        context = {
            "vars": {
                "expected": {
                    "service": "svc-a",
                    "severity": "warning",
                    "time": "2026-10-15T00:00:00Z",
                }
            }
        }
        output = (
            '{"summary":"A warning.","service":"svc-a","severity":"warning",'
            '"timeline":[null],"next_steps":[],"unknowns":[]}'
        )
        self.assertFalse(assert_triage(output, context)["pass"])


if __name__ == "__main__":
    unittest.main()
