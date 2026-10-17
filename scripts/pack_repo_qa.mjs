#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const suiteRoot = join(repoRoot, 'evals/repo-qa');
const generatedRoot = join(suiteRoot, '.generated');
const sourceRoot = join(generatedRoot, 'sources');
const contextRoot = join(generatedRoot, 'contexts');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exit ${result.status}`;
    throw new Error(`${command} ${args.join(' ')} failed: ${reason}`);
  }
  return result.stdout;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function ensureSources(pins) {
  mkdirSync(sourceRoot, { recursive: true });
  for (const { name, commit, visibility } of pins) {
    if (visibility !== 'PUBLIC') throw new Error(`source is not public: ${name}`);
    const checkout = join(sourceRoot, name);
    mkdirSync(checkout, { recursive: true });
    try {
      run('git', ['-C', checkout, 'rev-parse', '--git-dir']);
    } catch {
      run('git', ['-C', checkout, 'init', '-q']);
      run('git', ['-C', checkout, 'remote', 'add', 'origin', `https://github.com/dryvist/${name}.git`]);
    }
    const head = run('git', ['-C', checkout, 'rev-parse', 'HEAD']).trim();
    if (head !== commit) {
      run('git', ['-C', checkout, 'fetch', '-q', '--depth=1', 'origin', commit]);
      run('git', ['-C', checkout, 'checkout', '-q', '--detach', commit]);
    }
    if (run('git', ['-C', checkout, 'rev-parse', 'HEAD']).trim() !== commit) {
      throw new Error(`pinned revision mismatch: ${name}`);
    }
  }
}

function verifyCases(cases, pins) {
  const pinByName = new Map(pins.map((pin) => [pin.name, pin.commit]));
  const logs = [];
  const failures = [];
  for (const test of cases) {
    const meta = test.metadata;
    if (meta.commit !== pinByName.get(meta.repo)) throw new Error(`wrong source pin: ${meta.case_id}`);
    if (!Array.isArray(meta.evidence) || meta.evidence.length === 0) throw new Error(`missing evidence: ${meta.case_id}`);
    const commands = [];
    const caseFailures = [];
    for (const evidence of meta.evidence) {
      const lines = evidence.lines.split('-').map(Number);
      const file = join(sourceRoot, meta.repo, evidence.path);
      const literal = evidence.grep;
      const result = spawnSync('rg', ['--no-heading', '--no-filename', '-n', '-F', '--', literal, file], { encoding: 'utf8' });
      if (result.error || ![0, 1].includes(result.status)) {
        throw new Error(`evidence command failed: ${meta.case_id} ${evidence.path}`);
      }
      const matches = result.stdout.split('\n').filter(Boolean).map((line) => Number(line.match(/^(\d+):/)?.[1]));
      if (!matches.some((line) => line >= lines[0] && line <= lines.at(-1))) {
        caseFailures.push(evidence.path);
      }
      commands.push(`rg -n -F -- ${shellQuote(literal)} ${shellQuote(evidence.path)}`);
    }
    const status = caseFailures.length ? `FAIL (${caseFailures.join(', ')})` : 'PASS';
    if (caseFailures.length) failures.push(meta.case_id);
    logs.push(`${meta.case_id}\t${commands.join(' && ')}\t${status}`);
  }
  writeFileSync(join(generatedRoot, 'verification.log'), `${logs.join('\n')}\n`);
  if (failures.length) throw new Error(`evidence verification failed: ${failures.join(', ')}`);
}

function tokenCount(stdout) {
  const match = stdout.match(/Total Tokens:\s*([\d,]+) tokens/);
  if (!match) throw new Error('Repomix output did not include a token total');
  return Number(match[1].replaceAll(',', ''));
}

function packFocus(scopeName, repoName, patterns) {
  const focusRoot = join(generatedRoot, 'focus');
  mkdirSync(focusRoot, { recursive: true });
  const output = join(focusRoot, `${scopeName}.md`);
  const input = join(sourceRoot, repoName);
  const include = patterns.map((pattern) => pattern.startsWith(`${repoName}/`)
    ? pattern.slice(repoName.length + 1)
    : pattern);
  const args = [
    input,
    '--include', [...new Set(include)].join(','),
    '--style', 'markdown',
    '--output', output,
    '--output-show-line-numbers',
    '--verbose',
    '--no-file-summary',
    '--no-directory-structure',
    '--no-git-sort-by-changes',
  ];
  const stdout = run('repomix', args, { cwd: repoRoot });
  const logPath = join(generatedRoot, `focus-${scopeName}.log`);
  writeFileSync(logPath, stdout);
  return { path: output, tokens: tokenCount(stdout) };
}

function packGlobalDistractors(pins, patterns) {
  const inputs = pins.map(({ name }) => join(sourceRoot, name));
  const baseArgs = [
    ...inputs,
    '--include', patterns.join(','),
    '--style', 'markdown',
    '--output-show-line-numbers',
    '--no-file-summary',
    '--no-directory-structure',
    '--no-git-sort-by-changes',
  ];
  const specs = [
    { name: 'high', base: join(contextRoot, 'cross-repo-high.md'), split: '360kb', expectedParts: 3 },
    { name: 'medium', base: join(contextRoot, 'cross-repo-medium.md'), split: '40kb', expectedParts: 22 },
    { name: 'small', base: join(contextRoot, 'cross-repo-small.md'), split: '80kb', expectedParts: 13 },
  ];
  const parts = {};
  for (const spec of specs) {
    const stdout = run('repomix', [...baseArgs, '--output', spec.base, '--split-output', spec.split], { cwd: repoRoot });
    writeFileSync(join(generatedRoot, `distractors-${spec.name}.log`), stdout);
    const stem = spec.base.slice(0, -'.md'.length);
    parts[spec.name] = Array.from({ length: spec.expectedParts }, (_, index) => `${stem}.${index + 1}.md`);
    if (parts[spec.name].some((path) => !readdirSync(contextRoot).includes(path.split('/').at(-1)))) {
      throw new Error(`Repomix ${spec.name} distractor pack is missing split output`);
    }
  }
  return parts;
}

