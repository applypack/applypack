import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyToApply, scoreLines, type LinesInput, type ScoreLine } from './score-lines';
import { readHardRequirements, readKeywords, type MatchKeyword } from '../resume/prompts';
import { scoreMatch, type MatchAlignment } from '../resume/score';

const STRONG: MatchAlignment = { title: 'strong', summary: 'strong', recent_role: 'strong' };

const kw = (over: Partial<MatchKeyword> & { term: string }): MatchKeyword =>
  readKeywords([{ priority: 1, requirement: 'must', primary: false, status: 'present', aliases: [], ...over }])[0]!;

const gate = (status: 'pass' | 'unknown' | 'fail', requirement = 'US work authorization') =>
  readHardRequirements([{ requirement, status, note: null }])[0]!;

/** A stored row, built through the real formula so the lines read real numbers. */
const input = (over: Partial<LinesInput> & { keywords: MatchKeyword[] }): LinesInput => ({
  breakdown: scoreMatch(over.keywords, STRONG, 0),
  hard: [],
  ...over,
});

const find = (lines: ScoreLine[], label: string) => lines.find((l) => l.label === label);

test('the three scored lines say what the number was made of', () => {
  const lines = scoreLines(
    input({
      keywords: [
        kw({ term: 'PHP', primary: true }),
        kw({ term: 'WordPress', primary: true }),
        kw({ term: 'Drupal', status: 'cannot_claim' }),
      ],
    }),
  );
  assert.deepEqual(lines.scored.map((l) => l.label), ['Requirements', 'Core stack', 'First glance']);
  assert.equal(find(lines.scored, 'Requirements')?.text, '2 of 3 the posting asks for');
  assert.equal(find(lines.scored, 'Core stack')?.text, 'PHP · WordPress — all present');
  assert.equal(find(lines.scored, 'First glance')?.text, 'title, summary and recent role all strong');
});

test('the core stack names what is missing and says what it costs', () => {
  const lines = scoreLines(
    input({
      keywords: [kw({ term: 'Rust', primary: true, status: 'cannot_claim' }), kw({ term: 'Go', primary: true })],
    }),
  );
  const core = find(lines.scored, 'Core stack');
  assert.equal(core?.text, 'Rust missing — this alone caps the score at 70');
  assert.equal(core?.tone, 'danger');
});

test('a posting with no primary stack says so instead of showing 0 of 0', () => {
  const lines = scoreLines(input({ keywords: [kw({ term: 'SEO', requirement: 'preferred' })] }));
  assert.equal(find(lines.scored, 'Core stack')?.text, 'this posting names none');
});

test('first glance names the weak places, not the strong ones', () => {
  const keywords = [kw({ term: 'PHP' })];
  const lines = scoreLines({
    keywords,
    hard: [],
    breakdown: scoreMatch(keywords, { title: 'off', summary: 'strong', recent_role: 'partial' }, 0),
  });
  assert.equal(find(lines.scored, 'First glance')?.text, 'title and recent role could be sharper');
});

test('shown at work is the line the formula does not count', () => {
  const lines = scoreLines(
    input({
      keywords: [
        kw({ term: 'PHP', evidence: 'measured' }),
        kw({ term: 'MySQL', evidence: 'described' }),
        kw({ term: 'Git', evidence: 'listed' }),
      ],
    }),
  );
  const shown = find(lines.diagnostic, 'Shown at work');
  assert.equal(shown?.text, '2 of 3 in a bullet · 1 named only in a list');
  assert.match(shown?.title ?? '', /Named and never shown: Git/);
});

test('a row written before evidence existed simply has no such line', () => {
  const lines = scoreLines(input({ keywords: [kw({ term: 'PHP' })] }));
  assert.equal(find(lines.diagnostic, 'Shown at work'), undefined);
});

test('gates the score never touched get their own line', () => {
  const met = scoreLines(input({ keywords: [kw({ term: 'PHP' })], hard: [gate('pass')] }));
  assert.equal(find(met.diagnostic, 'Hard requirements')?.text, 'all 1 met');

  const open = scoreLines(
    input({ keywords: [kw({ term: 'PHP' })], hard: [gate('fail'), gate('unknown', 'on-site in Austin')] }),
  );
  const line = find(open.diagnostic, 'To confirm');
  assert.equal(line?.text, '1 not met · 1 the resume is silent on');
  assert.equal(line?.tone, 'danger');
  assert.match(line?.title ?? '', /on-site in Austin/);
});

test('"send it" waits for the things the score does not count', () => {
  const clean = { keywords: [kw({ term: 'PHP', evidence: 'measured' })], hard: [gate('pass')] };
  const base = { ...input(clean), score: 100, threshold: 85, edits: 0 };
  assert.equal(readyToApply(base), true);

  // The live 100 that started this: three edits, five removals, one open gate.
  assert.equal(readyToApply({ ...base, edits: 3 }), false);
  assert.equal(readyToApply({ ...base, hard: [gate('unknown')] }), false);
  assert.equal(readyToApply({ ...base, score: 84 }), false);
  // A must-have named on a skills line and shown nowhere is not "done" either.
  assert.equal(
    readyToApply({ ...base, keywords: [kw({ term: 'PHP', evidence: 'listed' })] }),
    false,
  );
});
