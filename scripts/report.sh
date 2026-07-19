#!/usr/bin/env bash
# Run the hermes eval and render output/latest.{json,html} plus a markdown summary.
# Run it inside the dev shell (direnv loads promptfoo automatically).
# Extra args pass through to promptfoo, e.g.:
#   scripts/report.sh --filter-providers gpt-4o-mini
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p output

CONFIG="${PROMPTFOO_CONFIG:-evals/hermes/promptfooconfig.yaml}"

promptfoo eval \
  --config "$CONFIG" \
  --output output/latest.json \
  --output output/latest.html \
  "$@"

node scripts/summarize.js output/latest.json | tee output/latest.md

echo
echo "Open output/latest.html in a browser, or run 'promptfoo view' for the live report."
