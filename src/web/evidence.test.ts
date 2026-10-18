import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_LEVELS, evidenceFor, isTermList, lineAt, segmentAt } from '../resume/evidence';
import type { KeywordMatcher } from '../resume/keyword-matcher';

/*
 * public/evidence.mjs is the browser copy of resume/evidence.ts (ADR 0058):
 * the live ring grades a keyword's evidence on every keystroke, the server
 * grades it at analysis time, and the two must never disagree about the same
 * text — the disagreement gotcha 17 describes, one rule later.
 */

interface BrowserEvidence {
  EVIDENCE_LEVELS: readonly string[];
  lineAt: typeof lineAt;
  segmentAt: typeof segmentAt;
  isTermList: typeof isTermList;
  evidenceOf: (text: string, spans: { start: number; end: number }[]) => string;
}

// @ts-expect-error — plain JS with no declaration file; parity is asserted below.
const browser = import('./public/evidence.mjs') as Promise<BrowserEvidence>;
// @ts-expect-error — plain JS with no declaration file.
const matcher = import('./public/target.mjs') as Promise<Pick<KeywordMatcher, 'findTerm'>>;

/** Every line of every resume fixture the repo carries, plus the shapes gotcha 18 was paid for. */
function corpus(): string[] {
  const texts = [
    readFileSync(join(__dirname, '..', 'scripts', 'route-smoke.ts'), 'utf8'),
    readFileSync(join(__dirname, '..', 'resume', 'evidence.test.ts'), 'utf8'),
    readFileSync(join(__dirname, '..', 'resume', 'structure-from-text.test.ts'), 'utf8'),
    readFileSync(join(__dirname, '..', 'screening', 'anchor.test.ts'), 'utf8'),
  ];
  return [
    ...texts.flatMap((t) => t.split('\n')),
    'Languages | Node.js, TypeScript, PHP',
    'Technology Stack: Node, Go, Typescript, React, Cypress, PHP, Lumen, Pest, MySQL, S3, EC2.',
    '- Migrated 14 services to AWS ECS, cutting infrastructure cost 23%.',
    'Core Skills: PHP, Laravel, AWS, Redis, Docker',
    'Senior Backend Engineer — Node.js, TypeScript, PostgreSQL',
    'Senior QA Automation Engineer, SoftServe — березень 2021 – дотепер',
    '- Built the checkout — Node.js, PostgreSQL, Redis',
    'Languages | Backend Engineer — Go, Docker | 2020',
  ];
}

test('the browser grades every line exactly as the server does', async () => {
  const b = await browser;
  assert.deepEqual(b.EVIDENCE_LEVELS, [...EVIDENCE_LEVELS]);
  for (const line of corpus()) {
    assert.equal(b.isTermList(line), isTermList(line), `isTermList: ${line}`);
    for (const column of [0, Math.floor(line.length / 2), line.length]) {
      assert.equal(b.segmentAt(line, column), segmentAt(line, column), `segmentAt(${column}): ${line}`);
    }
  }
});

test('and every term in a resume gets the same grade on both sides', async () => {
  const [b, m] = await Promise.all([browser, matcher]);
  const text = corpus().join('\n');
  for (const term of ['Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'AWS', 'Laravel', 'Redis', 'React', 'CSS', 'Kubernetes', 'PHP', 'Go']) {
    const server = evidenceFor({ term, aliases: [] }, text, m);
    assert.equal(b.evidenceOf(text, m.findTerm(text, term, [])), server, term);
  }
});
