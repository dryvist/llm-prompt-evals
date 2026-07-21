#!/usr/bin/env bash
# Run the Hermes tool-calling gate against the resident llama-swap models via the
# router, WITHOUT disturbing the 24/7 Hermes brain.
#
# Auth/topology, matching how the repo's other local runs source secrets from
# Doppler (never committed): the router base URL is derived from PROXMOX_SUBDOMAIN
# (ai-ci-automation/prd) and the bearer from LLM_ROUTER_MASTER_KEY
# (iac-conf-mgmt/prd). Both are held in shell vars only — nothing hits disk.
#
# Safety: -j 1 serializes every request (the 80B brain runs concurrencyLimit=1,
# so bursts would 429); --delay spaces them so Hermes' own traffic interleaves
# cleanly. promptfoo's OpenAI provider retries 429/5xx with backoff on top of that.
# 10 cases x 2 models = 20 requests total (10/model) — well under the 40/model cap.
set -euo pipefail
cd "$(dirname "$0")"

: "${SUB:=$(doppler secrets get PROXMOX_SUBDOMAIN -p ai-ci-automation -c prd --plain)}"
export LLM_ROUTER_BASE_URL="https://llm.${SUB}/v1"
export LLM_ROUTER_KEY="${LLM_ROUTER_KEY:-$(doppler secrets get LLM_ROUTER_MASTER_KEY -p iac-conf-mgmt -c prd --plain)}"

mkdir -p output
# promptfoo exits non-zero (100) when any case fails — expected for a gate, so
# don't let `set -e` abort before we rank. The eval JSON is the source of truth.
promptfoo eval --config promptfooconfig.yaml \
  --output output/tool-gate.json \
  -j 1 --delay "${DELAY_MS:-400}" "$@" || true

echo
node rank.mjs output/tool-gate.json | tee output/tool-gate.md
echo
echo "Ranked results: output/tool-gate.md (copy into results/tool-calling-gate.md to publish)."
