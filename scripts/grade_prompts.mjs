#!/usr/bin/env node
// Prompt-quality meta-eval: grade the PROMPT TEXT itself (not its outputs)
// against best-practices rubrics, with two independent judge models. This
// answers "which prompt is best-engineered?" separately from "which prompt
// produces the best answers?" (that is the promptfoo output eval).
//
// Usage:
//   OPENROUTER_API_KEY=... node scripts/grade_prompts.mjs \
//     --dir variants/logmon \
//     --judges anthropic/claude-haiku-4.5,google/gemini-3-flash-preview \
//     --out output/prompt_quality.json
//
// Two judges = cross-validation: where they disagree by a wide margin, the
// rubric (or the prompt) is ambiguous and a human should look. Requires
// OPENROUTER_API_KEY in the environment (never written to disk).

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]),
);
const DIR = args.dir || "variants/logmon";
const JUDGES = (args.judges || "anthropic/claude-haiku-4.5,google/gemini-3-flash-preview").split(",");
const OUT = args.out || "output/prompt_quality.json";
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

// Strip leading YAML frontmatter, same rule as prompts/load_okf.py.
const strip = (t) => t.replace(/^﻿?---[ \t]*\n[\s\S]*?\n---[ \t]*\n/, "").replace(/^\n+/, "");

const DIMENSIONS = [
  ["role_clarity", "Crisp role/identity and who the agent is."],
  ["scope_boundaries", "Clear scope: what it does and does not do."],
  ["anti_fabrication", "Explicit discipline against inventing facts/figures; asks for missing inputs."],
  ["output_formatting", "Specifies sensible default output formatting (code fences, brevity, when to show alternatives)."],
  ["opus48_practices", "Follows Anthropic Opus-4.8 best practices: clear structure (XML tags ok), explicit positive instructions, worked example(s), no contradictions."],
  ["dual_mode", "Concrete behavior for BOTH runnable-code tasks and hard conceptual Q&A."],
];

const RUBRIC = `You are a strict senior prompt engineer grading a SYSTEM PROMPT that will run on Claude Opus 4.8 for a Cribl/Splunk/OCSF enterprise log-monitoring expert agent named "Hermes". Score ONLY the prompt's engineering quality, not any answer it might produce. Score each dimension 0-10 (10 = exemplary). Be discerning: reserve 9-10 for genuinely excellent, use the full range, penalize padding and vagueness.

Dimensions:
${DIMENSIONS.map(([k, d]) => `- ${k}: ${d}`).join("\n")}

Return ONLY strict minified JSON: {"role_clarity":N,"scope_boundaries":N,"anti_fabrication":N,"output_formatting":N,"opus48_practices":N,"dual_mode":N,"note":"<=15 words"}`;

async function judge(model, promptText) {
  const body = {
    model, temperature: 0, max_tokens: 400,
    messages: [
      { role: "system", content: RUBRIC },
      { role: "user", content: "PROMPT TO GRADE:\n\n" + promptText },
    ],
  };
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  const txt = j.choices?.[0]?.message?.content || "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`no JSON from ${model}: ${txt.slice(0, 120)}`);
  return JSON.parse(m[0]);
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
const rows = [];
for (const f of files) {
  const name = basename(f, ".md");
  const text = strip(readFileSync(join(DIR, f), "utf8"));
  const perJudge = [];
  for (const model of JUDGES) {
    try { perJudge.push({ model, scores: await judge(model, text) }); }
    catch (e) { console.error(`  ${name} <- ${model}: ${e.message}`); }
  }
  // Average each dimension across judges; overall = mean of dimensions.
  const avg = {};
  for (const [k] of DIMENSIONS) {
    const vals = perJudge.map((p) => Number(p.scores[k])).filter((n) => !Number.isNaN(n));
    avg[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  const dims = Object.values(avg).filter((n) => n != null);
  const overall = dims.length ? dims.reduce((a, b) => a + b, 0) / dims.length : null;
  // Judge disagreement: max spread on the overall-ish dimension opus48_practices.
  const spread = (() => {
    const vals = perJudge.map((p) => Number(p.scores.opus48_practices)).filter((n) => !Number.isNaN(n));
    return vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
  })();
  rows.push({ name, overall, avg, spread, perJudge, words: text.split(/\s+/).length });
  console.error(`graded ${name}: ${overall?.toFixed(1)} (judge spread ${spread})`);
}

rows.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
writeFileSync(OUT, JSON.stringify({ judges: JUDGES, rows }, null, 2));

// Markdown scoreboard to stdout.
const cols = DIMENSIONS.map(([k]) => k);
console.log(`\n# Prompt-quality meta-eval (judges: ${JUDGES.join(", ")})\n`);
console.log(`| prompt | overall | ${cols.join(" | ")} | words | judge spread |`);
console.log(`| --- | ---: | ${cols.map(() => "---:").join(" | ")} | ---: | ---: |`);
for (const r of rows) {
  const cells = cols.map((k) => (r.avg[k] == null ? "?" : r.avg[k].toFixed(1)));
  const flag = r.spread >= 3 ? ` ⚠️${r.spread}` : r.spread;
  console.log(`| ${r.name} | ${r.overall?.toFixed(1) ?? "?"} | ${cells.join(" | ")} | ${r.words} | ${flag} |`);
}
console.log(`\n⚠️ = judges disagreed by ≥3 on opus48_practices — rubric/prompt ambiguous, human review warranted.`);
