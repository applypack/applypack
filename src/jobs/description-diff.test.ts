import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRefresh, foldOps, normaliseDescription, planRefresh, refreshFlash, restoreFlash } from './description-diff';
import type { DiffOp } from '../resume/line-diff';

const line = (i: number, text: string) => ({ i, text });

test('planRefresh counts the lines the listing adds and drops, and sees through line endings', () => {
  const ops: DiffOp[] = [
    { op: 'keep', a: line(0, 'About us'), b: line(0, 'About us') },
    { op: 'change', a: line(1, 'We hire.'), b: line(1, 'We hire engineers.') },
    { op: 'insert', b: line(2, 'Requirements: PHP') },
    { op: 'insert', b: line(3, 'Nice: Vue') },
    { op: 'delete', a: line(2, 'Apply on Jobicy') },
  ];
  const before = 'About us\nWe hire.\nApply on Jobicy';
  const after = 'About us\nWe hire engineers.\nRequirements: PHP\nNice: Vue';
  const plan = planRefresh(`${before.replace(/\n/g, '\r\n')}\r\n`, after, ops, 'Senior PHP Engineer');
  assert.deepEqual(plan, { unchanged: false, before: before.length, after: after.length, added: 3, removed: 2, mentionsTitle: false });
  assert.equal(planRefresh('a\r\nb', 'a\nb\n', [], '').unchanged, true, 'CRLF and a trailing newline are not a change');
  assert.equal(planRefresh('x', 'Open role: senior php engineer (remote)', [], 'Senior PHP Engineer').mentionsTitle, true, 'the title is looked for case-insensitively');
  assert.equal(normaliseDescription('  x\r\ny \n'), 'x\ny');
});

test('describeRefresh says the size in words a person reads, and the flash names what the swap set in motion', () => {
  assert.equal(describeRefresh({ unchanged: true, before: 1200, after: 1200, added: 0, removed: 0, mentionsTitle: true }), "The company's listing reads the same as the stored description (1,200 characters) — nothing to replace.");
  assert.equal(describeRefresh({ unchanged: false, before: 240, after: 5871, added: 41, removed: 1, mentionsTitle: true }), '5,871 characters instead of 240: 41 lines added, 1 removed.');
  assert.match(describeRefresh({ unchanged: false, before: 900, after: 300, added: 2, removed: 20, mentionsTitle: true }), /instead of 900 — shorter: 2 lines added, 20 removed/);
  assert.match(describeRefresh({ unchanged: false, before: 300, after: 300, added: 1, removed: 1, mentionsTitle: true }), /the same 300 characters, differently worded: 1 line added, 1 removed/);
  const flash = refreshFlash(240, 5871, true);
  assert.match(flash, /240 → 5,871 characters/);
  assert.match(flash, /the original is kept\. Re-classified against your running searches; the next comparison reads the posting afresh/);
  assert.match(refreshFlash(1, 2, false), /No running search to re-classify against/);
  assert.match(restoreFlash(240, true), /Original description restored \(240 characters\)\. Re-classified;/);
});

test('foldOps keeps three lines of context around a change and folds the rest', () => {
  const keep = (i: number) => ({ op: 'keep' as const, a: line(i, `k${i}`), b: line(i, `k${i}`) });
  const ops: DiffOp[] = [
    ...Array.from({ length: 10 }, (_, i) => keep(i)),
    { op: 'change', a: line(10, 'old'), b: line(10, 'new') },
    ...Array.from({ length: 4 }, (_, i) => keep(11 + i)),
    { op: 'insert', b: line(15, 'added') },
    ...Array.from({ length: 10 }, (_, i) => keep(16 + i)),
  ];
  const rows = foldOps(ops);
  assert.deepEqual(rows.slice(0, 2), [{ kind: 'fold', count: 7 }, { kind: 'keep', text: 'k7' }], 'the head folds down to three context lines');
  assert.deepEqual(rows[4], { kind: 'delete', text: 'old' });
  assert.deepEqual(rows[5], { kind: 'insert', text: 'new' });
  assert.equal(rows.filter((r) => r.kind === 'fold').length, 2, 'a four-line gap between changes is shown whole');
  assert.deepEqual(rows[rows.length - 1], { kind: 'fold', count: 7 }, 'the tail folds after three lines');
  assert.deepEqual(foldOps([keep(0), keep(1)]), [{ kind: 'keep', text: 'k0' }, { kind: 'keep', text: 'k1' }], 'a short unchanged text is shown whole');
});