function repackContext(scopeName, sizeLabel, inputs, budget) {
  const staging = join(generatedRoot, 'staging', `${scopeName}-${sizeLabel}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const packedText = inputs.map((path) => readFileSync(path, 'utf8')).join('\n\n');
  writeFileSync(join(staging, 'context.md'), packedText);
  const output = join(contextRoot, `${scopeName}-${sizeLabel}.md`);
  const args = [
    staging,
    '--include', 'context.md',
    '--style', 'markdown',
    '--output', output,
    '--verbose',
    '--no-gitignore',
    '--no-file-summary',
    '--no-directory-structure',
    '--no-git-sort-by-changes',
  ];
  const stdout = run('repomix', args, { cwd: repoRoot });
  writeFileSync(join(generatedRoot, `context-${scopeName}-${sizeLabel}.log`), stdout);
  const tokens = tokenCount(stdout);
  if (tokens > budget) throw new Error(`${sizeLabel} context exceeds ${budget} tokens: ${scopeName} (${tokens})`);
  return { path: output, tokens };
}

function main() {
  mkdirSync(contextRoot, { recursive: true });
  const pins = readJson(join(suiteRoot, 'sources.json'));
  const scopeConfig = readJson(join(suiteRoot, 'context-scopes.json'));
  const globalDistractorPatterns = scopeConfig.__global_distractors;
  const scopes = Object.fromEntries(Object.entries(scopeConfig).filter(([key]) => !key.startsWith('__')));
  const caseFiles = readdirSync(join(repoRoot, 'datasets/repo-qa'))
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => join(repoRoot, 'datasets/repo-qa', name));
  const cases = caseFiles.flatMap(readJsonl);

  if (cases.length !== 60) throw new Error(`expected 60 cases, found ${cases.length}`);
  const kinds = cases.reduce((counts, test) => {
    counts[test.metadata.kind] = (counts[test.metadata.kind] ?? 0) + 1;
    return counts;
  }, {});
  if (kinds.lookup !== 40 || kinds.reasoning !== 20) throw new Error(`unexpected case mix: ${JSON.stringify(kinds)}`);

  ensureSources(pins);
  verifyCases(cases, pins);
  const distractors = packGlobalDistractors(pins, globalDistractorPatterns);

  const scopesByName = new Map();
  for (const test of cases) {
    const scopeName = test.metadata.scope;
    const repoName = test.metadata.repo;
    const existingRepo = scopesByName.get(scopeName);
    if (existingRepo && existingRepo !== repoName) throw new Error(`scope reused across repositories: ${scopeName}`);
    scopesByName.set(scopeName, repoName);
  }
  const usedScopes = [...scopesByName.keys()].sort();
  const contextSizes = {};
  for (const scopeName of usedScopes) {
    const focus = scopes[scopeName];
    if (!focus) throw new Error(`unknown context scope: ${scopeName}`);
    const repoName = scopesByName.get(scopeName);
    const packedFocus = packFocus(scopeName, repoName, focus);
    const lowFill = packedFocus.tokens < 6000
      ? [distractors.small[11]]
      : packedFocus.tokens < 14000
        ? [distractors.small[2]]
        : packedFocus.tokens < 19000 ? [distractors.medium[11]] : [];
    const low = repackContext(scopeName, '30k', [packedFocus.path, ...lowFill], 30000);
    const highFill = packedFocus.tokens < 15000
      ? [distractors.high[0], distractors.high[2]]
      : [distractors.high[1]];
    const high = repackContext(scopeName, '120k', [packedFocus.path, ...highFill], 122000);
    contextSizes[scopeName] = { '30k': low.tokens, '120k': high.tokens };
    if (low.tokens < 15000 || low.tokens > 30000) throw new Error(`30k context out of range: ${scopeName} (${low.tokens})`);
    if (high.tokens < 100000 || high.tokens > 122000) throw new Error(`120k context out of range: ${scopeName} (${high.tokens})`);
  }

  const expanded = [];
  for (const test of cases) {
    for (const size of ['30k', '120k']) {
      expanded.push({
        ...test,
        description: `${test.description} [${size}]`,
        vars: {
          ...test.vars,
          context: `file://.generated/contexts/${test.metadata.scope}-${size}.md`,
          context_size: size,
        },
        metadata: {
          ...test.metadata,
          context_size: size,
          context_tokens: contextSizes[test.metadata.scope][size],
          reasoning_effort: 'off',
        },
      });
    }
  }
  if (expanded.length !== 120) throw new Error(`expected 120 expanded tests, found ${expanded.length}`);
  writeFileSync(join(generatedRoot, 'cases.jsonl'), `${expanded.map((test) => JSON.stringify(test)).join('\n')}\n`);
  writeFileSync(join(generatedRoot, 'context-sizes.json'), `${JSON.stringify(contextSizes, null, 2)}\n`);

  const lowCounts = Object.values(contextSizes).map((sizes) => sizes['30k']);
  const highCounts = Object.values(contextSizes).map((sizes) => sizes['120k']);
  console.log(`repo-qa: ${cases.length} cases (${kinds.lookup} lookup, ${kinds.reasoning} reasoning); ${expanded.length} tests; 30k contexts ${Math.min(...lowCounts)}-${Math.max(...lowCounts)} tokens; 120k contexts ${Math.min(...highCounts)}-${Math.max(...highCounts)} tokens.`);
}

main();
