# GOAL — llm-prompt-evals

Binding goal for this repo. Read it before changing anything here.

## Purpose

Evaluate and compare dryvist LLM prompts with [promptfoo](https://promptfoo.dev).
Prompts are the product; this repo is the test bench that tells you whether a
prompt change is better, worse, or neutral before it ships.

## The one hard rule about prompts

Prompts stay **canonical** in `dryvist/ai-llm-prompts`. This repo consumes them
through the `catalog/` git submodule, pinned to a release commit and bumped by
Renovate. **Never copy a canonical prompt into this repo.** A prompt file under
`variants/` is a *candidate under test* — a deliberate fork you want to measure
against the canonical version — not a second copy of the source of truth.

## Non-negotiables

- **Never commit secrets or fabric endpoints.** Every key and URL comes from the
  environment (`.env` locally, runner env in CI). `.env` is gitignored.
- **Fork pull requests never receive cloud secrets.** Cloud-provider jobs run
  only on same-repo pull requests; forks fall back to a runner with no secrets.
- **Negative tool-call cases must FAIL a fabricated call.** When no registered
  tool fits, or a required argument is missing, the correct behavior is to ask
  or explain — not to invent a tool call. The assertion enforces that.
- **`catalog/` is a pinned submodule.** Bump it through Renovate, never by
  editing prompt files in place.
- **Conventional commits.** Work on a feature branch off `develop`; never edit
  the default branch directly.

## Layout

| Path | Holds |
| --- | --- |
| `catalog/` | Pinned submodule — the canonical prompt catalog (read-only here). |
| `prompts/` | `load_okf.py`: loads an OKF prompt by path or `prompt://` id, strips frontmatter. |
| `variants/` | Candidate prompts under test (e.g. `hermes/candidate-a.md`). |
| `providers/` | promptfoo provider configs (`local.yaml`, `cloud.yaml`). |
| `evals/` | Eval suites (`hermes/promptfooconfig.yaml` + `tests.yaml`). |
| `datasets/` | Test cases ported from `mlx-benchmarks` probe banks. |
| `scripts/` | `report.sh` — renders `output/latest.{json,html}` + a markdown summary. |

## Definition of done

- `promptfoo eval` runs green against a cloud provider, with the canonical Hermes
  prompt compared to at least one candidate variant.
- The eval carries at least 8 deterministic assertions and at least 2 llm-rubric
  assertions; every negative tool-call case fails a fabricated call.
- CI runs the cloud matrix on same-repo pull requests and a gated fabric job on
  the self-hosted runner, with no secrets or endpoints in the repo.
- The "LLM prompt evaluation" page exists in `dryvist/docs` and
  `dryvist/docs-starlight`.
