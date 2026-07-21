// valid_call metric: did the model emit at least one syntactically valid tool
// call (parseable, with a non-empty function name)? This is orthogonal to
// correct-selection (datasets/assert_tools.js) — a well-formed call to the WRONG
// tool still passes valid_call but fails correct_selection. Used only on the
// positive bank, where a tool call is the expected shape.
//
// Mirrors the normalization in datasets/assert_tools.js so the two agree on what
// counts as a call across promptfoo's provider/version output shapes.

function name(c) {
  return (c && ((c.function && c.function.name) || c.name)) || '';
}

function extract(output) {
  if (output == null) return [];
  if (Array.isArray(output)) return output.filter(name);
  if (typeof output === 'object') {
    if (Array.isArray(output.tool_calls)) return output.tool_calls;
    if (Array.isArray(output.content))
      return output.content.filter((b) => b && b.type === 'tool_use');
    return name(output) ? [output] : [];
  }
  if (typeof output === 'string') {
    const s = output.trim();
    if (s.startsWith('[') || s.startsWith('{')) {
      try {
        return extract(JSON.parse(s));
      } catch (e) {
        return [];
      }
    }
    return [];
  }
  return [];
}

module.exports = (output) => {
  const calls = extract(output).filter((c) => name(c));
  return calls.length > 0
    ? { pass: true, score: 1, reason: `emitted valid tool call: ${calls.map(name).join(', ')}` }
    : { pass: false, score: 0, reason: 'no well-formed tool call emitted' };
};
