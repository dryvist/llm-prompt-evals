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
