import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCooldownTracker } from './ai-cooldown';

describe('createCooldownTracker', () => {
  it('blocks only after the failure threshold', () => {
    let clock = 1_000;
    const t = createCooldownTracker({ threshold: 3, cooldownMs: 60_000, now: () => clock });
    t.failure('claude_code');
    t.failure('claude_code');
    assert.equal(t.blockedUntil('claude_code'), null);
    t.failure('claude_code');
    assert.equal(t.blockedUntil('claude_code'), 61_000);
    clock = 61_001;
    assert.equal(t.blockedUntil('claude_code'), null);
  });

  it('a success resets the consecutive-failure count', () => {
    const t = createCooldownTracker({ threshold: 2, cooldownMs: 60_000, now: () => 0 });
    t.failure('gemini_cli');
    t.success('gemini_cli');
    t.failure('gemini_cli');
    assert.equal(t.blockedUntil('gemini_cli'), null);
  });

  it('tracks engines independently', () => {
    const t = createCooldownTracker({ threshold: 1, cooldownMs: 10, now: () => 5 });
    t.failure('openai_api');
    assert.equal(t.blockedUntil('openai_api'), 15);
    assert.equal(t.blockedUntil('claude_code'), null);
  });

  it('extends the block while failures keep coming', () => {
    let clock = 0;
    const t = createCooldownTracker({ threshold: 1, cooldownMs: 100, now: () => clock });
    t.failure('codex_cli');
    clock = 50;
    t.failure('codex_cli');
    assert.equal(t.blockedUntil('codex_cli'), 150);
  });
});
