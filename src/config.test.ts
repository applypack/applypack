import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigSchema } from './config';

const MINIMAL = { DATABASE_URL: 'postgresql://u@localhost:5432/db' };

test('a bare DATABASE_URL is enough to boot', () => {
  const r = ConfigSchema.safeParse(MINIMAL);
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.equal(r.data.AI_PROVIDER, 'anthropic_api');
  assert.equal(r.data.WEB_PORT, 4747);
});

test('a missing engine credential does not fail the process', () => {
  // The dashboard is where the credential gets fixed, so it has to start.
  // /settings reports the unusable engine; the provider factory throws only
  // when that engine is actually selected (ADR 0013/0014).
  const r = ConfigSchema.safeParse({ ...MINIMAL, AI_PROVIDER: 'anthropic_api', ANTHROPIC_API_KEY: '' });
  assert.ok(r.success, 'an empty ANTHROPIC_API_KEY must not be a config error');
});

test('DATABASE_URL is the one thing genuinely required', () => {
  const r = ConfigSchema.safeParse({});
  assert.equal(r.success, false);
  assert.ok(r.error?.issues.some((i) => i.path[0] === 'DATABASE_URL'));
});

test('the shipped bind default is loopback, not every interface', () => {
  // .env.example must not put an unauthenticated dashboard on the LAN;
  // docker-compose overrides WEB_HOST to 0.0.0.0 inside the container.
  assert.equal(ConfigSchema.safeParse(MINIMAL).data?.WEB_HOST, '127.0.0.1');
});

test('rejects an out-of-range concurrency and an unknown provider', () => {
  assert.equal(ConfigSchema.safeParse({ ...MINIMAL, AI_CONCURRENCY: '99' }).success, false);
  assert.equal(ConfigSchema.safeParse({ ...MINIMAL, AI_PROVIDER: 'nope' }).success, false);
});
