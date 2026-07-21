"""promptfoo Python prompt function for the Hermes tool-calling gate.

Mirrors ``prompts/load_okf.py:load_prompt`` (same ``context`` -> message-list
contract) but is purpose-built for tool-calling tests:

- Default system prompt is a compact kanban-agent brief that names the discipline
  the gate scores (use a fitting tool, never invent one, ask when a required arg
  is missing, obey the output contract).
- ``vars['history']`` — if present, it is a complete chat message list (system +
  prior user/assistant/tool turns) and is returned verbatim. This is how the
  multi-turn tool-result-incorporation case supplies a real role-tagged history
  including an assistant ``tool_calls`` turn and its ``tool`` result.
- Otherwise a single user turn is built from ``vars['input']`` (optionally with a
  per-test ``vars['system']`` override).
"""

from __future__ import annotations

DEFAULT_SYSTEM = (
    "You manage a homelab kanban board through tools. Call a tool only when one "
    "in the provided registry fits the request, and emit a single well-formed "
    "tool call with every required argument. If no tool fits, or a required "
    "argument is missing, do not call a tool and do not invent one — answer in "
    "plain text or ask for the missing detail. When the user specifies an exact "
    "output format, return exactly that and nothing else."
)


def build(context: dict) -> list[dict]:
    vars_ = context.get("vars") or {}
    history = vars_.get("history")
    if history:
        # A complete, role-tagged conversation supplied by the test case.
        return history
    system = vars_.get("system") or DEFAULT_SYSTEM
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": vars_.get("input", "")},
    ]
