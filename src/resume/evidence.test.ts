import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateEvidence, evidenceFor, isTermList, segmentAt } from './evidence';
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

const FLAT_ROW = 'Programming: Frameworks/Libraries: Data Storages: Others: | Go, PHP, JavaScript, TypeScript, SQL, HTML5, CSS3 Node.js, Symfony, React, Vue MySQL, PostgreSQL, Redis, Memcached Blade, Twig, Jira, ORM, Unit tests, Cypress, Jest, AWS, S3, OWASP';

test('a flattened .docx skills table is judged cell by cell, and is a list', () => {
  const col = FLAT_ROW.indexOf('CSS3');
  assert.equal(segmentAt(FLAT_ROW, col), FLAT_ROW.slice(FLAT_ROW.indexOf('| ') + 2), 'the values cell around the term');
  assert.equal(segmentAt(FLAT_ROW, 3), 'Programming: Frameworks/Libraries: Data Storages: Others:', 'the label cell');
  assert.equal(segmentAt('Go, PHP, Redis', 4), 'Go, PHP, Redis', 'a plain line is its own segment');
  assert.equal(isTermList(segmentAt(FLAT_ROW, col)), true, 'the values cell is a list with a few glued pairs');
  assert.equal(isTermList(segmentAt(FLAT_ROW, 3)), false, 'the label cell is not');
  assert.equal(isTermList(FLAT_ROW), true, 'the whole row passes the tolerant rule too — the cell is judged first for the label case');
  assert.equal(isTermList('Technology Stack: Node, Go, Typescript, React, Cypress, PHP, Lumen, Pest, MySQL, S3, EC2, RDS, CloudWatch, Braintree, Datadog Monitoring, Memcached, Cursor, LLM Integrations, AI Security & Code Analysis.'), true);
  assert.equal(isTermList('Unit tests, Docker and Kubernetes, CI'), true, 'one small word in five is still a list');
  assert.equal(isTermList('Led, built, shipped, tested, deployed, and measured the platform'), false, 'grammar is prose');
  assert.equal(isTermList('Reduced the complexity of the system, cutting costs by hundreds of thousands of dollars annually'), false);
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

test('a term on a flattened skills row is listed, not described', async () => {
  const m = await matcher();
  const text = `Alex Example\n## KEY SKILLS\n${FLAT_ROW}\n## EXPERIENCE\n- Built the checkout on Node.js`;
  assert.equal(evidenceFor(kw('CSS', ['CSS3']), text, m), 'listed');
  assert.equal(evidenceFor(kw('Node.js'), text, m), 'described');
});

test('annotateEvidence stamps every keyword and counts the invisible ones', async () => {
  const out = annotateEvidence([kw('Docker'), kw('AWS'), kw('Redis'), kw('Kubernetes')], RESUME, await matcher());
  assert.deepEqual(out.keywords.map((k) => k.evidence), ['listed', 'measured', 'described', 'absent']);
  assert.equal(out.listedOnly, 1, 'Docker is named and never shown');
});
