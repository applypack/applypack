import { test } from 'node:test';
import assert from 'node:assert/strict';

// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const mod = import('./public/kept-words.mjs') as Promise<{
  KEPT_FLOOR: number;
  wordsOf: (text: string) => Set<string>;
  shareKept: (analysed: Set<string>, text: string) => number;
}>;

const RESUME = [
  'Dana Ruiz',
  'Senior Full-Stack Developer | dana.ruiz@example.com',
  'Summary',
  'Full-stack engineer, six years building TypeScript products end to end.',
  'Experience',
  'Senior Full-Stack Developer - Harborline, 2022-present',
  '- Built the dispatch API in Node.js and TypeScript; 1.8M requests/day',
  '- Designed the PostgreSQL schema and Prisma migrations for invoicing',
  'Skills',
  'TypeScript, Node.js, React, PostgreSQL, Prisma, Docker',
].join('\n');

test('wordsOf: distinct words in one case, any script, punctuation gone', async () => {
  const { wordsOf } = await mod;
  assert.deepEqual([...wordsOf('Node.js, NODE and node — 1.8M')], ['node', 'js', 'and', '1', '8m']);
  assert.deepEqual([...wordsOf('Розробник Laravel')], ['розробник', 'laravel']);
  assert.equal(wordsOf('').size, 0);
  assert.equal(wordsOf(' — , ').size, 0);
});

test('shareKept: the untouched text keeps everything, an emptied or replaced one almost nothing', async () => {
  const { wordsOf, shareKept, KEPT_FLOOR } = await mod;
  const analysed = wordsOf(RESUME);
  assert.equal(shareKept(analysed, RESUME), 1);
  assert.equal(shareKept(analysed, ''), 0);
  const other = 'Jane Doe\nPastry chef in Lyon, twelve years of croissants and sourdough.';
  assert.ok(shareKept(analysed, other) < KEPT_FLOOR);
});

test('shareKept: real edits stay above the floor', async () => {
  const { wordsOf, shareKept, KEPT_FLOOR } = await mod;
  const analysed = wordsOf(RESUME);
  // Apply all as the Tailor page does it: a bullet reworded, a keyword added, a line removed.
  const edited = RESUME.replace(
    '- Designed the PostgreSQL schema and Prisma migrations for invoicing',
    '- Designed the PostgreSQL schema for invoicing; the monthly run fell from 35 to 5 minutes',
  )
    .replace('Prisma, Docker', 'Prisma, Docker, Redis')
    .replace('Summary\n', '');
  assert.ok(shareKept(analysed, edited) >= KEPT_FLOOR);
  // Case and repetition do not matter: a word counts once.
  assert.equal(shareKept(analysed, RESUME.toUpperCase() + '\n' + RESUME), 1);
});

test('shareKept: an analysed text with no words has nothing to lose', async () => {
  const { wordsOf, shareKept } = await mod;
  assert.equal(shareKept(wordsOf(''), ''), 1);
  assert.equal(shareKept(wordsOf(''), 'anything'), 1);
});

// Why the floor exists: two parts of the live score are the last analysis's
// judgment of the text it read, so a formula fed an empty editor still scores.
test('the live formula alone still scores an emptied editor', async () => {
  // @ts-expect-error — plain JS with no declaration file.
  const { scoreKeywords } = await import('./public/target.mjs');
  // @ts-expect-error — plain JS with no declaration file.
  const { computeScore, entriesFromLive } = await import('./public/score.mjs');
  const keywords = [
    { term: 'TypeScript', priority: 1, requirement: 'must', primary: true, status: 'present' },
    { term: 'PostgreSQL', priority: 1, requirement: 'must', primary: false, status: 'present' },
    { term: 'Redis', priority: 2, requirement: 'preferred', primary: false, status: 'add' },
  ];
  const alignment = { title: 'strong', summary: 'strong', recent_role: 'strong' };
  const live = (text: string) => computeScore(entriesFromLive(scoreKeywords(keywords, text).rows), alignment, 0, null).score;
  assert.ok(live('') > 0, 'alignment and the half credit of deleted keywords outlive the text');
  assert.ok(live(RESUME) > live(''));
});
