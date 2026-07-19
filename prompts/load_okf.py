"""Load OKF markdown prompts for promptfoo.

An OKF (Open Knowledge Format) prompt file is markdown with a leading YAML
frontmatter block. The catalog marks prompts with ``render.frontmatter: strip``,
so consumers must drop the frontmatter and use only the body as the system
prompt.

Two entry points:

- ``load_okf(resource)`` — the pure, unit-tested core: resolve a filesystem path
  or a ``prompt://dryvist/<catalog>/<name>`` resource id, read the file, strip
  the YAML frontmatter, and return the body string.
- ``load_prompt(context)`` — the promptfoo Python prompt function: build a chat
  message list from an OKF system prompt plus the test case's user ``input``.
  The OKF file to load comes from the prompt's ``config.okf`` in promptfooconfig.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

# Repo root = parent of this prompts/ directory. Paths resolve from here so the
# loader works regardless of the current working directory.
REPO_ROOT = Path(__file__).resolve().parent.parent

# Matches a leading YAML frontmatter block: an opening ``---`` fence, any body,
# and a closing ``---`` fence, all anchored at the very start of the file.
_FRONTMATTER = re.compile(r"\A﻿?---[ \t]*\n.*?\n---[ \t]*\n", re.DOTALL)


def strip_frontmatter(text: str) -> str:
    """Return ``text`` with a leading YAML frontmatter block removed.

    Text without frontmatter is returned unchanged (minus a leading BOM).
    """
    stripped = _FRONTMATTER.sub("", text, count=1)
    if stripped is text:  # no frontmatter matched
        stripped = text.lstrip("﻿")
    return stripped.lstrip("\n")


def _resolve(resource: str) -> Path:
    """Resolve a path or ``prompt://`` id to a filesystem path under the repo."""
    if resource.startswith("prompt://"):
        rest = resource[len("prompt://") :]
        parts = [p for p in rest.split("/") if p]
        if parts and parts[0] == "dryvist":
            parts = parts[1:]
        if not parts:
            raise ValueError(f"empty prompt id: {resource!r}")
        return REPO_ROOT / "catalog" / (os.path.join(*parts) + ".md")
    # A filesystem path: absolute wins, relative resolves from the repo root.
    return REPO_ROOT / resource


def load_okf(resource: str) -> str:
    """Load an OKF prompt by path or ``prompt://`` id, return its body string."""
    return strip_frontmatter(_resolve(resource).read_text(encoding="utf-8"))


def load_prompt(context: dict) -> list[dict]:
    """promptfoo Python prompt function.

    ``context['config']['okf']`` names the OKF file (path or ``prompt://`` id).
    ``context['vars']['input']`` is the test case's user turn.
    """
    config = context.get("config") or {}
    vars_ = context.get("vars") or {}
    okf = config.get("okf") or vars_.get("okf")
    if not okf:
        raise ValueError("no OKF prompt specified: set prompt config.okf")
    return [
        {"role": "system", "content": load_okf(okf)},
        {"role": "user", "content": vars_.get("input", "")},
    ]
