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
```

The eval reads its provider keys from the environment; `.env.example` lists the
variable names.

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

## Domain eval suites

The domain suites use synthetic, versioned cases. Current counts are SPL 20,
tool queries 20, agentic 20 (12 single-turn and 8 transcript-based multi-turn),
triage 20, and homelab access 35. Each dataset manifest records its version,
case count, format, and scoring contract.

### 1. Run commands

Set the required environment variables below, then run one suite from the repo
root:

```bash
promptfoo eval -c evals/spl/promptfooconfig.yaml -o results/spl.json
promptfoo eval -c evals/tool-queries/promptfooconfig.yaml \
  -o results/tool-queries.json
promptfoo eval -c evals/agentic/promptfooconfig.yaml -o results/agentic.json
promptfoo eval -c evals/triage/promptfooconfig.yaml -o results/triage.json
```

Homelab access reads private context only at runtime. Set
EVAL_PRIVATE_CONTEXT_DIR to a local directory containing AGENTS.md and
methods/*.md. The expanded context is passed to the model by the command and
is never stored in the dataset:

```bash
EVAL_PRIVATE_CONTEXT="$(cat "$EVAL_PRIVATE_CONTEXT_DIR"/AGENTS.md \
  "$EVAL_PRIVATE_CONTEXT_DIR"/methods/*.md)" \
  promptfoo eval -c evals/homelab-access/promptfooconfig.yaml \
  -o results/homelab-access.json
```

Results include prompts and model responses. Homelab results can contain the
expanded private context, so keep the raw JSON local. The results/*.json files
are ignored by Git. The parallel mlx-benchmarks Promptfoo converter consumes
these Promptfoo JSON files; publish aggregate score rows only, without case
prompts, private context, or traces.

### 2. Environment variables

| Variable | Used by |
| --- | --- |
| LITELLM_BASE_URL, LITELLM_API_KEY | All suites; LiteLLM target |
| LITELLM_MODEL | All suites |
| LITELLM_JUDGE_MODEL | Triage judge through LiteLLM |
| SPLUNK_REST_URL, SPLUNK_TOKEN | SPL parser and fixture search |
| SPLUNK_INDEX | SPL parser and fixture search |
| SPLUNK_EARLIEST_TIME, SPLUNK_LATEST_TIME | Frozen fixture search bounds |
| SPLUNK_HEC_URL, SPLUNK_HEC_TOKEN | One-shot fixture loading |
| EVAL_PRIVATE_CONTEXT_DIR | Local private context directory |
| EVAL_ACCESS_LIVE | Enable optional read check |
| EVAL_ACCESS_READ_URL, EVAL_ACCESS_READ_TOKEN | Optional HTTPS GET check |

The private context directory contains `AGENTS.md` and `methods/*.md` files.
The target provider uses the OpenAI-compatible LiteLLM endpoint.
The optional read check requires `EVAL_ACCESS_LIVE=1`.

The endpoint, model, index, and credentials have no committed values or
internal defaults. Supply provider variables through the runtime environment;
keep credentials in the runtime secret store instead of a local .env file.
Do not add private context files to this repository.

### 3. Fixture load

The SPL fixture contains 12 synthetic events. Create an isolated fixture index,
then load the newline-delimited events once through the HEC event endpoint:

```bash
curl --fail --silent --show-error \
  "${SPLUNK_HEC_URL%/}/services/collector/event?index=$SPLUNK_INDEX" \
  --header "Authorization: Splunk $SPLUNK_HEC_TOKEN" \
  --header "Content-Type: application/json" \
  --data-binary @fixtures/splunk/events.jsonl
```

Set the frozen time bounds to cover the fixture timestamps. The SPL assertion
first calls search/v2/parser with parse_only=true, then runs a read-only export
query against the configured fixture index.

### 4. Scoring

| Suite | Scoring |
| --- | --- |
| spl | Parser check and normalized result-set precision, recall, and F1 |
| tool-queries | Function choice, argument shape, mock schema, and refusals |
| agentic | Ordered calls and arguments with prior synthetic tool results |
| triage | Local JSON facts plus LiteLLM llm-rubric judge |
| homelab-access | Context helper, tier, credential safety, refusal |

Tool-query and agentic functions are local read-only schemas; they do not call
live services. Homelab access live checks are optional and perform HTTPS GET
only. The normal commands do not enable them.

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
