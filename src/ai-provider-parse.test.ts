import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANTHROPIC_THINKING_HEADROOM_TOKENS,
  anthropicMaxTokens,
  buildClaudeCodeArgs,
  buildCliEnv,
  buildCodexCliArgs,
  buildGeminiCliArgs,
  CLI_PROVIDER_ENV_KEYS,
  CLI_THINKING_CAP_ENV,
  cliThinkingCap,
  describeAiFailure,
  parseClaudeCodeOutput,
  parseCodexCliOutput,
  parseGeminiCliOutput,
  parseOpenAiChatResponse,
} from './ai-provider-parse';
import { SCAN_MAX_TOKENS } from './resume/prompts';

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

test('codex JSONL: last agent message wins, both event shapes covered', () => {
  const modern = [
    '{"type":"thread.started","thread_id":"t1"}',
    'non-json noise',
    '{"type":"item.completed","item":{"id":"i1","type":"reasoning","text":"thinking"}}',
    '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"draft"}}',
    '{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":"{\\"ok\\":true}"}}',
    '{"type":"turn.completed","usage":{"input_tokens":10}}',
  ].join('\n');
  const out = parseCodexCliOutput(modern);
  assert.equal(out.error, null);
  assert.match(out.text ?? '', /"ok":true/);

  const legacy = '{"id":"0","msg":{"type":"agent_message","message":"hi"}}';
  assert.equal(parseCodexCliOutput(legacy).text, 'hi');
});

test('codex errors surface and rate limits are flagged', () => {
  const limited = parseCodexCliOutput('{"type":"error","message":"You have hit your usage limit."}');
  assert.equal(limited.text, null);
  assert.equal(limited.rateLimited, true);

  const plain = parseCodexCliOutput('{"type":"turn.failed","message":"model not found"}');
  assert.equal(plain.rateLimited, false);
  assert.match(plain.error ?? '', /model not found/);

  assert.match(parseCodexCliOutput('garbage only').error ?? '', /no agent message/);
});

test('buildCodexCliArgs: read-only sandbox, optional model and search', () => {
  const base = { system: 'S', user: 'U', model: '' };
  const plain = buildCodexCliArgs(base);
  assert.deepEqual(plain, [
    'exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', 'S\n\nU',
  ]);
  const full = buildCodexCliArgs({ ...base, model: 'gpt-5.1', webTools: true });
  assert.ok(full.includes('--model') && full.includes('gpt-5.1') && full.includes('--search'));
});

test('openai chat response: content, error envelope, rate limit', () => {
  const ok = parseOpenAiChatResponse(
    JSON.stringify({ choices: [{ message: { content: '{"relevant":true}' } }] }),
  );
  assert.match(ok.text ?? '', /"relevant":true/);

  const quota = parseOpenAiChatResponse(
    JSON.stringify({ error: { message: 'Rate limit reached for gpt-5-mini' } }),
  );
  assert.equal(quota.text, null);
  assert.equal(quota.rateLimited, true);

  const empty = parseOpenAiChatResponse(JSON.stringify({ choices: [{ message: { content: null } }] }));
  assert.match(empty.error ?? '', /empty completion/);
  assert.match(parseOpenAiChatResponse('<html>').error ?? '', /not JSON/);
});

