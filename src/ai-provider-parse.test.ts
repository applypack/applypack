import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cliFailure,
  ANTHROPIC_THINKING_HEADROOM_TOKENS,
  anthropicMaxTokens,
  buildClaudeCodeArgs,
  buildCliEnv,
  buildCodexCliArgs,
  buildGeminiCliArgs,
  buildAgyCliArgs,
  buildOllamaChatBody,
  CLAUDE_CODE_ISOLATION_ENV,
  CLI_EFFORT_ENV,
  CLI_PROVIDER_ENV_KEYS,
  CLI_THINKING_CAP_ENV,
  cliRetryable,
  cliThinkingCap,
  describeAiFailure,
  estimateTokens,
  failureKind,
  failureOutcome,
  localBudgetTokens,
  ollamaError,
  parseClaudeCodeOutput,
  parseOllamaStream,
  refusedReason,
  retryWait,
  webToolsDirectOnly,
  parseCodexCliOutput,
  parseGeminiCliOutput,
  parseAgyCliOutput,
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
    '--prompt=S\n\nU',
  ]);

  const web = buildGeminiCliArgs({ ...base, webTools: true });
  assert.ok(web.includes('google_web_search') && web.includes('web_fetch'));
  assert.equal(web[web.length - 1], '--prompt=S\n\nU');
});

test('agy success returns the response text and spend stats', () => {
  const out = parseAgyCliOutput(
    JSON.stringify({
      conversation_id: 'c123',
      status: 'SUCCESS',
      response: '{"relevant": true}\n',
      duration_seconds: 2.5,
      num_turns: 1,
      usage: { input_tokens: 100, output_tokens: 20, thinking_tokens: 15, cache_read_tokens: 10 },
    }),
  );
  assert.equal(out.error, null);
  assert.equal(out.rateLimited, false);
  assert.equal(out.text, '{"relevant": true}\n');
  assert.equal(out.usage?.apiMs, 2500);
  assert.equal(out.usage?.outputTokens, 20);
  assert.equal(out.usage?.thinkingTokens, 15);
  assert.equal(out.spend?.usage.inputTokens, 90);
  assert.equal(out.spend?.usage.cacheReadTokens, 10);
  assert.equal(out.spend?.usage.outputTokens, 20);
});

test('agy recorded reply matches schema and extracts token counts', () => {
  const recorded =
    '{"conversation_id":"62d32492-4baa-4f19-9493-ffa7191a2659","status":"SUCCESS","response":"Hello\\n","duration_seconds":2.2825957,"num_turns":1,"usage":{"input_tokens":11626,"output_tokens":76,"thinking_tokens":75,"cache_read_tokens":0,"total_tokens":11702}}';
  const out = parseAgyCliOutput(recorded);
  assert.equal(out.error, null);
  assert.equal(out.text, 'Hello\n');
  assert.equal(out.usage?.apiMs, 2283);
  assert.equal(out.usage?.outputTokens, 76);
  assert.equal(out.usage?.thinkingTokens, 75);
  assert.equal(out.spend?.usage.inputTokens, 11626);
  assert.equal(out.spend?.usage.cacheReadTokens, 0);
  assert.equal(out.spend?.usage.outputTokens, 76);
});

test('agy error and rate-limit parsing', () => {
  const quota = parseAgyCliOutput(
    JSON.stringify({ status: 'ERROR', error: 'quota exceeded: resource exhausted' }),
  );
  assert.equal(quota.text, null);
  assert.equal(quota.rateLimited, true);
  assert.match(quota.error ?? '', /quota exceeded/);

  const auth = parseAgyCliOutput(
    JSON.stringify({ status: 'ERROR', error: 'authentication failed: please run /login' }),
  );
  assert.equal(auth.outcome, 'unauthorized');
  assert.equal(auth.rateLimited, false);

  const leadingNoise = parseAgyCliOutput(
    'error: something failed\n{"status":"SUCCESS","response":"ok"}'
  );
  assert.equal(leadingNoise.text, 'ok');
});

