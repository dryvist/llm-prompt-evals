#!/usr/bin/env bash
# Standard eval + publish flow for llm-prompt-evals.
#
# Runs the output eval, the prompt-quality meta-eval, and the cost/subscription
# report, then assembles a GitHub-viewable results/ report.
#
# Run inside the dev shell, with model keys in the environment (e.g. via doppler):
#   doppler run -p ai-ci-automation -c prd -- ./scripts/report.sh [config] [-- extra promptfoo args]
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p output results

CONFIG="${1:-evals/demo-logmon/promptfooconfig.yaml}"
[ "${1:-}" ] && shift || true

# 1. Output eval -> JSON + HTML
promptfoo eval --config "$CONFIG" \
  --output output/latest.json --output output/latest.html "$@"

# 2. Human-readable scoreboard
node scripts/summarize.js output/latest.json | tee output/latest.md

# 3. Prompt-quality meta-eval (grades the prompt text itself), dual-judged
PROMPT_DIR=$(grep -oE 'okf: [^ }]+/' "$CONFIG" | head -1 | sed 's/okf: //; s#/[^/]*/*$##')
node scripts/grade_prompts.mjs \
  --dir "${PROMPT_DIR:-variants/logmon}" \
  --judges anthropic/claude-haiku-4.5,google/gemini-3-flash-preview \
  --out output/prompt_quality.json || echo "meta-eval skipped (needs OPENROUTER_API_KEY)"

# 4. Cost + subscription report
node scripts/cost_report.mjs --runs output/latest.json \
  --pricing pricing.yaml --out output/cost.json || echo "cost report skipped"

# 5. Assemble GitHub-viewable results/
# No promptfoo Cloud share: `promptfoo share` needs a Cloud account, and
# "Team sharing & collaboration" is Enterprise-only (custom pricing). We stay on
# the free Community tier, so results/ + the local HTML report ARE the artifact.
cp -f output/latest.html results/report.html
node scripts/build_results.mjs \
  --main output/latest.json \
  --quality output/prompt_quality.json \
  --cost output/cost.json \
  --out results/README.md

echo
echo "Results: results/README.md (commit to publish on GitHub). Local HTML: results/report.html."
