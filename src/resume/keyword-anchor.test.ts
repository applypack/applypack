import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorKeywords, anchorStatuses, annotateAliasOnly, elsewhereForPosting } from './keyword-anchor';
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

test('a present keyword found only as an alias carries the spelling an ATS would miss (R4)', async () => {
  const matcher = await loadKeywordMatcher();
  const resume = 'Built reporting on Postgres and deployed with Kubernetes; wrote PHP and TypeScript.';
  const rows = annotateAliasOnly(
    [
      keyword('PostgreSQL', ['postgres']),
      keyword('Kubernetes', ['k8s']),
      { ...keyword('TypeScript', ['ts']), aliasOnly: 'ts' },
      { ...keyword('Golang', ['go']), status: 'add' as const },
      keyword('PHP'),
    ],
    resume,
    matcher,
  );
  assert.deepEqual(rows.map((k) => k.aliasOnly ?? null), ['Postgres', null, null, null, null]);
});

test('a verdict the text overrules is kept beside its note, so the page can say whose reading the note is (#203)', async () => {
  const matcher = await loadKeywordMatcher();
  const resume = 'Dana Example\nWordPress Developer\n\nSkills\nPHP, Ajax, Docker';
  const row = (term: string, status: MatchKeyword['status'], note: string | null): MatchKeyword => ({ ...keyword(term), status, note });
  const { keywords, upgraded, downgraded } = anchorStatuses(
    [
      row('WordPress Developer', 'cannot_claim', 'Title line does not use this title; no WP evidence to support it'),
      row('Docker', 'ask_user', 'Posting wants it; the resume does not say'),
      row('Ajax', 'add', "Candidate confirmed: 'ajax'"),
      row('PHP', 'present', null),
      row('Kafka', 'cannot_claim', 'Nothing in the resume'),
      row('automated testing', 'present', 'In the summary, in other words'),
    ],
    resume,
    matcher,
  );
  assert.deepEqual([upgraded, downgraded], [3, 1]);
  const by = Object.fromEntries(keywords.map((k) => [k.term, k]));
  // Overruled: the status is the text's, the note is still the model's, and the verdict it was written for is kept.
  assert.deepEqual([by['WordPress Developer']!.status, by['WordPress Developer']!.overruled], ['present', 'cannot_claim']);
  assert.equal(by['WordPress Developer']!.note, 'Title line does not use this title; no WP evidence to support it');
  assert.deepEqual([by.Docker!.status, by.Docker!.overruled], ['present', 'ask_user']);
  // An `add` that is written was never contradicted: its note is still true of the row.
  assert.deepEqual([by.Ajax!.status, by.Ajax!.overruled], ['present', null]);
  // Untouched rows are the same objects, with no marker of any kind.
  assert.equal(by.PHP!.overruled, undefined);
  assert.deepEqual([by.Kafka!.status, by.Kafka!.overruled], ['cannot_claim', undefined]);
  // A `present` the text does not spell becomes `add`, and nothing was overruled in its favour.
  assert.deepEqual([by['automated testing']!.status, by['automated testing']!.overruled], ['add', null]);

  // Read again on the same text, a flipped row is left as it is: the marker survives every later pass.
  const again = anchorStatuses(keywords, resume, matcher);
  assert.equal(again.upgraded + again.downgraded, 0);
  assert.equal(again.keywords.find((k) => k.term === 'Docker')!.overruled, 'ask_user');
  // And when the word leaves the text, the row is an `add` with nothing overruled.
  const gone = anchorStatuses(keywords, resume.replace('Docker', 'Podman'), matcher).keywords.find((k) => k.term === 'Docker')!;
  assert.deepEqual([gone.status, gone.overruled], ['add', null]);
});
