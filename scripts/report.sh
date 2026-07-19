#!/usr/bin/env bash
# Run the hermes eval and render output/latest.{json,html} plus a markdown summary.
# Extra args pass through to promptfoo, e.g.:
#   scripts/report.sh --filter-providers openrouter
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p output

CONFIG="${PROMPTFOO_CONFIG:-evals/hermes/promptfooconfig.yaml}"

npx promptfoo@0.121.19 eval \
  --config "$CONFIG" \
  --output output/latest.json \
  --output output/latest.html \
  "$@"

node scripts/summarize.js output/latest.json | tee output/latest.md
