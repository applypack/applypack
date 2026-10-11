import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineTrouble, engineTroubles, TROUBLE_STREAK, type RecentAttempt } from './ai-health';

const T0 = Date.UTC(2026, 9, 11, 12);
/** Attempts of one engine, newest first, a minute apart. */
const run = (engine: string, ...outcomes: string[]): RecentAttempt[] => outcomes.map((outcome, i) => ({ engine, outcome, at: new Date(T0 - i * 60_000) }));

test('an engine that answers is not in trouble, whatever came before', () => {
  assert.equal(engineTrouble([]), null);
  assert.equal(engineTrouble(run('claude_code', 'ok', 'ok', 'ok')), null);
  // Twenty failures a week ago, and a call that got through since: it works.
  assert.equal(engineTrouble(run('claude_code', 'ok', ...Array<string>(20).fill('error'))), null);
});

test('#413: twenty refusals under a week of successes are trouble now', () => {
  const trouble = engineTrouble(run('claude_code', ...Array<string>(20).fill('unauthorized'), ...Array<string>(275).fill('ok')));
  assert.deepEqual(trouble, { engine: 'claude_code', kind: 'signin', failed: 20, since: new Date(T0 - 19 * 60_000) });
});

test('one refused sign-in is enough: the chain does not ask that engine again', () => {
  assert.equal(engineTrouble(run('anthropic_api', 'unauthorized', 'ok', 'ok'))?.kind, 'signin');
  assert.equal(engineTrouble(run('anthropic_api', 'unauthorized', 'ok', 'ok'))?.failed, 1);
});

test('anything else is a pattern from three in a row', () => {
  assert.equal(TROUBLE_STREAK, 3);
  assert.equal(engineTrouble(run('local_api', 'unreachable', 'unreachable', 'ok')), null);
  assert.equal(engineTrouble(run('local_api', 'timeout', 'ok', 'timeout', 'timeout')), null);
  assert.equal(engineTrouble(run('local_api', 'unreachable', 'unreachable', 'unreachable', 'ok'))?.kind, 'unreachable');
});

test('the kind is what the failures have in common, so the advice can differ', () => {
  const kind = (...outcomes: string[]) => engineTrouble(run('local_api', ...outcomes))?.kind;
  assert.equal(kind('unreachable', 'unreachable', 'unreachable'), 'unreachable');
  assert.equal(kind('too_large', 'too_large', 'too_large'), 'window');
  assert.equal(kind('rate_limited', 'rate_limited', 'rate_limited'), 'limited');
  // A model that writes nothing usable, a crash, a timeout: nothing more specific to say than "it fails".
  assert.equal(kind('empty', 'cut_off', 'error'), 'failing');
  assert.equal(kind('timeout', 'timeout', 'timeout'), 'failing');
  // Rows written before the two outcomes existed say `error` for a closed port too.
  assert.equal(kind('error', 'error', 'error'), 'failing');
  // Mixed: the commonest, and the newest on a tie.
  assert.equal(kind('error', 'unreachable', 'unreachable', 'unreachable'), 'unreachable');
  assert.equal(kind('too_large', 'unreachable', 'too_large', 'unreachable'), 'window');
  // A sign-in refused after other failures is still the sign-in.
  assert.equal(kind('unauthorized', 'error', 'error'), 'signin');
  // An outcome this code has never heard of is a failure like any other.
  assert.equal(kind('melted', 'melted', 'melted'), 'failing');
});

test('each engine is read on its own rows', () => {
  const rows = [...run('claude_code', 'unauthorized'), ...run('local_api', 'ok', 'error'), ...run('openai_api', 'unreachable', 'unreachable', 'unreachable')];
  assert.deepEqual(
    engineTroubles(rows).map((t) => `${t.engine}:${t.kind}:${t.failed}`),
    ['claude_code:signin:1', 'openai_api:unreachable:3'],
  );
  assert.deepEqual(engineTroubles([]), []);
});