test('buildAgyCliArgs includes flags and formats prompt', () => {
  const plain = buildAgyCliArgs({ system: 'S', user: 'U', model: 'gemini-3.8-flash-high' });
  assert.deepEqual(plain, [
    '--output-format', 'json',
    '--disable-slash-commands',
    '--model', 'gemini-3.8-flash-high',
    '--prompt=S\n\nU',
  ]);

  const defaultModel = buildAgyCliArgs({ system: 'S', user: 'U', model: '' });
  assert.deepEqual(defaultModel, [
    '--output-format', 'json',
    '--disable-slash-commands',
    '--prompt=S\n\nU',
  ]);

  const web = buildAgyCliArgs({ system: 'S', user: 'U', model: 'gemini-3.8-flash-high', webTools: true });
  assert.deepEqual(web, [
    '--output-format', 'json',
    '--disable-slash-commands',
    '--model', 'gemini-3.8-flash-high',
    '--prompt=S\n\nU',
  ]);
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
    'exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--', 'S\n\nU',
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

  const agy = buildCliEnv(CLI_PROVIDER_ENV_KEYS.agy_cli ?? [], source);
  assert.equal(agy.PATH, '/usr/bin');
  assert.equal(agy.GEMINI_API_KEY, undefined);
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

test('a prompt opening with a dash stays one value on the Gemini and Codex CLIs too (H46)', () => {
  // Measured on gemini 0.46.0: `--prompt "--- x"` exits "Not enough arguments
  // following: prompt"; `--prompt=--- x` reaches the auth check.
  const gemini = buildGeminiCliArgs({ system: '--- S', user: 'U', model: '' });
  assert.equal(gemini.at(-1), '--prompt=--- S\n\nU');
  assert.ok(!gemini.includes('--prompt'));
  // Codex's PROMPT is a clap positional without allow_hyphen_values.
  const codex = buildCodexCliArgs({ system: '--- S', user: 'U', model: '' });
  assert.deepEqual(codex.slice(-2), ['--', '--- S\n\nU']);
});

test('a refused key, a spent allowance and a busy server are three different failures (H40, H41)', () => {
  assert.equal(failureKind(401, 'invalid x-api-key'), 'auth');
  assert.equal(failureKind(403, 'permission denied'), 'auth');
  assert.equal(failureKind(null, 'Invalid API key · Please run /login'), 'auth');
  assert.equal(failureKind(null, 'Please set an Auth method in your settings.json'), 'auth');
  assert.equal(failureKind(null, 'OAuth token has expired'), 'auth');
  assert.equal(failureKind(429, 'You exceeded your current quota'), 'quota');
  assert.equal(failureKind(null, "You've hit your usage limit. Resets at 5pm."), 'quota');
  assert.equal(failureKind(429, 'Rate limit reached for requests'), 'transient');
  assert.equal(failureKind(529, 'Overloaded'), 'transient');
  assert.equal(failureKind(503, 'Service Unavailable'), 'transient');
  assert.equal(failureKind(400, 'Your credit balance is too low to access the API.'), 'other');
  assert.equal(failureKind(404, 'model not found'), 'other');
  assert.deepEqual(['auth', 'quota', 'transient', 'other'].map((k) => failureOutcome(k as never)), [
    'unauthorized',
    'rate_limited',
    'rate_limited',
    'error',
  ]);
  assert.equal(
    refusedReason('HTTP 401: invalid x-api-key', 'key'),
    'the key was refused (HTTP 401: invalid x-api-key) — paste a new one on Settings → AI & costs',
  );
});

test('one more try waits what the server asks, when that is short and the budget has room (H41)', () => {
  const now = Date.parse('2026-09-28T10:00:00Z');
  const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;
  assert.equal(retryWait(headers({}), 60_000, now), 2_000);
  assert.equal(retryWait(headers({ 'retry-after': '3' }), 60_000, now), 3_000);
  assert.equal(retryWait(headers({ 'retry-after-ms': '1500', 'retry-after': '9' }), 60_000, now), 1_500);
  assert.equal(retryWait(headers({ 'retry-after': 'Mon, 28 Sep 2026 10:00:04 GMT' }), 60_000, now), 4_000);
  // Past the cap the next engine answers sooner; with no room left the retry would only time out.
  assert.equal(retryWait(headers({ 'retry-after': '60' }), 600_000, now), null);
  assert.equal(retryWait(headers({}), 6_000, now), null);
});

test('a CLI retries a rate limit, never a spent plan or a refused sign-in', () => {
  const limited = parseClaudeCodeOutput(
    JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'API Error: 429 rate_limit_error', api_error_status: 429 }),
  );
  assert.equal(cliRetryable(limited), true);
  const spent = parseClaudeCodeOutput(
    JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: "You've hit your usage limit. Resets at 5pm." }),
  );
  assert.equal(spent.rateLimited, true);
  assert.equal(cliRetryable(spent), false);
  const refused = parseClaudeCodeOutput(
    JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Invalid API key · Please run /login', api_error_status: 401 }),
  );
  assert.equal(refused.outcome, 'unauthorized');
  assert.equal(refused.rateLimited, false);
  assert.equal(cliRetryable(refused), false);
});

