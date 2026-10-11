import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_ANSWER } from './postgres-setup';
import { MAX_RESTARTS, RESTART_WINDOW_MS, isLauncherCommand, isLauncherMessage, lockHolder, restartDecision } from './supervise';

test('a crash is retried after a delay that grows with each recent crash', () => {
  const now = 1_000_000;
  assert.deepEqual(restartDecision([], now), { restart: true, delayMs: 1_000 });
  assert.deepEqual(restartDecision([now - 5_000], now), { restart: true, delayMs: 2_000 });
  assert.deepEqual(restartDecision([now - 9_000, now - 5_000, now - 1_000], now), { restart: true, delayMs: 8_000 });
});

test('a process that keeps crashing stops the launcher instead of looping', () => {
  const now = 1_000_000;
  const often = Array.from({ length: MAX_RESTARTS }, (_, i) => now - i * 1_000);
  assert.equal(restartDecision(often, now).restart, false);
  // The same number of crashes spread over a long time is not a loop.
  const spread = Array.from({ length: MAX_RESTARTS }, (_, i) => now - RESTART_WINDOW_MS - i * 1_000);
  assert.equal(restartDecision(spread, now).restart, true);
});

test('only the two message shapes the launcher speaks are recognised', () => {
  assert.equal(isLauncherMessage({ type: 'ready' }, 'ready'), true);
  assert.equal(isLauncherMessage({ type: 'ready' }, 'shutdown'), false);
  assert.equal(isLauncherMessage('ready', 'ready'), false);
  assert.equal(isLauncherMessage(null, 'shutdown'), false);
});

test('a lock file names a live launcher only when that PID runs the launcher', () => {
  assert.equal(isLauncherCommand('node /Users/jane/applypack/dist/local/launcher.js'), true);
  assert.equal(isLauncherCommand('"C:\\Program Files\\nodejs\\node.exe" C:\\apps\\applypack\\dist\\local\\launcher.js db'), true);
  assert.equal(isLauncherCommand('/usr/bin/vim notes.txt'), false);
  assert.equal(isLauncherCommand(null), false);
});

// A Windows CI run: `npm run stop` said "ApplyPack is not running." 15.3 s after it started — the limit on the
// PowerShell look — and left the launcher running.
test('who holds the lock: no answer in time is never read as nobody', () => {
  const launcher = 'node /Users/jane/applypack/dist/local/launcher.js';
  assert.equal(lockHolder(launcher, true), 'launcher');
  // The process is gone, or the number now belongs to something else: what a killed run left.
  assert.equal(lockHolder(null, false), 'nobody');
  assert.equal(lockHolder('/usr/bin/vim notes.txt', true), 'nobody');
  // The look got nothing in time and the process is there: it may well be ApplyPack.
  assert.equal(lockHolder(NO_ANSWER, true), 'unsure');
  // The look got nothing, and no such process exists: nothing to be unsure about.
  assert.equal(lockHolder(NO_ANSWER, false), 'nobody');
});
