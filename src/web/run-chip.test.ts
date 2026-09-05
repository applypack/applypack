import { test } from 'node:test';
import assert from 'node:assert/strict';

// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const mod = import('./public/run-chip.mjs') as Promise<{
  runChip: (state: Record<string, unknown> | null, runUrl: string) => { kind: string; text: string; link: { href: string; label: string } | null } | null;
  runLive: (state: Record<string, unknown> | null) => boolean;
}>;

test('the chip follows a run: running with its seconds, ready with the result and Use it, failed with why', async () => {
  const { runChip, runLive } = await mod;
  const running = runChip({ stage: 'keywords', elapsedMs: 21_600, results: {} }, '/target/runs/x');
  assert.deepEqual(running, { kind: 'running', tone: 'text-ink-muted', text: 'AI check running · 22 s', link: { href: '/target/runs/x', label: 'progress' } });
  const done = runChip({ stage: 'done', results: { keywords: 'AI match 91/100' }, resultUrl: '/jobs/1/target?match=9' }, '/target/runs/x');
  assert.deepEqual(done, { kind: 'done', tone: 'text-ok', text: 'AI check ready: AI match 91/100', link: { href: '/jobs/1/target?match=9', label: 'Use it' } });
  assert.equal(runChip({ stage: 'error', error: 'nope' }, '/target/runs/x')?.link?.label, 'why');
  assert.equal(runChip({ gone: true }, '/target/runs/x'), null);
  assert.equal(runLive({ stage: 'keywords' }), true);
  assert.equal(runLive({ stage: 'done' }), false);
  assert.equal(runLive({ gone: true }), false);
});
