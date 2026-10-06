import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestionKey } from '../resume/change-sheet';
import type { MatchAction, MatchKeyword, MatchRemoval } from '../resume/prompts';
import { DEFAULT_POLICY, dropsFigure, planEdits, type TailorPolicy } from './policy';

const action = (over: Partial<MatchAction> = {}): MatchAction => ({
  section: 'experience',
  where: 'Acme · bullet 1',
  what: 'Name the queue',
  why: 'the posting asks for it',
  priority: 'medium',
  quote: 'Built a billing service.',
  replacement: 'Built a billing service on Laravel queues, cutting invoice time 40%.',
  insert_after: null,
  ...over,
});

const removal = (over: Partial<MatchRemoval> = {}): MatchRemoval => ({
  section: 'skills',
  where: 'Skills · Tools',
  what: 'Drop the dated tools',
  why: 'the posting never asks for them',
  quote: 'jQuery, Bower',
  ...over,
});

const keyword = (term: string, over: Partial<MatchKeyword> = {}): MatchKeyword => ({
  term,
  priority: 2,
  requirement: 'must',
  primary: false,
  status: 'add',
  aliases: [],
  where: null,
  note: null,
  elsewhere: null,
  ...over,
});

const plan = (
  report: { actions?: MatchAction[]; removals?: MatchRemoval[]; keywords?: MatchKeyword[]; postingTitle?: string },
  policy: Partial<TailorPolicy> = {},
) => planEdits({ actions: [], removals: [], keywords: [], ...report }, { ...DEFAULT_POLICY, ...policy });

test('a change replaces its quote, an addition follows its anchor, each under its card key', () => {
  const change = action({ section: 'summary', where: 'Summary' });
  const addition = action({ section: 'summary', where: 'Summary · last line', quote: null, insert_after: 'Ten years of PHP.', replacement: 'Remote since 2019.' });
  assert.deepEqual(plan({ actions: [change, addition] }).ops, [
    { key: suggestionKey(change), kind: 'change', quote: 'Built a billing service.', wording: change.replacement },
    { key: suggestionKey(addition), kind: 'add', anchor: 'Ten years of PHP.', wording: 'Remote since 2019.' },
  ]);
});

test('wording the gate refused, an instruction and an edit with no place are held, never applied', () => {
  const refused = action({ where: 'refused', replacement: null });
  const instruction = action({ where: 'instruction', what: 'Cut this role to four bullets', replacement: undefined, quote: null });
  const placeless = action({ where: 'placeless', quote: null, insert_after: null });
  const { ops, held } = plan({ actions: [refused, instruction, placeless] });
  assert.deepEqual(ops, []);
  assert.deepEqual(held.map((h) => [h.where, h.reason]), [
    ['refused', 'no-wording'],
    ['instruction', 'no-wording'],
    ['placeless', 'no-wording'],
  ]);
});

test('the bullet limit keeps the highest priority first and leaves the report order alone', () => {
  const low = action({ where: 'low', priority: 'low', quote: 'a' });
  const high = action({ where: 'high', priority: 'high', quote: 'b' });
  const medium = action({ where: 'medium', priority: 'medium', quote: 'c' });
  const second = action({ where: 'second high', priority: 'high', quote: 'd' });
  const summary = action({ section: 'summary', where: 'Summary', priority: 'low', quote: 'e' });
  const { ops, held } = plan({ actions: [low, high, medium, second, summary] });
  assert.deepEqual(ops.map((o) => o.key), [high, second, summary].map(suggestionKey));
  assert.deepEqual(held.map((h) => [h.where, h.reason]), [
    ['low', 'over-limit'],
    ['medium', 'over-limit'],
  ]);
});

test('an edit the gate refused does not use up the bullet limit', () => {
  const refused = action({ where: 'refused', priority: 'high', replacement: null });
  const kept = action({ where: 'kept', priority: 'low', quote: 'x' });
  assert.deepEqual(plan({ actions: [refused, kept] }, { maxBullets: 1 }).ops.map((o) => o.key), [suggestionKey(kept)]);
});

test('a section the person closed is held, for a change and for a removal', () => {
  const title = action({ section: 'title', where: 'Title line' });
  const { ops, held } = plan({ actions: [title], removals: [removal()] }, { sections: ['experience'], removals: true });
  assert.deepEqual(ops, []);
  assert.deepEqual(held.map((h) => h.reason), ['section', 'section']);
});

test('nothing is cut unless the policy says so', () => {
  const cut = removal();
  assert.deepEqual(plan({ removals: [cut] }).ops, []);
  assert.deepEqual(plan({ removals: [cut] }).held, [{ section: 'skills', where: 'Skills · Tools', reason: 'removals-off' }]);
  assert.deepEqual(plan({ removals: [cut] }, { removals: true }).ops, [{ key: suggestionKey(cut), kind: 'remove', quote: 'jQuery, Bower' }]);
  // Advice with no span to strike (replacement-gate.ts:gateRemovals) has nothing to remove.
  assert.deepEqual(plan({ removals: [removal({ quote: null })] }, { removals: true }).held[0]?.reason, 'no-wording');
});

