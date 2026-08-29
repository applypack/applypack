import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClaudeCodeArgs,
  buildGeminiCliArgs,
  parseClaudeCodeOutput,
  parseGeminiCliOutput,
} from './ai-provider-parse';

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

test('gemini success returns the response text', () => {
  const out = parseGeminiCliOutput(
    JSON.stringify({ response: '{"relevant": true}', stats: { models: {} } }),
  );
  assert.equal(out.error, null);
  assert.equal(out.rateLimited, false);
  assert.match(out.text ?? '', /"relevant": true/);
});

test('gemini error object is surfaced, quota flagged rateLimited', () => {
  const quota = parseGeminiCliOutput(
    JSON.stringify({ error: { type: 'ApiError', message: 'RESOURCE_EXHAUSTED: quota', code: 429 } }),
  );
  assert.equal(quota.text, null);
  assert.equal(quota.rateLimited, true);
  assert.match(quota.error ?? '', /RESOURCE_EXHAUSTED/);

  const other = parseGeminiCliOutput(
    JSON.stringify({ error: { message: 'model not found' } }),
  );
  assert.equal(other.rateLimited, false);
  assert.match(other.error ?? '', /model not found/);
});

test('gemini non-JSON and shape misses are errors, not rate-limited', () => {
  assert.match(parseGeminiCliOutput('boom').error ?? '', /not JSON/);
  const empty = parseGeminiCliOutput(JSON.stringify({ stats: {} }));
  assert.equal(empty.text, null);
  assert.equal(empty.rateLimited, false);
});

test('buildGeminiCliArgs prepends system text and gates web tools', () => {
  const base = { system: 'S', user: 'U', model: 'gemini-2.5-flash' };
  const plain = buildGeminiCliArgs(base);
  assert.deepEqual(plain, [
    '--output-format', 'json',
    '--model', 'gemini-2.5-flash',
    '--prompt', 'S\n\nU',
  ]);

  const web = buildGeminiCliArgs({ ...base, webTools: true });
  assert.ok(web.includes('google_web_search') && web.includes('web_fetch'));
  assert.equal(web[web.length - 1], 'S\n\nU');
});

test('buildClaudeCodeArgs disables tools by default and allow-lists web tools on request', () => {
  const base = { system: 'S', user: 'U', model: 'claude-x' };
  const plain = buildClaudeCodeArgs(base);
  assert.deepEqual(plain.slice(-4), ['--tools', '', '--no-session-persistence', 'U']);
  assert.ok(plain.includes('--print') && plain.includes('claude-x') && plain.includes('S'));

  const web = buildClaudeCodeArgs({ ...base, webTools: true });
  assert.deepEqual(web.slice(-6), [
    '--tools', 'WebSearch,WebFetch',
    '--allowedTools', 'WebSearch,WebFetch',
    '--no-session-persistence', 'U',
  ]);
});