test('buildCliEnv: base keys + own provider vars only', () => {
  const source = {
    PATH: '/usr/bin',
    HOME: '/Users/x',
    DATABASE_URL: 'postgres://secret',
    TELEGRAM_BOT_TOKEN: 'tg-secret',
    ANTHROPIC_API_KEY: 'sk-ant-secret',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
    GEMINI_API_KEY: 'gm-key',
    OPENAI_API_KEY: 'sk-openai',
  };
  const claude = buildCliEnv(CLI_PROVIDER_ENV_KEYS.claude_code ?? [], source);
  assert.equal(claude.PATH, '/usr/bin');
  assert.equal(claude.CLAUDE_CODE_OAUTH_TOKEN, 'oauth-token');
  // Precedence trap: the key must NEVER reach the claude_code child, or the
  // CLI silently bills the API instead of the subscription.
  assert.equal(claude.ANTHROPIC_API_KEY, undefined);
  assert.equal(claude.DATABASE_URL, undefined);
  assert.equal(claude.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(claude.GEMINI_API_KEY, undefined);

  const gemini = buildCliEnv(CLI_PROVIDER_ENV_KEYS.gemini_cli ?? [], source);
  assert.equal(gemini.GEMINI_API_KEY, 'gm-key');
  assert.equal(gemini.OPENAI_API_KEY, undefined);
  assert.equal(gemini.CLAUDE_CODE_OAUTH_TOKEN, undefined);

  const codex = buildCliEnv(CLI_PROVIDER_ENV_KEYS.codex_cli ?? [], source);
  assert.equal(codex.OPENAI_API_KEY, 'sk-openai');
  assert.equal(codex.GEMINI_API_KEY, undefined);
});

test('buildCliEnv skips unset keys instead of writing undefined', () => {
  const env = buildCliEnv(['GEMINI_API_KEY'], { PATH: '/bin' });
  assert.deepEqual(Object.keys(env), ['PATH']);
});

test('gemini args omit --model when empty (CLI default)', () => {
  const args = buildGeminiCliArgs({ system: 'S', user: 'U', model: '' });
  assert.ok(!args.includes('--model'));
});

test('buildClaudeCodeArgs disables tools by default and allow-lists web tools on request', () => {
  const base = { system: 'S', user: 'U', model: 'claude-x' };
  const plain = buildClaudeCodeArgs(base);
  assert.deepEqual(plain.slice(-5), ['--tools', '', '--no-session-persistence', '--', 'U']);
  assert.ok(plain.includes('--print') && plain.includes('claude-x') && plain.includes('S'));

  const web = buildClaudeCodeArgs({ ...base, webTools: true });
  assert.deepEqual(web.slice(-7), [
    '--tools', 'WebSearch,WebFetch',
    '--allowedTools', 'WebSearch,WebFetch',
    '--no-session-persistence', '--', 'U',
  ]);
});

test('option parsing ends before the prompt, which carries untrusted text', () => {
  // Measured: without "--" the CLI answers `error: unknown option '--- …'`.
  const args = buildClaudeCodeArgs({ system: 'S', user: '--anything-at-all', model: 'm' });
  assert.equal(args.at(-1), '--anything-at-all');
  assert.equal(args.at(-2), '--');
});

test('describeAiFailure keeps the API sentence on one line, without its full stop', () => {
  const out = describeAiFailure('Your credit balance is too low\n  to access the API.');
  assert.equal(out, 'Your credit balance is too low to access the API');
});

test('describeAiFailure masks anything key-shaped', () => {
  const out = describeAiFailure('auth failed for sk-ant-api03-abcdefghijklmnop and AIzaSyABCDEFGHIJ');
  assert.doesNotMatch(out, /sk-ant-api03-abcdefghijklmnop|AIzaSyABCDEFGHIJ/);
  assert.match(out, /\*\*\*mnop/);
});

test('describeAiFailure caps a runaway stderr dump', () => {
  const out = describeAiFailure('x'.repeat(5_000));
  assert.ok(out.length <= 201, `length was ${out.length}`);
  assert.ok(out.endsWith('…'));
});

test('describeAiFailure never renders an empty message', () => {
  assert.equal(describeAiFailure('   \n  '), 'no reason reported');
});

test('anthropicMaxTokens adds the thinking headroom to the answer budget', () => {
  assert.equal(anthropicMaxTokens(8_000), 8_000 + ANTHROPIC_THINKING_HEADROOM_TOKENS);
});

test('the largest answer budget keeps its full headroom under the SDK non-streaming cap', () => {
  assert.equal(anthropicMaxTokens(SCAN_MAX_TOKENS), SCAN_MAX_TOKENS + ANTHROPIC_THINKING_HEADROOM_TOKENS);
});

test('anthropicMaxTokens never asks for more than a non-streaming request may carry', () => {
  assert.ok(anthropicMaxTokens(100_000) <= 21_333);
});

test('the CLI reply keeps what the call spent — API time, output and thinking tokens, turns (#168)', () => {
  const raw = JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result: '{}',
    duration_api_ms: 33_812, num_turns: 1,
    usage: { output_tokens: 3_512, output_tokens_details: { thinking_tokens: 0 } },
  });
  assert.deepEqual(parseClaudeCodeOutput(raw).usage, { apiMs: 33_812, outputTokens: 3_512, thinkingTokens: 0, turns: 1 });
  assert.deepEqual(parseClaudeCodeOutput(ok('{}')).usage, { apiMs: undefined, outputTokens: undefined, thinkingTokens: undefined, turns: undefined });
});

test('tool-free CLI calls get the thinking cap; the verify call keeps the CLI default', () => {
  assert.deepEqual(cliThinkingCap(false), { MAX_THINKING_TOKENS: '0' });
  assert.deepEqual(cliThinkingCap(undefined), { MAX_THINKING_TOKENS: '0' });
  assert.deepEqual(cliThinkingCap(true), {});
  assert.ok(CLI_PROVIDER_ENV_KEYS.claude_code?.includes(CLI_THINKING_CAP_ENV), 'the allowlist must let the cap through');
  const env = buildCliEnv(CLI_PROVIDER_ENV_KEYS.claude_code ?? [], { PATH: '/bin', ...cliThinkingCap(false) });
  assert.equal(env.MAX_THINKING_TOKENS, '0');
});
