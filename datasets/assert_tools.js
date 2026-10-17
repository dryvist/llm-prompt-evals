// Tool-call assertion for the ported mlx-benchmarks tool_call probes.
//
// One function drives both banks, keyed off the test's vars:
//   - expect_no_call: true            -> NEGATIVE. Any tool call is a fabrication -> FAIL.
//   - expect_tool + expect_required   -> POSITIVE. The named tool must be called
//                                        with every required arg present.
//
// promptfoo represents a model's tool call differently across providers and
// versions (a JSON string of OpenAI tool_calls, an object with .tool_calls, an
// array of Anthropic content blocks, or plain refusal text). extractCalls
// normalizes all of those so the negative-bank guarantee holds everywhere:
// plain text (a correct refusal) yields zero calls and passes the negative case.

function extractCalls(output) {
  if (output == null) return [];
  if (Array.isArray(output)) return output.filter((c) => callName(c));
  if (typeof output === 'object') {
    if (Array.isArray(output.tool_calls)) return output.tool_calls;
    if (Array.isArray(output.content))
      return output.content.filter((b) => b && b.type === 'tool_use');
    if (callName(output)) return [output];
    return [];
  }
  if (typeof output === 'string') {
    const s = output.trim();
    if (s.startsWith('[') || s.startsWith('{')) {
      try {
        return extractCalls(JSON.parse(s));
      } catch (e) {
        return [];
      }
    }
    return []; // plain text -> no tool call
  }
  return [];
}

function callName(c) {
  return (c && ((c.function && c.function.name) || c.name)) || '';
}

function callArgs(c) {
  let a = (c && ((c.function && c.function.arguments) || c.arguments || c.input)) || {};
  if (typeof a === 'string') {
    try {
      a = JSON.parse(a);
    } catch (e) {
      a = {};
    }
  }
  return a || {};
}

module.exports = (output, context) => {
  const v = (context && context.vars) || {};
  const calls = extractCalls(output);
  const names = calls.map(callName).filter(Boolean);

  if (v.expect_no_call) {
    return calls.length === 0
      ? { pass: true, score: 1, reason: 'no tool call — correct refusal' }
      : {
          pass: false,
          score: 0,
          reason: `fabricated tool call(s): ${names.join(', ') || 'unnamed'}`,
        };
  }

  const want = v.expect_tool;
  const call = calls.find((c) => callName(c) === want);
  if (!call) {
    return {
      pass: false,
      score: 0,
      reason: `expected a ${want} call, got: ${names.join(', ') || 'no call'}`,
    };
  }
  const args = callArgs(call);
  // promptfoo expands a list-valued var into separate cases, so expect_required
  // arrives as a scalar string (or comma-separated list), not an array.
  let required = v.expect_required || [];
  if (typeof required === 'string') required = required.split(',').map((s) => s.trim()).filter(Boolean);
  for (const req of required) {
    if (args[req] == null || String(args[req]).length === 0) {
      return { pass: false, score: 0, reason: `${want} call missing required arg '${req}'` };
    }
  }
  return { pass: true, score: 1, reason: `called ${want} with required args present` };
};

