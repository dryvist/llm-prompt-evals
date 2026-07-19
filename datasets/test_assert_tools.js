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