test('each CLI names a refused sign-in as one', () => {
  const gemini = parseGeminiCliOutput(
    JSON.stringify({ error: { type: 'Error', message: 'Please set an Auth method in your settings.json', code: 41 } }),
  );
  assert.equal(gemini.outcome, 'unauthorized');
  assert.equal(gemini.rateLimited, false);
  const codex = parseCodexCliOutput('{"type":"error","message":"unexpected status 401 Unauthorized"}');
  assert.equal(codex.outcome, 'unauthorized');
  // The rest keep the outcome they had.
  assert.equal(parseCodexCliOutput('{"type":"error","message":"You have hit your usage limit."}').outcome, undefined);
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

test('describeAiFailure masks the shapes an OpenAI-compatible server issues', () => {
  // `openai_api` is any server that speaks /chat/completions, so the key in
  // play is whatever that server issues.
  const groq = describeAiFailure('401 from gateway: invalid key gsk_abcdefghijklmnopqrst');
  assert.doesNotMatch(groq, /gsk_abcdefghijklmnopqrst/, groq);

  const stripeShaped = describeAiFailure('rejected sk_live_abcdefghijklmnop');
  assert.doesNotMatch(stripeShaped, /sk_live_abcdefghijklmnop/, stripeShaped);

  // A gateway that echoes the request headers in its error body.
  const echoed = describeAiFailure('upstream said: {"headers":{"authorization":"Bearer abc123def456ghi789"}}');
  assert.doesNotMatch(echoed, /abc123def456ghi789/, echoed);

  // And an ordinary word is not a credential.
  assert.match(describeAiFailure('the model was overloaded, retry later'), /overloaded/);
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

test('tool-free CLI calls get the thinking cap and an effort it allows; the verify call keeps the CLI default', () => {
  const capped = { MAX_THINKING_TOKENS: '0', CLAUDE_CODE_EFFORT_LEVEL: 'high' };
  assert.deepEqual(cliThinkingCap(false), capped);
  assert.deepEqual(cliThinkingCap(undefined), capped);
  assert.deepEqual(cliThinkingCap(true), {});
  for (const key of [CLI_THINKING_CAP_ENV, CLI_EFFORT_ENV]) {
    assert.ok(CLI_PROVIDER_ENV_KEYS.claude_code?.includes(key), `the allowlist must let ${key} through`);
  }
  // The user's own effort (xhigh in ~/.claude/settings.json) is overridden, never inherited.
  const env = buildCliEnv(CLI_PROVIDER_ENV_KEYS.claude_code ?? [], { PATH: '/bin', ...cliThinkingCap(false) });
  assert.equal(env.MAX_THINKING_TOKENS, '0');
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, 'high');
});

test('every claude_code call reads no CLAUDE.md and no memory, and the allowlist lets that through', () => {
  const env = buildCliEnv(CLI_PROVIDER_ENV_KEYS.claude_code ?? [], { PATH: '/bin', ...CLAUDE_CODE_ISOLATION_ENV });
  assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
  assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
});

test('the web tools filter through code execution only where the model can call tools programmatically (#161)', () => {
  for (const m of ['claude-opus-5', 'claude-opus-4-6', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-fable-5-1']) {
    assert.equal(webToolsDirectOnly(m), false, m);
  }
  for (const m of ['claude-haiku-4-5-20251001', 'claude-haiku-4-5', 'claude-opus-4-1-20250805', 'claude-sonnet-4-5', 'gpt-5-mini']) {
    assert.equal(webToolsDirectOnly(m), true, m);
  }
});

test('cliFailure names the reason without the command line — which is the prompt', () => {
  const secret = 'Command failed: claude --system-prompt RESUME TEXT -- posting text';
  const timeout = cliFailure({ killed: true, signal: 'SIGTERM', code: null, message: secret }, 180_000);
  assert.equal(timeout.reason, 'timed out after 180 s');
  assert.deepEqual(timeout.log, { signal: 'SIGTERM' });

  const exited = cliFailure({ code: 1, message: secret, stderr: 'Not logged in. Run `claude login`.\n' }, 1);
  assert.equal(exited.reason, 'Not logged in. Run `claude login`.');
  assert.deepEqual(exited.log, { code: 1, stderr: 'Not logged in. Run `claude login`.' });

  assert.equal(cliFailure({ code: 2, message: secret }, 1).reason, 'exited with code 2');
  assert.equal(cliFailure({ code: null, signal: 'SIGKILL', killed: false, message: secret }, 1).reason, 'ended by SIGKILL');
  assert.equal(cliFailure({ code: 'ENOENT', message: secret }, 1).reason, 'not found on PATH');
  assert.equal(cliFailure({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', message: secret }, 1).reason, 'the reply exceeded the 1 MiB output cap');
  for (const f of [timeout, exited]) {
    assert.doesNotMatch(JSON.stringify(f), /RESUME TEXT|posting text/);
  }
});

test('parseOpenAiChatResponse reads finish_reason and refuses an empty completion', () => {
  const cut = parseOpenAiChatResponse(JSON.stringify({ choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }] }));
  assert.equal(cut.text, null);
  assert.match(cut.error ?? '', /cut off/);
  const filtered = parseOpenAiChatResponse(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: 'content_filter' }] }));
  assert.match(filtered.error ?? '', /declined/);
  const empty = parseOpenAiChatResponse(JSON.stringify({ choices: [{ message: { content: '   ' }, finish_reason: 'stop' }] }));
  assert.equal(empty.text, null);
  assert.match(empty.error ?? '', /empty/);
  const fine = parseOpenAiChatResponse(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' }, finish_reason: 'stop' }] }));
  assert.equal(fine.text, '{"ok":1}');
});

// ADR 0055: what a call spent, read off each engine's own output. The shapes
// are the vendors' documented ones (Claude Code's result message, Codex's
// `turn.completed`, the Gemini CLI's telemetry, the chat completions usage).

test('Claude Code: tokens, the model that answered and the CLI estimate — on success and on failure', () => {
  const result = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '{"ok":1}',
    total_cost_usd: 0.012345,
    usage: {
      input_tokens: 12,
      cache_creation_input_tokens: 4_000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 4_000 },
      cache_read_input_tokens: 9_000,
      output_tokens: 800,
      server_tool_use: { web_search_requests: 2 },
    },
    modelUsage: {
      'claude-haiku-4-5-20251001': { inputTokens: 300, outputTokens: 20, costUSD: 0.0004 },
      'claude-sonnet-5': { inputTokens: 12, outputTokens: 780, costUSD: 0.0119 },
    },
  };
  const out = parseClaudeCodeOutput(JSON.stringify(result));
  assert.deepEqual(out.spend, {
    usage: { inputTokens: 12, cacheWriteTokens: 0, cacheWrite1hTokens: 4_000, cacheReadTokens: 9_000, outputTokens: 800, webSearches: 2 },
    model: 'claude-sonnet-5',
    reportedUsd: 0.012345,
  });
  const failed = parseClaudeCodeOutput(JSON.stringify({ ...result, subtype: 'error_during_execution', is_error: true, result: 'boom' }));
  assert.equal(failed.text, null);
  assert.equal(failed.outcome, 'error');
  assert.equal(failed.spend?.usage.outputTokens, 800);
  // Without the lifetime split every write is priced as a five-minute one.
  const plain = parseClaudeCodeOutput(JSON.stringify({ ...result, usage: { input_tokens: 1, cache_creation_input_tokens: 50 } }));
  assert.equal(plain.spend?.usage.cacheWriteTokens, 50);
  assert.equal(plain.spend?.usage.cacheWrite1hTokens, null);
});

