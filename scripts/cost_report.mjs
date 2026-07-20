#!/usr/bin/env node
// Cost + subscription report for a promptfoo run. Answers "what did this eval
// cost, per model?" and "what would it cost on my subscriptions instead of
// OpenRouter metered?".
//
// promptfoo's OpenRouter provider does not populate a per-call cost, so we
// compute cost = tokens x live OpenRouter price. Results are often partly cached
// (cache hits report only a total, no prompt/completion split), so we extrapolate
// each provider's per-cell prompt/completion average from its LIVE cells and
// apply it to every cell — cache-robust, labelled "estimated".
//
// Usage:
//   OPENROUTER_API_KEY=... node scripts/cost_report.mjs \
//     --runs output/graderA.json,output/fable.json \
//     --pricing pricing.yaml --out output/cost.json

import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]),
);
const RUNS = (args.runs || "output/graderA.json").split(",");
const PRICING = args.pricing || "pricing.yaml";
const OUT = args.out || "output/cost.json";

// --- tiny pricing.yaml parser (prefix/plan pairs only; no yaml dep) ---
function loadSubs(path) {
  let txt = ""; try { txt = readFileSync(path, "utf8"); } catch { return []; }
  const subs = []; let cur = null;
  for (const raw of txt.split("\n")) {
    const line = raw.replace(/\s+#.*$/, ""); // strip trailing inline comments
    const p = line.match(/^\s*-\s*prefix:\s*"?([^"]+?)"?\s*$/);
    const q = line.match(/^\s*plan:\s*"?([^"]+?)"?\s*$/);
    if (p) { cur = { prefix: p[1].trim(), plan: null }; subs.push(cur); }
    else if (q && cur) { cur.plan = q[1].trim(); }
  }
  return subs;
}
const subs = loadSubs(PRICING);
const planFor = (id) => (subs.find((s) => id.startsWith(s.prefix)) || {}).plan || null;

// --- live OpenRouter pricing ($/token) ---
async function livePricing() {
  const headers = {};
  if (process.env.OPENROUTER_API_KEY) headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  const r = await fetch("https://openrouter.ai/api/v1/models", { headers });
  const j = await r.json();
  const map = {};
  for (const m of j.data || []) map[m.id] = { in: +m.pricing.prompt, out: +m.pricing.completion };
  return map;
}

// --- aggregate tokens per provider (model id), extrapolating cached cells ---
function aggregate(runs) {
  const agg = {}; // id -> {cells, liveCells, sumPrompt, sumCompletion}
  for (const f of runs) {
    let R; try { R = JSON.parse(readFileSync(f, "utf8")).results.results; } catch { continue; }
    for (const x of R) {
      const id = ((x.provider && x.provider.id) || "").replace(/^openrouter:/, "") || (x.provider && x.provider.label) || "?";
      const tu = (x.response && x.response.tokenUsage) || {};
      agg[id] = agg[id] || { cells: 0, liveCells: 0, sumPrompt: 0, sumCompletion: 0 };
      agg[id].cells++;
      if (tu.prompt != null || tu.completion != null) {
        agg[id].liveCells++;
        agg[id].sumPrompt += tu.prompt || 0;
        agg[id].sumCompletion += tu.completion || 0;
      }
    }
  }
  return agg;
}

const price = await livePricing();
const agg = aggregate(RUNS);

const rows = [];
let totalMetered = 0, totalSubEligible = 0;
for (const [id, a] of Object.entries(agg)) {
  const base = a.liveCells || 1;
  const avgP = a.sumPrompt / base, avgC = a.sumCompletion / base;
  const prompt = Math.round(avgP * a.cells), completion = Math.round(avgC * a.cells);
  const pr = price[id] || { in: 0, out: 0 };
  const cost = prompt * pr.in + completion * pr.out;
  const plan = planFor(id);
  totalMetered += cost;
  if (plan) totalSubEligible += cost;
  rows.push({ id, cells: a.cells, extrapolated: a.liveCells < a.cells, prompt, completion, cost, plan,
    priceIn: pr.in * 1e6, priceOut: pr.out * 1e6 });
}
rows.sort((x, y) => y.cost - x.cost);
writeFileSync(OUT, JSON.stringify({ runs: RUNS, rows, totalMetered, totalSubEligible }, null, 2));

// --- markdown ---
const $ = (n) => "$" + n.toFixed(n < 1 ? 4 : 2);
console.log(`\n# Cost report — ${RUNS.join(", ")}\n`);
console.log(`| model | role cells | prompt tok | completion tok | OpenRouter $/M (in/out) | metered cost | subscription |`);
console.log(`| --- | ---: | ---: | ---: | ---: | ---: | --- |`);
for (const r of rows) {
  const ex = r.extrapolated ? "*" : "";
  console.log(`| ${r.id} | ${r.cells} | ${r.prompt.toLocaleString()}${ex} | ${r.completion.toLocaleString()}${ex} | $${r.priceIn.toFixed(2)}/$${r.priceOut.toFixed(2)} | ${$(r.cost)} | ${r.plan || "— (OpenRouter only)"} |`);
}
console.log(`\n**Total metered (OpenRouter): ${$(totalMetered)}**`);
console.log(`Of which subscription-eligible (≈$0 marginal if routed via Claude/Codex/Agy plans): ${$(totalSubEligible)} → effective ${$(totalMetered - totalSubEligible)} out-of-pocket.`);
console.log(`\n\\* = token count extrapolated from live cells (run was partly cached). For exact figures run with \`--no-cache\`.`);
