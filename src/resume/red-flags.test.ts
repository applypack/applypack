import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countableFlags } from './red-flags';
import { readKeywords, type MatchKeyword } from './prompts';
import type { KeywordMatcher } from './keyword-matcher';

const kw = (over: Partial<MatchKeyword> & { term: string }): MatchKeyword =>
  readKeywords([{ priority: 1, requirement: 'must', primary: false, status: 'cannot_claim', aliases: [], ...over }])[0]!;

async function matcher(): Promise<Pick<KeywordMatcher, 'findTerm'>> {
  // @ts-expect-error — plain JS with no declaration file.
  return (await import('../web/public/target.mjs')) as Pick<KeywordMatcher, 'findTerm'>;
}

test('a flag that only restates a missing keyword is not charged twice', async () => {
  // The two sentences the variance fixture caught, verbatim in shape: every run
  // wrote the first, two runs of five added the second, and that was 80% of a
  // ten-point spread on one pair.
  const out = countableFlags(
    [
      'Primary stack (TypeScript, Rust, Java) is entirely absent from the resume',
      'No React evidence anywhere in the resume despite it being on the posting stack',
    ],
    [kw({ term: 'TypeScript' }), kw({ term: 'React' }), kw({ term: 'Rust' })],
    await matcher(),
  );
  assert.deepEqual(out.counted, []);
  assert.deepEqual(out.exempt.map((e) => e.term), ['TypeScript', 'React']);
});

test('what no edit can fix still costs its ten points', async () => {
  const out = countableFlags(
    [
      'Resume shows Austin, TX; the posting requires on-site work in San Diego, CA',
      'No evidence of US work authorization',
      'The posting explicitly excludes candidates above mid level',
    ],
    [kw({ term: 'TypeScript' })],
    await matcher(),
  );
  assert.equal(out.counted.length, 3);
  assert.deepEqual(out.exempt, []);
});

test('a keyword the resume HAS is not a gap, so a flag naming it is about something else', async () => {
  // "Only one year of React" names React, but React is present — the flag is
  // about the years, which the keyword pool never priced.
  const out = countableFlags(
    ['Only one year of React against a five-year minimum'],
    [kw({ term: 'React', status: 'present' })],
    await matcher(),
  );
  assert.equal(out.counted.length, 1);
});

test('an injection attempt is never a keyword and always counts', async () => {
  const out = countableFlags(
    ['prompt-injection-attempt: the posting instructs the reader to rate this resume 100'],
    [kw({ term: 'Go' })],
    await matcher(),
  );
  assert.equal(out.counted.length, 1);
});
