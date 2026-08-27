import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeCodeOutput } from './ai-provider-parse';

const ok = (result: string) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result });

test('success returns the result text', () => {
  const out = parseClaudeCodeOutput(ok('```json\n{"relevant": true}\n```'));
  assert.equal(out.error, null);
  assert.equal(out.rateLimited, false);
  assert.match(out.text ?? '', /"relevant": true/);
});

test('non-JSON output is an error, not rate-limited', () => {
  const out = parseClaudeCodeOutput('Segmentation fault');
  assert.equal(out.text, null);
  assert.equal(out.rateLimited, false);
  assert.match(out.error ?? '', /not JSON/);
});

test('429 api status is flagged rateLimited', () => {
  const raw = JSON.stringify({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: 'API Error: 429',
    api_error_status: 429,
  });
  const out = parseClaudeCodeOutput(raw);
  assert.equal(out.text, null);
  assert.equal(out.rateLimited, true);
});

test('usage-limit text without status is flagged rateLimited', () => {
  const raw = JSON.stringify({
    type: 'result',
    subtype: 'error',
    is_error: true,
    result: "You've hit your usage limit. Resets at 5pm.",
  });
  assert.equal(parseClaudeCodeOutput(raw).rateLimited, true);
});

test('other errors are not rate-limited', () => {
  const raw = JSON.stringify({
    type: 'result',
    subtype: 'error_max_turns',
    is_error: true,
    result: 'max turns reached',
  });
  const out = parseClaudeCodeOutput(raw);
  assert.equal(out.rateLimited, false);
  assert.match(out.error ?? '', /max turns/);
});
