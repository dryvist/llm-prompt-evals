"""Assert-based checks for load_okf. Run: python3 prompts/test_load_okf.py"""

from load_okf import _resolve, load_okf, load_prompt, strip_frontmatter

FM = """---
type: LLM Prompt Fragment
title: "Example"
render:
  frontmatter: strip
---
## Body heading

Real content.
"""


def test_strip_removes_frontmatter():
    body = strip_frontmatter(FM)
    assert body.startswith("## Body heading"), body[:40]
    assert "type:" not in body
    assert "render:" not in body
    assert body.rstrip().endswith("Real content.")


def test_strip_noop_without_frontmatter():
    plain = "## Just a heading\n\nNo frontmatter here.\n"
    assert strip_frontmatter(plain) == plain


def test_strip_leaves_inner_hr_alone():
    # A horizontal rule inside the body must survive; only the leading block goes.
    text = "---\ntype: x\n---\nbefore\n\n---\n\nafter\n"
    body = strip_frontmatter(text)
    assert body.startswith("before")
    assert "---" in body  # the inner rule is still there


def test_resolve_prompt_id_maps_to_catalog():
    assert _resolve("prompt://dryvist/auto-ai-agent/hermes") == _resolve(
        "catalog/auto-ai-agent/hermes.md"
    )


def test_canonical_hermes_loads_and_is_stripped():
    body = load_okf("catalog/auto-ai-agent/hermes.md")
    assert body.startswith("## You are Hermes"), body[:40]
    assert 'resource:' not in body
    assert "prompt://dryvist/auto-ai-agent/hermes" not in body


def test_prompt_id_and_path_agree():
    assert load_okf("prompt://dryvist/auto-ai-agent/hermes") == load_okf(
        "catalog/auto-ai-agent/hermes.md"
    )


def test_load_prompt_builds_messages():
    msgs = load_prompt(
        {"config": {"okf": "catalog/auto-ai-agent/hermes.md"}, "vars": {"input": "hi"}}
    )
    assert [m["role"] for m in msgs] == ["system", "user"]
    assert msgs[0]["content"].startswith("## You are Hermes")
    assert msgs[1]["content"] == "hi"


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
            passed += 1
    print(f"\n{passed} passed")
