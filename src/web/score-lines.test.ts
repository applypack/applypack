import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainAdvice, readyToApply, scoreLines, type AdviceInput, type LinesInput, type ScoreLine } from './score-lines';
import { readActions, readHardRequirements, readKeywords, type MatchAction, type MatchKeyword } from '../resume/prompts';
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

const act = (priority: MatchAction['priority'], what: string): MatchAction =>
  readActions([{ section: 'summary', where: 'x', what, why: 'x', priority, quote: null, replacement: null, insert_after: null }])[0]!;

/** A stored row as the advice ladder reads it: the five lines' input plus the report's edits. */
const advice = (over: Partial<AdviceInput> & { keywords: MatchKeyword[] }): string | null =>
  mainAdvice({ actions: [], ...input(over), ...over });

test('a failed gate outranks everything the wording could fix', () => {
  assert.equal(
    advice({
      keywords: [kw({ term: 'PHP', status: 'cannot_claim' })],
      hard: [gate('fail', 'US work authorization')],
      actions: [act('high', 'rewrite the summary')],
    }),
    '\u201cUS work authorization\u201d is not met — a gate decides this before any wording does.',
  );
});

test('a gate written as a paragraph is quoted as a glance, not as a paragraph', () => {
  const wordy = 'Legally authorized to work in the United States without any form of current or future visa sponsorship by the employer';
  const out = advice({ keywords: [kw({ term: 'PHP', primary: true })], hard: [gate('fail', wordy)] });
  assert.ok(out !== null && out.length < 160, `advice ran to ${out?.length} chars`);
  assert.ok(out?.includes('Legally authorized to work in the United States'));
});

test('two missing core-stack terms are named, and the verb agrees with them', () => {
  assert.equal(
    advice({ keywords: [kw({ term: 'Rust', primary: true, status: 'cannot_claim' }), kw({ term: 'Go', primary: true, status: 'ask_user' })] }),
    'Rust and Go are the core stack here — nothing you write lifts this past 30 without them.',
  );
});

test('one missing core-stack term takes the singular', () => {
  assert.equal(
    advice({ keywords: [kw({ term: 'Rust', primary: true, status: 'cannot_claim' })] }),
    'Rust is the core stack here — nothing you write lifts this past 30 without it.',
  );
});

test('more missing than fit are counted, never silently dropped', () => {
  const keywords = ['Rust', 'Go', 'Elixir', 'Scala', 'Haskell'].map((term) =>
    kw({ term, primary: true, status: 'cannot_claim' }),
  );
  assert.equal(
    advice({ keywords }),
    'Rust and Go and 3 more are the core stack here — nothing you write lifts this past 30 without them.',
  );
});

test('an unanswered gate comes before any keyword', () => {
  assert.equal(
    advice({ keywords: [kw({ term: 'PHP', primary: true })], hard: [gate('unknown', 'on-site in Atlanta, GA')] }),
    'The resume is silent on \u201con-site in Atlanta, GA\u201d — a gate the reader checks before the words.',
  );
});

test('an evidenced but unwritten must is the cheapest move on the page', () => {
  assert.equal(
    advice({ keywords: [kw({ term: 'PHP', primary: true }), kw({ term: 'REST APIs', status: 'add' })] }),
    'Write REST APIs into the text — your own experience evidences it and the word is not there.',
  );
});

test('a must nothing backs is put to the candidate, not written for them', () => {
  assert.equal(
    advice({ keywords: [kw({ term: 'PHP', primary: true }), kw({ term: 'Kubernetes', status: 'cannot_claim' })] }),
    'Kubernetes is a must here and nothing backs it yet — confirm it where it is true.',
  );
});

test('job 71: three musts named only on a skills line, the first named and the rest counted', () => {
  const keywords = [
    kw({ term: 'PHP', primary: true, evidence: 'measured' }),
    kw({ term: 'Laravel', primary: true, evidence: 'measured' }),
    kw({ term: 'REST APIs', evidence: 'listed' }),
    kw({ term: 'MySQL', evidence: 'listed' }),
    kw({ term: 'Git', evidence: 'listed' }),
  ];
  assert.equal(
    advice({ keywords }),
    'Show REST APIs in a bullet, not only on the skills line — 3 must-haves are named and never shown.',
  );
  assert.equal(
    advice({ keywords: keywords.slice(0, 3) }),
    'Show REST APIs in a bullet, not only on the skills line — a term in a list proves nothing to a reader.',
  );
});

test('a weak first glance reads as words, for every grade below strong', () => {
  const keywords = [kw({ term: 'PHP', primary: true, evidence: 'measured' })];
  const glance = (alignment: MatchAlignment) =>
    mainAdvice({ breakdown: scoreMatch(keywords, alignment, 0), keywords, hard: [], actions: [act('high', 'rewrite the summary')] });
  assert.equal(
    glance({ title: 'partial', summary: 'strong', recent_role: 'strong' }),
    'Sharpen the title — it only partly matches this posting.',
  );
  assert.equal(
    glance({ title: 'off', summary: 'strong', recent_role: 'strong' }),
    'Sharpen the title — it does not match this posting.',
  );
  assert.equal(
    glance({ title: 'strong', summary: 'strong', recent_role: 'off' }),
    'Sharpen the most recent role — it does not match this posting.',
  );
});

test('with nothing else open the report\u2019s own first high edit becomes the sentence', () => {
  const keywords = [kw({ term: 'PHP', primary: true, evidence: 'measured' })];
  assert.equal(
    advice({ keywords, actions: [act('low', 'tidy the dates'), act('high', 'lead with PHP/Laravel platform leadership instead of the AI-orchestrator framing')] }),
    'Lead with PHP/Laravel platform leadership instead of the AI-orchestrator framing.',
  );
  assert.equal(advice({ keywords, actions: [act('low', 'tidy the dates')] }), 'Tidy the dates.');
});

test('a name that opens lowercase on purpose keeps its own spelling', () => {
  const keywords = [kw({ term: 'PHP', primary: true, evidence: 'measured' })];
  assert.equal(advice({ keywords, actions: [act('high', 'iOS navigation needs its own bullet')] }), 'iOS navigation needs its own bullet.');
  assert.equal(advice({ keywords, actions: [act('high', 'eBay checkout work belongs first')] }), 'eBay checkout work belongs first.');
});

test('a clean report says nothing — the ready line already covers it', () => {
  assert.equal(advice({ keywords: [kw({ term: 'PHP', primary: true, evidence: 'measured' })] }), null);
});