test('chat completions: the uncached input, the reasoning in output, and OpenRouter\'s own charge', () => {
  const body = {
    model: 'gpt-5-mini-2025-08-07',
    choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1_200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 1_000 }, cost: 0.00042 },
  };
  assert.deepEqual(parseOpenAiChatResponse(JSON.stringify(body)).spend, {
    usage: { inputTokens: 200, cacheWriteTokens: null, cacheWrite1hTokens: null, cacheReadTokens: 1_000, outputTokens: 300, webSearches: null },
    model: 'gpt-5-mini-2025-08-07',
    reportedUsd: 0.00042,
  });
  // A cut-off reply was billed in full.
  const cut = parseOpenAiChatResponse(JSON.stringify({ ...body, choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }] }));
  assert.equal(cut.outcome, 'cut_off');
  assert.equal(cut.spend?.usage.outputTokens, 300);
  // A server that reports no usage reports nothing, not zero.
  assert.equal(parseOpenAiChatResponse(JSON.stringify({ choices: body.choices })).spend, undefined);
});

test('Codex: the turn.completed usage from its documentation', () => {
  const out = parseCodexCliOutput(
    [
      '{"type":"thread.started"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}',
      '{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122,"reasoning_output_tokens":0}}',
    ].join('\n'),
  );
  assert.deepEqual(out.spend, {
    usage: { inputTokens: 315, cacheWriteTokens: null, cacheWrite1hTokens: null, cacheReadTokens: 24_448, outputTokens: 122, webSearches: null },
    model: null,
    reportedUsd: null,
  });
});

