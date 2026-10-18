import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countableFlags } from './red-flags';
import { annotateEvidence } from './evidence';
import { annotateAliasOnly, anchorStatuses } from './keyword-anchor';
import { withTableAliases } from './keyword-aliases';
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

test('"only in the skills line" is an evidence level, not a blocker', async () => {
  // The prompt's own list says this is never a red flag; `evidence` measures it,
  // and the page answers it with an action. One run in five wrote it anyway and
  // it was the entire residual spread after the first fix.
  const out = countableFlags(
    ['TypeScript listed only in skills/stack lines, never shown as hands-on work'],
    [kw({ term: 'TypeScript', status: 'present', evidence: 'listed' })],
    await matcher(),
  );
  assert.deepEqual(out.counted, []);
  assert.equal(out.exempt[0]?.term, 'TypeScript');

  // Shown inside the work: a flag naming it is about something else.
  const shown = countableFlags(
    ['TypeScript listed only in skills/stack lines, never shown as hands-on work'],
    [kw({ term: 'TypeScript', status: 'present', evidence: 'measured' })],
    await matcher(),
  );
  assert.equal(shown.counted.length, 1);
});

test('a flag naming a term the resume spells only through an alias restates the badge (#204)', async () => {
  const flag = 'Resume shows PHP but nothing that says PHP 8 specifically';
  const aliased = kw({ term: 'PHP 8', status: 'present', evidence: 'measured', aliases: ['php'], aliasOnly: 'PHP' });
  const out = countableFlags([flag], [aliased], await matcher());
  assert.deepEqual(out.counted, []);
  assert.deepEqual(out.exempt, [{ flag, term: 'PHP 8' }]);

  // Written in the posting's own spelling, the term is no gap: the flag is about something else.
  const own = countableFlags([flag], [{ ...aliased, aliasOnly: null }], await matcher());
  assert.deepEqual(own.counted, [flag]);
});

test('the case of #204 in match.ts order: anchored present through "php", the flag stays free', async () => {
  // @ts-expect-error — plain JS with no declaration file.
  const full = (await import('../web/public/target.mjs')) as KeywordMatcher;
  const text = 'Backend Developer\nBuilt order flows in PHP for 200 shops, cutting checkout time by 30%.';
  // The model called it cannot_claim; the alias table folds "PHP 8" to "php" (ADR 0045's measured case).
  const keywords = [withTableAliases(kw({ term: 'PHP 8' }))];
  const anchored = anchorStatuses(keywords, text, full).keywords;
  const graded = annotateEvidence(annotateAliasOnly(anchored, text, full), text, full).keywords;
  assert.equal(graded[0]?.status, 'present');
  assert.equal(graded[0]?.evidence, 'measured');
  assert.equal(graded[0]?.aliasOnly, 'PHP');
  assert.deepEqual(countableFlags(['No PHP 8 experience shown, only PHP'], graded, full).counted, []);
});
