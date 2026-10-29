import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorDemand, floorGaps, hasCore, unwrittenMusts } from './suggestion-floor';
import { readActions, readKeywords, type MatchAction, type MatchKeyword } from './prompts';
import type { MatchAlignment } from './score';

const kw = (over: Partial<MatchKeyword> & { term: string }): MatchKeyword =>
  readKeywords([{ priority: 1, requirement: 'must', primary: false, status: 'present', aliases: [], ...over }])[0]!;

const action = (over: Partial<MatchAction>): MatchAction =>
  readActions([{ section: 'title', where: 'x', what: 'x', why: 'x', priority: 'high', ...over }])[0]!;

const OFF: MatchAlignment = { title: 'off', summary: 'off', recent_role: 'off' };
const STRONG: MatchAlignment = { title: 'strong', summary: 'strong', recent_role: 'strong' };
const bd = (over: Partial<{ primaryTotal: number; primaryPresent: number; ceiling: number }> = {}) => ({
  primaryTotal: 2,
  primaryPresent: 1,
  ceiling: 70,
  ...over,
});

test('a grade below strong with no high-priority action is a gap', () => {
  const gaps = floorGaps({ keywords: [kw({ term: 'React' })], alignment: OFF, actions: [], breakdown: bd() });
  assert.deepEqual(gaps, ['title', 'summary', 'experience']);
  assert.match(floorDemand(gaps), /THE LAST REPLY MISSED REQUIRED COVERAGE/);
  assert.match(floorDemand(gaps), /the profession exemption does not apply here/);
});

test('an action of the right priority in the right section closes its gap', () => {
  const gaps = floorGaps({
    keywords: [kw({ term: 'React' })],
    alignment: { title: 'off', summary: 'strong', recent_role: 'strong' },
    actions: [action({ section: 'title', priority: 'high' })],
    breakdown: bd(),
  });
  assert.deepEqual(gaps, []);
  // A low-priority hedge does not: that is what the rule was written against.
  const hedged = floorGaps({
    keywords: [kw({ term: 'React' })],
    alignment: { title: 'off', summary: 'strong', recent_role: 'strong' },
    actions: [action({ section: 'title', priority: 'low' })],
    breakdown: bd(),
  });
  assert.deepEqual(hedged, ['title']);
});

test('a must-level term buried on a skills line is owed a bullet', () => {
  const gaps = floorGaps({
    keywords: [kw({ term: 'React', evidence: 'listed' })],
    alignment: STRONG,
    actions: [],
    breakdown: bd(),
  });
  assert.deepEqual(gaps, ['skills']);
  // Shown inside a bullet already: nothing owed.
  assert.deepEqual(
    floorGaps({ keywords: [kw({ term: 'React', evidence: 'measured' })], alignment: STRONG, actions: [], breakdown: bd() }),
    [],
  );
});

test('a different profession is owed nothing, and neither is a hopeless ceiling', () => {
  const pmVsEngineer = { keywords: [kw({ term: 'Go', status: 'cannot_claim' })], alignment: OFF, actions: [] };
  assert.deepEqual(floorGaps({ ...pmVsEngineer, breakdown: bd({ primaryPresent: 0 }) }), []);
  // Core coverage, but no wording reaches an application from a ceiling of 40.
  assert.deepEqual(
    floorGaps({ keywords: [kw({ term: 'React' })], alignment: OFF, actions: [], breakdown: bd({ ceiling: 40 }) }),
    [],
  );
});

test('hasCore falls back to must-level coverage when the posting names no primary stack', () => {
  const two = [kw({ term: 'SEO' }), kw({ term: 'Figma', status: 'add' })];
  assert.equal(hasCore({ keywords: two, breakdown: bd({ primaryTotal: 0, primaryPresent: 0 }) }), true);
  assert.equal(hasCore({ keywords: two.slice(0, 1), breakdown: bd({ primaryTotal: 0, primaryPresent: 0 }) }), false);
});

test('a must-level term the resume backs but no rewrite writes in is owed, by name', () => {
  const keywords = [kw({ term: 'React' }), kw({ term: 'Kafka', status: 'add', aliases: ['apache kafka'] })];
  const none = floorGaps({ keywords, alignment: STRONG, actions: [action({ section: 'experience', replacement: 'Built the payments backend.' })], breakdown: bd() });
  assert.deepEqual(none, ['keywords']);
  assert.deepEqual(unwrittenMusts({ keywords, actions: [] }), ['Kafka']);
  assert.match(floorDemand(none, ['Kafka']), /\(Kafka\)/);
  // Once, on the skills line or in the bullet whose work used it — never into every rewrite (#633).
  assert.match(floorDemand(none, ['Kafka']), /write each in once: on the skills line, or into the one bullet whose work used it/);
  // Written in, by its own name or an alias, the gap closes; a word inside another word does not count.
  const byAlias = [action({ section: 'experience', replacement: 'Moved the event bus to Apache Kafka.' })];
  assert.deepEqual(floorGaps({ keywords, alignment: STRONG, actions: byAlias, breakdown: bd() }), []);
  assert.deepEqual(unwrittenMusts({ keywords, actions: [action({ replacement: 'Kafkaesque paperwork.' })] }), ['Kafka']);
  // A preferred term is the prompt's to ask for, not the floor's.
  assert.deepEqual(unwrittenMusts({ keywords: [kw({ term: 'Redis', status: 'add', requirement: 'preferred' })], actions: [] }), []);
});
