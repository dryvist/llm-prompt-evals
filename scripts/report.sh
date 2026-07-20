#!/usr/bin/env bash
# Standard eval + publish flow for llm-prompt-evals.
#
# Runs the output eval, the prompt-quality meta-eval, and the cost/subscription
# report; assembles a GitHub-viewable results/ report; and (if a promptfoo token
# is present) publishes the interactive report to promptfoo Cloud.
#
# Run inside the dev shell, with model keys in the environment (e.g. via doppler):
#   doppler run -p ai-ci-automation -c prd -- ./scripts/report.sh [config] [-- extra promptfoo args]
#
# promptfoo Cloud publishing uses PROMPTFOO_API_KEY (falls back to the dryvist
# org secret name PROMPTFOO_API_TOKEN). If neither is set, that step is skipped.
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

# 5. Publish interactive report to promptfoo Cloud
export PROMPTFOO_API_KEY="${PROMPTFOO_API_KEY:-${PROMPTFOO_API_TOKEN:-}}"
SHARE_URL=""
if [ -n "$PROMPTFOO_API_KEY" ]; then
  SHARE_URL=$(promptfoo share --yes 2>/dev/null | grep -oE 'https?://[^ ]+' | tail -1 || true)
  [ -n "$SHARE_URL" ] && echo "promptfoo Cloud: $SHARE_URL"
else
  echo "PROMPTFOO_API_KEY / PROMPTFOO_API_TOKEN not set — skipping promptfoo Cloud share."
fi

# 6. Assemble GitHub-viewable results/
cp -f output/latest.html results/report.html
node scripts/build_results.mjs \
  --main output/latest.json \
  --quality output/prompt_quality.json \
  --cost output/cost.json \
  ${SHARE_URL:+--share "$SHARE_URL"} \
  --out results/README.md

echo
echo "Results: results/README.md (commit to publish on GitHub). Local HTML: results/report.html."
