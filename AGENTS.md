# AGENTS.md

Rules for anyone (human or agent) working in this repo. Distilled from
[GOAL.md](GOAL.md) — read that too.

## Never

- **Never commit a secret or a fabric endpoint.** Keys and URLs come from the
  environment. `.env` is gitignored; keep it that way.
- **Never copy a canonical prompt into this repo.** Canonical prompts live in
  the `catalog/` submodule (`dryvist/ai-llm-prompts`). Files under `variants/`
  are candidates under test, not copies of the source of truth.
- **Never let a fork pull request reach cloud secrets.** Cloud jobs are gated to
  same-repo pull requests.
- **Never weaken a negative tool-call assertion.** A fabricated tool call must
  fail. That is the point of the negative bank.

## Always

- **Bump `catalog/` through Renovate**, which is configured for the
  git-submodules manager. Do not edit prompt files inside the submodule.
- **Work on a feature branch off `develop`**; open a pull request. Never push to
  the default branch directly. Use conventional-commit messages.
- **Read every credential and endpoint from the environment.** See
  `.env.example` for the variable names.

## Running an eval

Tooling comes from the Nix dev shell — never `npm install`. `promptfoo` is
provided by the flake (nixpkgs), alongside `python3` and `node`.

```bash
direnv allow           # dev shell: promptfoo, python, node (no npm)
git submodule update --init   # fetch the pinned catalog
cp .env.example .env   # add OPENROUTER_API_KEY
promptfoo eval -c evals/hermes/promptfooconfig.yaml
promptfoo view         # the visual pass/fail report in a browser
./scripts/report.sh    # or write output/latest.{json,html} + a summary
```
