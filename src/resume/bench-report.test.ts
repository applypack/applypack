import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agreementWith,
  p50,
  readBenchRun,
  renderBenchTable,
  statusAgreement,
  type BenchFixture,
  type BenchRun,
} from './bench-report';

const kw = (term: string, status: string, primary = false) => ({ term, status, requirement: 'must', primary });

const fixture = (name: string, over: Partial<BenchFixture> = {}): BenchFixture => ({
  name,
  ms: 80_000,
  chars: 6_000,
  score: 66,
  cap: null,
  keywords: [kw('Node.js', 'cannot_claim', true), kw('TypeScript', 'add'), kw('Docker', 'present')],
  actions: 5,
  removals: 2,
  failed: [],
  ...over,
});

const run = (tag: string, over: Partial<BenchRun> = {}): BenchRun => ({
  tag,
  engine: 'claude_code',
  model: 'claude-opus-5',
  mode: 'full',
  promptVersion: 5,
  at: '2026-09-02T00:00:00.000Z',
  fixtures: [fixture('a'), fixture('b', { ms: 100_000, score: 92, cap: null })],
  ...over,
});

test('statusAgreement counts shared terms by canonical spelling and their equal statuses', () => {
  const a = [kw('Node.js', 'cannot_claim'), kw('TypeScript', 'add'), kw('Docker', 'present'), kw('AWS', 'ask_user')];
  const b = [kw('node.js', 'cannot_claim'), kw('typescript', 'present'), kw('Docker', 'present'), kw('Kubernetes', 'nice')];
  const r = statusAgreement(a, b);
  assert.equal(r.shared, 3, 'Node.js, TypeScript and Docker are in both');
  assert.equal(r.agree, 2, 'TypeScript differs');
  assert.equal(r.union, 5);
});

test('statusAgreement ignores duplicate terms and handles empty lists', () => {
  assert.deepEqual(statusAgreement([], []), { shared: 0, agree: 0, union: 0 });
  const r = statusAgreement([kw('Go', 'present'), kw('go', 'add')], [kw('Go', 'present')]);
  assert.deepEqual(r, { shared: 1, agree: 1, union: 1 });
});

test('agreementWith sums over fixtures both runs completed', () => {
  const base = run('opus');
  const other = run('sonnet', {
    model: 'claude-sonnet-5',
    fixtures: [
      fixture('a', { keywords: [kw('Node.js', 'cannot_claim', true), kw('TypeScript', 'present'), kw('Docker', 'present')] }),
      fixture('b', { score: null, keywords: [] }),
      fixture('c'),
    ],
  });
  const a = agreementWith(other, base);
  assert.equal(a.shared, 3, 'only fixture a counts: b failed on one side, c is not in the baseline');
  assert.equal(a.agree, 2);
});

test('p50 is the median', () => {
  assert.equal(p50([]), 0);
  assert.equal(p50([94_000]), 94_000);
  assert.equal(p50([78, 109, 94]), 94);
  assert.equal(p50([80, 100]), 90);
});

test('readBenchRun accepts what the bench writes and rejects junk', () => {
  const r = run('x');
  assert.deepEqual(readBenchRun(JSON.parse(JSON.stringify(r))), r);
  assert.equal(readBenchRun({ tag: 'x' }), null);
  assert.equal(readBenchRun(null), null);
});

test('renderBenchTable lists every run against the baseline and every fixture per run', () => {
  const base = run('opus-full');
  const fast = run('opus-fast', {
    mode: 'fast',
    fixtures: [
      fixture('a', { ms: 30_000, chars: 1_500, actions: 0, removals: 0, failed: ['few actions left (≤4)'] }),
      fixture('b', { ms: 35_000, chars: 1_400, score: 30, cap: 30, actions: 0, removals: 0 }),
    ],
  });
  const table = renderBenchTable([base, fast], 'opus-full');
  // Runs saved before v7 carry no replacement counters: an em dash, never a 0.
  assert.match(table, /\| opus-full \| claude-opus-5 \| full \| v5 \| 90 s \| 180 s \| 3 \| 6000 \| 10 \| — \| — \| 0 \| 100% \(6\/6\) \| 100% \|/);
  assert.match(table, /\| opus-fast \| claude-opus-5 \| fast \| v5 \| 33 s \| 65 s \| 3 \| 1450 \| 0 \| — \| — \| 1 \| 100% \(6\/6\) \| 100% \|/);
  assert.match(table, /\| a \| 66 · 80 s · 3 kw \| 66 · 30 s · 3 kw ✗1 \|/);
  assert.match(table, /\| b \| 92 · 100 s · 3 kw \| 30 cap 30 · 35 s · 3 kw \|/);
  assert.equal(renderBenchTable([], 'x'), '(no runs)');
});

test('renderBenchTable sums the v7 counters when a run carries them', () => {
  const v7 = run('opus-v7', {
    promptVersion: 7,
    fixtures: [fixture('a', { replacements: 3, anchored: 1 }), fixture('b', { replacements: 2, anchored: 0 })],
  });
  assert.match(renderBenchTable([v7], 'opus-v7'), /\| opus-v7 \| claude-opus-5 \| full \| v7 \| 80 s \| 160 s \| 3 \| 6000 \| 10 \| 5 \| 1 \| 0 \|/);
});

test('renderBenchTable marks a fixture that returned nothing', () => {
  const r = run('t', { fixtures: [fixture('a', { score: null, ms: 300_000, keywords: [] })] });
  assert.match(renderBenchTable([r], 't'), /\| a \| failed · 300 s \|/);
  assert.match(renderBenchTable([r], 't'), /\| — \(0\/0\) \| — \|/);
});
