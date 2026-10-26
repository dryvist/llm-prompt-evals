# Held-out prompt comparison

Gates a candidate prompt against a baseline prompt on Langfuse holdout items
only.

## Installation

Tooling comes from the Nix dev shell. Do not run `npm install`.

```sh
direnv allow
```

Set these in the local environment. Names are in `.env.example`.

- `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`: Langfuse
  read credentials.
- `LANGFUSE_DATASET_NAME`: the unsuffixed dataset name. The loader requests only
  `<name>-holdout`. It rejects names ending in `-train` or `-holdout`.
- `HELDOUT_BASELINE_PROMPT` and `HELDOUT_CANDIDATE_PROMPT`: prompt files.
  Index 0 is the baseline. Index 1 is the candidate.
- `OPENROUTER_API_KEY`: the provider and grader key.

## Usage

Run the comparison from the repo root:

```sh
direnv exec . sh -c '
  promptfoo eval -c evals/heldout/promptfooconfig.yaml \
    --output output/heldout.json --no-share
  status=$?
  if [ "$status" -ne 0 ] && [ "$status" -ne 100 ]; then exit "$status"; fi
  python3 evals/heldout/heldout.py compare output/heldout.json
'
```

Promptfoo exits 100 when assertions fail. The eval step accepts that code so the
compare step can score each case. Any other eval error stops the run.

The JSON output has one row per prompt, test, and provider. Each row has
`success` and `score`. The compare step averages the row scores for each prompt
over the matched test and provider pairs. It exits with:

- `0` when the candidate average is at least the baseline average.
- `1` when the candidate average is below the baseline average.
- `2` on a malformed result, an execution error, or a grader error.

## Offline smoke

These checks use promptfoo's `echo` provider. They make no model request.
Promptfoo merges prompts with identical text. The smoke candidate therefore
differs from the baseline, and both prompts pass.

The passing case:

```sh
promptfoo eval -c evals/heldout/assertion-smoke.yaml \
  --output output/heldout-smoke.json --no-share
python3 evals/heldout/heldout.py compare output/heldout-smoke.json
```

The negative control. The eval exits 100 and the compare exits 1:

```sh
promptfoo eval -c evals/heldout/assertion-negative.yaml \
  --output output/heldout-negative.json --no-share
python3 evals/heldout/heldout.py compare output/heldout-negative.json
```

The unit tests need no network:

```sh
cd evals/heldout && python3 -m unittest -v test_heldout
```

## Why a Python compare step

Promptfoo's Langfuse integration loads prompts. It has no dataset loader
[1]. So the holdout items come from the Python generator named in `tests:`.
Promptfoo supports that generator natively [2].

Promptfoo's pass-rate threshold is absolute. It comes from
`PROMPTFOO_PASS_RATE_THRESHOLD`. The eval CLI has no baseline comparison [3].
The relative gate is a small Python standard-library step.

[1]: https://www.promptfoo.dev/docs/integrations/langfuse/
[2]: https://www.promptfoo.dev/docs/configuration/test-cases/
[3]: https://www.promptfoo.dev/docs/usage/command-line/
