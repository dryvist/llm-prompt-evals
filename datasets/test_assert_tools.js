// Self-check for assert_tools.js. Run: node datasets/test_assert_tools.js
// Locks the negative-bank guarantee: a fabricated call must FAIL, independent
// of any live model.
const assert = require('assert');
const check = require('./assert_tools.js');

const weatherCall = '[{"type":"function","function":{"name":"get_weather","arguments":"{\\"location\\":\\"Portland\\"}"}}]';
const emptyArgsCall = '[{"type":"function","function":{"name":"get_weather","arguments":"{}"}}]';
const wrongToolCall = '[{"type":"function","function":{"name":"other","arguments":"{}"}}]';

// Negative bank: any fabricated call fails; a plain-text refusal passes.
assert.strictEqual(check(weatherCall, { vars: { expect_no_call: true } }).pass, false,
  'fabricated call must FAIL the negative case');
assert.strictEqual(check('I cannot do that — no tool fits.', { vars: { expect_no_call: true } }).pass, true,
  'a plain-text refusal passes the negative case');

// Positive bank: correct call passes; missing required arg or wrong tool fails.
assert.strictEqual(check(weatherCall, { vars: { expect_tool: 'get_weather', expect_required: 'location' } }).pass, true,
  'correct call with required arg passes');
assert.strictEqual(check(emptyArgsCall, { vars: { expect_tool: 'get_weather', expect_required: 'location' } }).pass, false,
  'missing required arg fails');
assert.strictEqual(check(wrongToolCall, { vars: { expect_tool: 'get_weather', expect_required: 'location' } }).pass, false,
  'wrong tool fails');

console.log('assert_tools self-check: 5 passed');

const grade = check.gradeDomainToolUse;
const expectedLogCall = {
  expected_calls: [{
    name: 'logs_query',
    arguments: { dialect: 'logsql', query_contains: 'error', start: '-5m' },
  }],
};
const logCall = [{
  type: 'function',
  function: {
    name: 'logs_query',
    arguments: '{"dialect":"logsql","query":"level:error","start":"-5m","limit":20}',
  },
}];
const fullScore = grade(logCall, { vars: expectedLogCall });
assert.strictEqual(fullScore.pass, true, 'matching tool calls pass');
assert.strictEqual(fullScore.score, 1, 'matching tool calls score one');
assert.strictEqual(grade(JSON.stringify({ output: logCall, metadata: { toolCalls: [] } }), {
  vars: expectedLogCall,
}).pass, true, 'saved response wrappers expose nested output calls');
const partialScore = grade([{ ...logCall[0], function: { ...logCall[0].function,
  arguments: '{"dialect":"logsql","query":"level:warning","start":"-5m"}' } }], {
  vars: expectedLogCall,
});
assert.strictEqual(partialScore.pass, false, 'incorrect query content fails');
assert(partialScore.score > 0 && partialScore.score < 1, 'incorrect query content earns partial score');

const sequenceScore = grade(logCall, {
  vars: {
    prior_calls: [{ name: 'metrics_query', arguments: { query: 'prior' } }],
    expected_sequence: [
      { name: 'metrics_query', arguments: { query: 'prior' } },
      ...expectedLogCall.expected_calls,
    ],
  },
});
assert.strictEqual(sequenceScore.pass, true, 'sequence scores only the new call after prior fixture calls');

const refusal = { vars: { expected_refusal: true, refusal_markers: ['cannot'] } };
assert.strictEqual(grade('I cannot make that change.', refusal).pass, true,
  'refusal without tool calls passes');
assert.strictEqual(grade(logCall, refusal).score, 0,
  'a fabricated call in a refusal case scores zero');

const failedMcpCall = {
  output: 'MCP Tool Error: operation failed',
  metadata: {
    toolCalls: [{
      name: 'read_text_file',
      input: { path: 'catalog.json' },
      output: 'The tool returned an error.',
      is_error: true,
    }],
  },
};
const mcpScore = grade(failedMcpCall, {
  vars: {
    expected_answer: 'catalog status',
    expected_calls: [{ name: 'read_text_file', arguments: { path_contains: 'catalog.json' } }],
  },
});
assert.strictEqual(mcpScore.pass, false, 'MCP execution failure prevents a full pass');
assert(mcpScore.score > 0 && mcpScore.score < 1, 'MCP tool selection earns partial credit despite execution failure');
const mcpTextError = { ...failedMcpCall, metadata: { toolCalls: [{
  name: 'read_text_file',
  input: { path: 'catalog.json' },
  output: '[{"type":"text","text":"ENOENT: missing file"}]',
  is_error: false,
}] } };
assert.strictEqual(grade(mcpTextError, {
  vars: {
    expected_answer: 'catalog status',
    expected_calls: [{ name: 'read_text_file', arguments: { path_contains: 'catalog.json' } }],
  },
}).pass, false, 'MCP error text prevents a full pass when is_error is false');

assert.strictEqual(grade([...logCall, ...logCall], { vars: expectedLogCall }).pass, false,
  'unexpected extra tool calls fail');
console.log('domain tool assertion self-check: 12 passed');