test('two additions to one place are one operation, as on the page', () => {
  const first = action({ section: 'skills', where: 'Skills', quote: null, insert_after: 'PHP, Laravel', replacement: 'Redis, Horizon' });
  const again = { ...first, replacement: 'Docker, Nginx' };
  const { ops } = plan({ actions: [first, again] });
  assert.equal(ops.length, 1);
  assert.equal(ops[0]?.kind === 'add' && ops[0].wording, 'Redis, Horizon');
});

test('only keywords the resume backs are written: weighted, unwritten, not ignored', () => {
  const { terms } = plan({
    keywords: [
      keyword('Redis', { where: 'Skills · Backend' }),
      keyword('Horizon'),
      keyword('Laravel', { status: 'present' }),
      keyword('Kubernetes', { status: 'cannot_claim' }),
      keyword('Go', { status: 'ask_user' }),
      keyword('fintech', { requirement: 'context' }),
      keyword('Vue', { override: { excluded: true } }),
      keyword('Docker', { requirement: 'must', override: { requirement: 'context' } }),
    ],
  });
  assert.deepEqual(terms, [{ term: 'Redis', where: 'Skills · Backend' }, { term: 'Horizon' }]);
  assert.deepEqual(plan({ keywords: [keyword('Redis')] }, { keywords: false }).terms, []);
});

test('a second card on the same place neither runs nor uses up the bullet limit', () => {
  const first = action({ where: 'Acme · after bullet 2', priority: 'high', quote: null, insert_after: 'Led code reviews.', replacement: 'Mentored four developers.' });
  const twin = { ...first, replacement: 'Ran weekly design reviews.' };
  const other = action({ where: 'Acme · bullet 1', priority: 'low' });
  const { ops, held } = plan({ actions: [first, twin, other] });
  assert.deepEqual(ops.map((o) => o.key), [first, other].map(suggestionKey));
  assert.deepEqual(held, []);
});

test('a removal of the very span a change rewrites is not run on top of it', () => {
  const change = action({ section: 'skills', where: 'Skills · Tools', quote: 'jQuery, Bower' });
  const { ops } = plan({ actions: [change], removals: [removal()] }, { removals: true });
  assert.deepEqual(ops.map((o) => o.kind), ['change']);
});

test('a rewrite that loses a number the line had waits for the person', () => {
  assert.equal(dropsFigure('Led platforms supporting $10M+ ARR with 99.9% uptime.', 'Led Laravel platforms with 99.9% uptime.'), true);
  assert.equal(dropsFigure('raising successful transactions by 15–20%', 'raising successful transactions 15-20% across two gateways'), false);
  assert.equal(dropsFigure('serving 1,200 clients', 'serving 1200 clients on Laravel'), false);
  // The same digits under another unit are another figure.
  assert.equal(dropsFigure('Ten years. Led platforms supporting $10M+ ARR.', 'Engineer with 10+ years on Laravel platforms.'), true);
  assert.equal(dropsFigure('reducing risks by 40%+.', 'reducing risks by 40% across three services.'), false);
  assert.equal(dropsFigure('Built a billing service.', 'Built a billing service, cutting invoice time 40%.'), false);

  const summary = action({ section: 'summary', where: 'Summary', quote: 'Ten years. Led platforms supporting $10M+ ARR.', replacement: 'Ten years of Laravel.' });
  const { ops, held } = plan({ actions: [summary] });
  assert.deepEqual(ops, []);
  assert.deepEqual(held, [{ section: 'summary', where: 'Summary', reason: 'drops-figure' }]);
});

test('an edit that drops a figure does not use up the bullet limit', () => {
  const lossy = action({ where: 'lossy', priority: 'high', quote: 'Cut costs 30%.', replacement: 'Cut costs.' });
  const kept = action({ where: 'kept', priority: 'low', quote: 'x' });
  assert.deepEqual(plan({ actions: [lossy, kept] }, { maxBullets: 1 }).ops.map((o) => o.key), [suggestionKey(kept)]);
});

test("the posting's own title is never written as a skill, however it is punctuated", () => {
  const keywords = [keyword('Senior Product Engineer (Laravel - Remote)'), keyword('Redis')];
  assert.deepEqual(plan({ keywords, postingTitle: 'Senior Product Engineer (Laravel – Remote)' }).terms, [{ term: 'Redis' }]);
  assert.deepEqual(plan({ keywords }).terms.length, 2);
});