module.exports.gradeDomainToolUse = (output, context) => {
  const vars = context?.vars ?? {};
  const parsed = parseJson(output);
  const providerResponse = context?.providerResponse ?? {};
  const metadata = parsed?.metadata ?? providerResponse.metadata ?? context?.metadata ?? {};
  const toolCalls = metadata.toolCalls ?? parsed?.toolCalls;
  const rawOutput = parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'output')
    ? parsed.output
    : output;
  const calls = extractCalls(
    extractCalls(toolCalls).length > 0 ? toolCalls : rawOutput,
  );
  const text = outputText(rawOutput, providerResponse.output);
  const sequence = Array.isArray(vars.expected_sequence) ? vars.expected_sequence : null;
  const priorCount = sequence ? (vars.prior_calls ?? []).length : 0;
  const expected = sequence ? sequence.slice(priorCount) : (vars.expected_calls ?? []);
  const isMcp = Object.hasOwn(vars, 'expected_answer') || calls.some((call) =>
    Object.hasOwn(call, 'is_error'));

  if (vars.expected_refusal || vars.expected_no_tool_call) {
    const noCallScore = calls.length === 0 ? 1 : 0;
    const normalizedText = normalizeText(text);
    const refusalScore = (vars.refusal_markers ?? []).some((marker) =>
      normalizedText.includes(normalizeText(marker))) ? 1 : 0;
    const score = calls.length === 0 ? 0.7 * noCallScore + 0.3 * refusalScore : 0;
    return {
      pass: noCallScore === 1 && refusalScore === 1,
      score,
      reason: calls.length > 0
        ? 'Refusal case made an unexpected tool call'
        : refusalScore === 1
          ? 'No tool call and a refusal marker is present'
          : 'No tool call, but no expected refusal marker is present',
      namedScores: { no_tool_call: noCallScore, refusal_marker: refusalScore },
    };
  }

  if (expected.length === 0) {
    return { pass: false, score: 0, reason: 'No expected tool call is defined' };
  }

  const countScore = calls.length === expected.length ? 1 : 0;
  const nameScores = expected.map((item, index) =>
    calls[index] && callName(calls[index]) === item.name ? 1 : 0);
  const argumentScores = expected.map((item, index) =>
    calls[index] ? subsetScore(callArgs(calls[index]), item.arguments ?? {}) : 0);
  const executionScores = expected.map((item, index) =>
    calls[index] && toolSucceeded(calls[index]) ? 1 : 0);
  const nameScore = average(nameScores);
  const argumentScore = average(argumentScores);
  const executionScore = average(executionScores);
  const weightedParts = [
    [countScore, 0.1],
    [nameScore, 0.25],
    [argumentScore, 0.4],
  ];
  if (isMcp) weightedParts.push([executionScore, 0.25]);
  const score = weightedParts.reduce((sum, [value, weight]) => sum + value * weight, 0) /
    weightedParts.reduce((sum, [, weight]) => sum + weight, 0);
  const pass = countScore === 1 && nameScore === 1 && argumentScore === 1 &&
    (!isMcp || executionScore === 1);

  return {
    pass,
    score,
    reason: [
      `tool count ${calls.length}/${expected.length}`,
      `tool names ${nameScores.filter(Boolean).length}/${expected.length}`,
      `argument fields ${argumentScores.map((value) => Math.round(value * 100)).join(',')}`,
      ...(isMcp ? [`successful tools ${executionScores.filter(Boolean).length}/${expected.length}`] : []),
    ].join('; '),
    namedScores: {
      call_count: countScore,
      tool_name: nameScore,
      arguments: argumentScore,
      ...(isMcp ? { tool_execution: executionScore } : {}),
    },
  };
};

function parseJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function outputText(output, responseOutput) {
  if (typeof output === 'string') return output;
  if (typeof responseOutput === 'string') return responseOutput;
  return '';
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function subsetScore(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length
      ? average(expected.map((item, index) => subsetScore(actual[index], item)))
      : 0;
  }
  if (expected == null || typeof expected !== 'object') return actual === expected ? 1 : 0;
  const scores = [];
  for (const [key, value] of Object.entries(expected)) {
    if (key.endsWith('_contains')) {
      const actualValue = actual?.[key.slice(0, -9)];
      const terms = Array.isArray(value) ? value : [value];
      scores.push(...terms.map((term) =>
        normalizeText(actualValue).includes(normalizeText(term)) ? 1 : 0));
    } else if (value && typeof value === 'object') {
      scores.push(subsetScore(actual?.[key], value));
    } else {
      scores.push(Object.hasOwn(actual ?? {}, key) && actual[key] === value ? 1 : 0);
    }
  }
  return average(scores);
}

function toolSucceeded(call) {
  if (call?.is_error === true) return false;
  const payload = parseJson(call?.output ?? '');
  const texts = Array.isArray(payload)
    ? payload.map((item) => item?.text ?? '')
    : [String(payload)];
  return !texts.some((value) =>
    /\b(?:ENOENT|EACCES|EPERM|ECONNREFUSED)\b|\bError\s*-\s*(?:ENOENT|EACCES|EPERM)\b/i.test(value));
}
