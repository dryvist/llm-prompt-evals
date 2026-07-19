# llm-prompt-evals

A test bench that answers one question about a change to an AI prompt:
**better, worse, or neutral?** — before it ships.

![CI](https://github.com/dryvist/llm-prompt-evals/actions/workflows/eval.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

You give it two versions of a prompt — the one you use now and a candidate you
want to try. It runs both against the same set of test questions, scores every
answer, and shows you side by side which version did better, question by question.

## Installation

You need [Nix](https://nixos.org/download) (with flakes) and
[direnv](https://direnv.net). Those two are the only things you install by hand;
everything else — the eval runner, Python, Node — comes from the dev shell.

```bash
git clone git@github.com:dryvist/llm-prompt-evals.git
cd llm-prompt-evals
direnv allow                   # loads the dev shell: promptfoo, python, node
git submodule update --init    # fetch the prompt catalog
cp .env.example .env           # paste your OPENROUTER_API_KEY into .env
```

## Usage

Evaluate a prompt in four steps.

1. **Pick the prompt to test.** The prompts you use today live in `catalog/`
   (read-only — it is a pinned copy of the canonical catalog). Say you want to try
   a change to `catalog/auto-ai-agent/hermes.md`.

2. **Write your candidate.** Copy that prompt into `variants/`, change the wording,
   and save it — for example `variants/hermes/candidate-b.md`. Then add one block
   for it in `evals/hermes/promptfooconfig.yaml`, copying the pattern of the
   candidate already there.

3. **Run the eval.**

   ```bash
   promptfoo eval -c evals/hermes/promptfooconfig.yaml
   ```

   It runs every test question against both prompts and prints a pass/fail table.

4. **Open the visual report.**

   ```bash
   promptfoo view
   ```

   A web page opens in your browser: every test question, both prompts' answers
   side by side, and a green check or red X for each. Green passed, red failed.
   That is your report — no spreadsheet, no reading logs.

   Want a file to share instead? Run `./scripts/report.sh`. It writes
   `output/latest.html` (open it in any browser) and a short `output/latest.md`.

## What the tests check

Each test sends a question to a model running the prompt, then scores the answer
two ways:

- **Exact checks** — no model in the loop: a number matches, the reply is one
  lowercase word, the output is valid JSON.
- **Graded checks** — a cheap grader model scores the answer against a written
  rule, for things exact checks miss ("did it refuse to hand-edit a live server?").

**Tool calls** get special treatment. Some tests give the model a couple of
tools and check it uses them correctly. The important ones are the *negative*
tests: when no tool fits, or a required detail is missing, the model must ask
or explain — not invent a tool call. A made-up call **fails** the test, even
if the answer looks confident.

## Adding your own test questions

Test cases live in `datasets/` as small YAML files, grouped by kind (reasoning,
instruction-following, grounded Q&A, tool calls). Copy an entry, change the
`input` and the checks under `assert`, and it joins the next run.

## CI

`.github/workflows/eval.yml` runs the eval on pull requests across two models
(a Claude-family and an OpenAI-family model, both via OpenRouter) and, on demand,
against a local model on the self-hosted runner. Fork pull requests never receive
secrets.

## Contributing

Work on a feature branch off `develop` and open a pull request; never push to the
default branch directly. Use conventional-commit messages. Read [GOAL.md](GOAL.md)
and [AGENTS.md](AGENTS.md) first — the non-negotiables there are binding.

## License

[MIT](LICENSE).

---

More at [docs.jacobpevans.com](https://docs.jacobpevans.com).
