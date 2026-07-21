// Rank tool-calling-gate models by metric pass-rate.
// Usage: node rank.mjs output/tool-gate.json
//
// Reads a promptfoo results JSON and tallies pass/total per (model, metric) from
// each row's gradingResult.componentResults, where every assertion carries a
// `metric` tag (valid_call, correct_selection, refusal, incorporation,
// output_contract). Prints a GitHub-viewable ranked table plus per-case failures.
// Primary ranking key: correct_selection rate, then valid_call rate.
import fs from 'node:fs';

const file = process.argv[2] || 'output/tool-gate.json';
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const results = raw.results || raw;
const rows = results.results || [];

const label = (o) => (o && (o.label || o.id)) || (typeof o === 'string' ? o : '?');
const METRICS = ['valid_call', 'correct_selection', 'refusal', 'incorporation', 'output_contract'];

// model -> metric -> {pass,total}; plus overall case pass/total.
const agg = {};
const fails = [];
for (const r of rows) {
  const model = label(r.provider);
  agg[model] = agg[model] || { overall: { p: 0, t: 0 }, m: {} };
  agg[model].overall.t += 1;
  if (r.success) agg[model].overall.p += 1;
  else fails.push(`${model} — ${(r.testCase?.description || r.description || r.vars?.input || '').slice(0, 80)}`);

  const comps = (r.gradingResult && r.gradingResult.componentResults) || [];
  for (const c of comps) {
    const metric = c.assertion && c.assertion.metric;
    if (!metric) continue;
    const b = (agg[model].m[metric] = agg[model].m[metric] || { p: 0, t: 0 });
    b.t += 1;
    if (c.pass) b.p += 1;
  }
}

const pct = (b) => (b && b.t ? `${((100 * b.p) / b.t).toFixed(0)}% (${b.p}/${b.t})` : '—');
const rateNum = (b) => (b && b.t ? b.p / b.t : -1);

const models = Object.keys(agg).sort((a, z) => {
  const A = agg[a].m, Z = agg[z].m;
  return (
    rateNum(Z.correct_selection) - rateNum(A.correct_selection) ||
    rateNum(Z.valid_call) - rateNum(A.valid_call) ||
    agg[z].overall.p - agg[a].overall.p
  );
});

const out = ['# Hermes tool-calling gate — ranked results', ''];
out.push('| rank | model | valid_call | correct_selection | refusal | incorporation | output_contract | overall |');
out.push('| ---: | --- | --- | --- | --- | --- | --- | --- |');
models.forEach((mdl, i) => {
  const a = agg[mdl];
  out.push(
    `| ${i + 1} | ${mdl} | ${pct(a.m.valid_call)} | ${pct(a.m.correct_selection)} | ${pct(a.m.refusal)} | ${pct(a.m.incorporation)} | ${pct(a.m.output_contract)} | ${pct(a.overall)} |`,
  );
});

if (fails.length) {
  out.push('', '## Failing cases', '');
  for (const f of fails) out.push(`- ${f}`);
}
out.push('', `_Metrics: valid_call = emitted a well-formed tool call; correct_selection = right tool + required args; refusal = declined to fabricate; incorporation = used a prior tool result; output_contract = obeyed exact format. Ranked by correct_selection then valid_call._`);
console.log(out.join('\n'));
