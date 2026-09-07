import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateEvidence, evidenceFor, isTermList } from './evidence';
import { readKeywords, type MatchKeyword } from './prompts';
import type { KeywordMatcher } from './keyword-matcher';

const kw = (term: string, aliases: string[] = []): MatchKeyword =>
  readKeywords([{ term, priority: 1, requirement: 'must', primary: false, status: 'present', aliases }])[0]!;

async function matcher(): Promise<Pick<KeywordMatcher, 'findTerm'>> {
  // The real browser matcher, loaded the way keyword-matcher.ts loads it.
  // @ts-expect-error — plain JS with no declaration file.
  return (await import('../web/public/target.mjs')) as Pick<KeywordMatcher, 'findTerm'>;
}

const RESUME = [
  'Alex Example — Senior Backend Engineer',
  'Core Skills: PHP, Laravel, AWS, Redis, Docker',
  'Experience',
  '- Migrated 14 services to AWS ECS, cutting infrastructure cost 23%.',
  '- Built Laravel payment workflows for the checkout team.',
  '- Ran the Redis cluster.',
].join('\n');

test('a skills line is a term list; a sentence about work is not', () => {
  assert.equal(isTermList('Core Skills: PHP, Laravel, AWS, Redis, Docker'), true);
  assert.equal(isTermList('Programming: Go, PHP, TypeScript'), true);
  assert.equal(isTermList('- Migrated 14 services to AWS ECS, cutting infrastructure cost 23%.'), false);
  assert.equal(isTermList('- Built Laravel payment workflows for the checkout team.'), false);
  // Two items is a list; one is a heading.
  assert.equal(isTermList('Experience'), false);
});

test('the strongest evidence wins: listed, described, measured', async () => {
  const m = await matcher();
  // Docker is only on the skills line.
  assert.equal(evidenceFor(kw('Docker'), RESUME, m), 'listed');
  // Laravel is on the skills line AND inside a bullet with no number.
  assert.equal(evidenceFor(kw('Laravel'), RESUME, m), 'described');
  // AWS is on the skills line AND inside a bullet carrying a percentage.
  assert.equal(evidenceFor(kw('AWS'), RESUME, m), 'measured');
  // Kubernetes is nowhere.
  assert.equal(evidenceFor(kw('Kubernetes'), RESUME, m), 'absent');
});

test('a bare year or a version number is not impact', async () => {
  const m = await matcher();
  const text = '- Used Vue 3 on the marketing site since 2019.';
  assert.equal(evidenceFor(kw('Vue'), text, m), 'described');
});

test('annotateEvidence stamps every keyword and counts the invisible ones', async () => {
  const out = annotateEvidence([kw('Docker'), kw('AWS'), kw('Redis'), kw('Kubernetes')], RESUME, await matcher());
  assert.deepEqual(out.keywords.map((k) => k.evidence), ['listed', 'measured', 'described', 'absent']);
  assert.equal(out.listedOnly, 1, 'Docker is named and never shown');
});