test('Gemini CLI: prompt minus cached, the answer plus the thinking, named for the model that answered', () => {
  const out = parseGeminiCliOutput(
    JSON.stringify({
      response: '{}',
      stats: {
        models: {
          'gemini-2.5-flash-lite': { api: { totalRequests: 1 }, tokens: { prompt: 900, candidates: 5, cached: 0, thoughts: 0 } },
          'gemini-2.5-pro': { api: { totalRequests: 1 }, tokens: { prompt: 5_000, candidates: 700, cached: 4_000, thoughts: 300, tool: 0 } },
        },
      },
    }),
  );
  assert.deepEqual(out.spend, {
    usage: { inputTokens: 1_900, cacheWriteTokens: null, cacheWrite1hTokens: null, cacheReadTokens: 4_000, outputTokens: 1_005, webSearches: null },
    model: 'gemini-2.5-pro',
    reportedUsd: null,
  });
});

test('a local call asks Ollama for its window, JSON when the caller parses it, and a stream', () => {
  const body = JSON.parse(buildOllamaChatBody({ system: 'S', user: 'U', model: 'llama3.1:8b', maxTokens: 800, contextTokens: 16_384, json: true }));
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'U' },
  ]);
  assert.equal(body.stream, true);
  assert.equal(body.format, 'json');
  assert.equal(body.options.num_ctx, 16_384);
  assert.ok(body.options.num_predict > 800, 'room past the answer for a model that thinks first');
  const plain = JSON.parse(buildOllamaChatBody({ system: 'S', user: 'U', model: 'm', maxTokens: 20, contextTokens: 8_192 }));
  assert.equal(plain.format, undefined);
});

test('the token estimate is cautious, more so for text outside Latin script', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('a'.repeat(350)), 100);
  assert.equal(estimateTokens('я'.repeat(150)), 100);
  assert.ok(localBudgetTokens('s'.repeat(3_500), 'u'.repeat(3_500), 1_000) > 3_000);
});

test("Ollama's stream: the pieces joined, the counts off the last line, a thinking block dropped", () => {
  const lines = [
    '{"model":"llama3.1:8b","created_at":"t","message":{"role":"assistant","content":"<think>let me see</think>{\\"ok\\""},"done":false}',
    '{"model":"llama3.1:8b","created_at":"t","message":{"role":"assistant","content":": true}"},"done":false}',
    '{"model":"llama3.1:8b","created_at":"t","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":1200,"eval_count":40}',
  ].join('\n');
  const out = parseOllamaStream(lines);
  assert.equal(out.text, '{"ok": true}');
  assert.equal(out.spend?.usage.inputTokens, 1200);
  assert.equal(out.spend?.usage.outputTokens, 40);
  assert.equal(out.spend?.model, 'llama3.1:8b');
});

test("Ollama's stream: a cut-off, an error line, a stream that stopped, an empty answer", () => {
  const cut = parseOllamaStream('{"message":{"content":"{\\"a\\":"},"done":true,"done_reason":"length","eval_count":900}');
  assert.equal(cut.outcome, 'cut_off');
  assert.equal(cut.text, null);
  const failed = parseOllamaStream('{"message":{"content":"x"},"done":false}\n{"error":"model requires more system memory"}');
  assert.match(failed.error ?? '', /more system memory/);
  const stopped = parseOllamaStream('{"message":{"content":"{"},"done":false}');
  assert.match(stopped.error ?? '', /stopped before it ended/);
  const empty = parseOllamaStream('{"message":{"content":"  "},"done":true,"done_reason":"stop"}');
  assert.equal(empty.outcome, 'empty');
  assert.equal(ollamaError('{"error":"model \'x\' not found"}'), "model 'x' not found");
  assert.equal(ollamaError('not json'), null);
});
