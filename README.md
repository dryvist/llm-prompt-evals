# llm-prompt-evals

A [promptfoo](https://promptfoo.dev) test bench that answers one question about a
prompt change: **better, worse, or neutral?** — before it ships.

![CI](https://github.com/dryvist/llm-prompt-evals/actions/workflows/eval.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Installation

```bash
npm ci
git submodule update --init            # fetch the pinned catalog/
cp .env.example .env                    # add OPENROUTER_API_KEY / ANTHROPIC_API_KEY
```

Requires Node 20+, Python 3.10+ (for the prompt loader), and git. All
credentials and endpoints are read from the environment — `.env` locally, runner
env in CI. Nothing sensitive is committed.

## Usage

```bash
npm run eval                            # run the hermes eval suite
npm run report                          # render output/latest.{json,html} + a summary
npm run view                            # open the promptfoo results viewer
```

## What is here

Prompts under test are candidates, not copies. The canonical prompts arrive as
an OKF markdown bundle pinned at the `catalog/` submodule; this repo measures
`variants/` candidates against them and never edits the canonical source.

- **`catalog/`** — pinned submodule holding the canonical prompt catalog (read-only).
- **`prompts/load_okf.py`** — loads an OKF prompt by path or `prompt://` id and
  strips its YAML frontmatter, returning the system prompt.
- **`variants/hermes/candidate-a.md`** — a candidate Hermes prompt under test.
- **`providers/`** — `local.yaml` (OpenAI-compatible local fabric) and
  `cloud.yaml` (Anthropic + OpenRouter, with a cheap OpenRouter model as the
  default llm-rubric grader).
- **`evals/hermes/`** — the suite comparing canonical Hermes to the candidate,
  with deterministic and llm-rubric assertions.
- **`datasets/`** — reasoning, instruction, homelab-QA, and tool-call test cases.
  The tool-call negative bank asserts that a fabricated call **fails**.

## CI

`.github/workflows/eval.yml` runs the cloud-provider matrix on same-repo pull
requests (forks never receive secrets) and a separate fabric job on the
self-hosted runner, gated to push / dispatch / labeled same-repo pull requests.

## Contributing

Work on a feature branch off `develop` and open a pull request; never push to the
default branch directly. Use conventional-commit messages. Read [GOAL.md](GOAL.md)
and [AGENTS.md](AGENTS.md) first — the non-negotiables there are binding.

## License

[MIT](LICENSE).

---

More at [docs.jacobpevans.com](https://docs.jacobpevans.com).
