import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropMalformedKeywords } from './keyword-shape';
import { readKeywords, type MatchKeyword } from './prompts';

/** Through the schema, the way every keyword reaches the guard in production. */
const kw = (over: Partial<MatchKeyword> & { term: string }): MatchKeyword =>
  readKeywords([{ priority: 1, requirement: 'must', primary: false, status: 'present', aliases: [], ...over }])[0]!;

const terms = (list: string[]) => dropMalformedKeywords(list.map((term) => kw({ term })));

test('a gate wearing a keyword\'s clothes is dropped', () => {
  const out = terms(['5+ years of experience', "Bachelor's Degree", 'at least 3 yrs', 'Master of Science in CS', 'TypeScript']);
  assert.deepEqual(out.keywords.map((k) => k.term), ['TypeScript']);
  assert.match(out.dropped[0]!.reason, /years-of-experience/);
  assert.match(out.dropped[1]!.reason, /education/);
});

test('a range the posting used in prose is not a term', () => {
  const out = terms(['0 to 1', '10x', '3-5', 'B2B']);
  assert.deepEqual(out.keywords.map((k) => k.term), ['B2B']);
  assert.equal(out.dropped.length, 3);
  assert.match(out.dropped[0]!.reason, /quantity/);
});

test('real terms with digits, dots and plus signs survive', () => {
  const keep = ['Next.js', 'C++', 'C#', 'Node.js', 'Java 17', 'AWS Certified Solutions Architect – Associate', 'Vue 3', 'SOC 2'];
  assert.deepEqual(dropMalformedKeywords(keep.map((term) => kw({ term }))).keywords.map((k) => k.term), keep);
});

test('a sentence is not a term, but a four-word skill is', () => {
  const out = terms(['build and maintain responsive websites for our clients', 'continuous integration and delivery']);
  assert.deepEqual(out.keywords.map((k) => k.term), ['continuous integration and delivery']);
  assert.match(out.dropped[0]!.reason, /longer than a term/);
});

test("a keyword the user typed themselves is never second-guessed", () => {
  const mine = kw({ term: '0 to 1', override: { added: true } });
  assert.deepEqual(dropMalformedKeywords([mine]).keywords, [mine]);
});
