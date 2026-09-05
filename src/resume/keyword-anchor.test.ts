import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorKeywords, elsewhereForPosting } from './keyword-anchor';
import { loadKeywordMatcher } from './keyword-matcher';
import type { MatchKeyword } from './prompts';

const POSTING = [
  'Senior Full-stack Angular & PHP Developer',
  'We have different projects for Senior Full-Stack Developers, so if you have',
  '4+ years of software development experience, unit tests and Go, apply now.',
].join('\n');

function keyword(term: string, aliases: string[] = []): MatchKeyword {
  return { term, priority: 1, requirement: 'must', primary: false, status: 'present', aliases, where: null, note: null, elsewhere: null };
}

test('anchorKeywords keeps verbatim rows and rows an alias finds untouched', async () => {
  const matcher = await loadKeywordMatcher();
  const rows = [keyword('PHP Developer'), keyword('Golang', ['go']), keyword('unit test')];
  const r = anchorKeywords(rows, POSTING, matcher);
  assert.deepEqual(r, { keywords: rows, anchored: 0, unanchored: 0 });
  assert.equal(r.keywords[0], rows[0]);
});

test('anchorKeywords rewrites a paraphrase to the longest verbatim phrase, spelled as the posting spells it', async () => {
  const matcher = await loadKeywordMatcher();
  const r = anchorKeywords(
    [keyword('Senior Full-stack Developer (4+ years software development)'), keyword('Testing (unit tests)')],
    POSTING,
    matcher,
  );
  assert.equal(r.anchored, 2);
  assert.equal(r.unanchored, 0);
  assert.deepEqual(
    r.keywords.map((k) => k.term),
    ['Senior Full-Stack Developers', 'unit tests'],
  );
  assert.equal(r.keywords[0]?.status, 'present', 'everything but the term is kept');
  assert.equal('unanchored' in (r.keywords[0] ?? {}), false);
});

test('anchorKeywords marks rows the posting does not contain, never on a single word', async () => {
  const matcher = await loadKeywordMatcher();
  const r = anchorKeywords(
    [keyword('Agile'), keyword('Mentoring / team lead', ['mentored']), keyword('code review')],
    POSTING,
    matcher,
  );
  assert.equal(r.unanchored, 3);
  assert.equal(r.anchored, 0);
  for (const k of r.keywords) assert.equal(k.unanchored, true, k.term);
});

test('anchorKeywords leaves a row unanchored when its phrase is another row already', async () => {
  const matcher = await loadKeywordMatcher();
  const r = anchorKeywords([keyword('unit tests'), keyword('Testing (unit tests)')], POSTING, matcher);
  assert.deepEqual(r.keywords.map((k) => [k.term, k.unanchored ?? false]), [['unit tests', false], ['Testing (unit tests)', true]]);
});

test('elsewhereForPosting keeps only the other-resume skills the posting names, aliases included', async () => {
  const matcher = await loadKeywordMatcher();
  const skills = [
    { skill: 'php', resumeName: 'A' },
    { skill: 'golang', resumeName: 'A' },
    { skill: 'kubernetes', resumeName: 'B' },
    { skill: 'react', resumeName: 'B' },
  ];
  assert.deepEqual(elsewhereForPosting(skills, POSTING, matcher).map((s) => s.skill), ['php', 'golang']);
});
