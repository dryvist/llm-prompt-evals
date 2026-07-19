// Render a markdown summary from a promptfoo JSON results file.
// Usage: node scripts/summarize.js output/latest.json
const fs = require('fs');

const file = process.argv[2] || 'output/latest.json';
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const results = raw.results || raw;
const rows = results.results || [];
const stats = results.stats || {};

const label = (o) => (o && (o.label || o.id)) || (typeof o === 'string' ? o : '?');
const key = (x) => `${label(x.prompt)} @ ${label(x.provider)}`;

const succ = stats.successes ?? rows.filter((x) => x.success).length;
const fail = stats.failures ?? rows.filter((x) => x.success === false).length;
const total = succ + fail || rows.length;

const out = ['# Eval summary', ''];
out.push(
  `- Total: ${total} · Pass: ${succ} · Fail: ${fail} · Pass rate: ${total ? ((100 * succ) / total).toFixed(1) : '0'}%`,
);
if (stats.tokenUsage && stats.tokenUsage.total) out.push(`- Tokens: ${stats.tokenUsage.total}`);
if (raw.shareableUrl) out.push(`- Share: ${raw.shareableUrl}`);

const agg = {};
for (const x of rows) {
  const k = key(x);
  agg[k] = agg[k] || { p: 0, f: 0 };
  agg[k][x.success ? 'p' : 'f']++;
}
out.push('', '| prompt @ provider | pass | fail |', '| --- | ---: | ---: |');
for (const k of Object.keys(agg).sort()) out.push(`| ${k} | ${agg[k].p} | ${agg[k].f} |`);

const fails = rows.filter((x) => x.success === false);
if (fails.length) {
  out.push('', '## Failures');
  for (const x of fails.slice(0, 50)) {
    const desc =
      (x.testCase && x.testCase.description) || (x.vars && x.vars.input) || '';
    out.push(`- ${key(x)} — ${String(desc).slice(0, 90).replace(/\s+/g, ' ')}`);
  }
}

console.log(out.join('\n'));
