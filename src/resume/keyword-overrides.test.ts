import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addKeyword,
  carryOverrides,
  editKeyword,
  effectiveKeywords,
  effectiveRequirement,
  isIgnored,
} from './keyword-overrides';
import type { MatchKeyword } from './prompts';
import { scoreMatch } from './score';
import { loadKeywordMatcher } from './keyword-matcher';

/*
 * §5 overrides: the user re-levels, ignores and adds keywords, and the score
 * follows — deterministically, with no AI call. The matcher is the browser
 * module the panes use, loaded here the same way the server loads it.
 */

const RESUME = 'Senior PHP engineer. Laravel, PostgreSQL, Docker and CI/CD pipelines.';
const POSTING = 'We need Laravel, Kafka and a lot of Docker. Free snacks and a ping-pong table.';

/** The matcher is the browser module the panes use — loaded as the server loads it. */
async function context(resumeText = RESUME) {
  return { resumeText, posting: POSTING, matcher: await loadKeywordMatcher() };
}

function kw(over: Partial<MatchKeyword> & { term: string }): MatchKeyword {
  return {
    priority: 2,
    requirement: 'preferred',
    primary: false,
    status: 'present',
    aliases: [],
    where: null,
    note: null,
    elsewhere: null,
    ...over,
  };
}

const LIST: MatchKeyword[] = [
  kw({ term: 'Laravel', requirement: 'must', primary: true, priority: 1 }),
  kw({ term: 'ping-pong table', requirement: 'nice', priority: 4, status: 'cannot_claim' }),
];

test('re-levelling stores the user level beside the model verdict, and back again resets it', () => {
  const up = editKeyword(LIST, { op: 'level', term: 'ping-pong table', requirement: 'must' });
  assert.ok(up.ok);
  const row = up.keywords[1]!;
  assert.equal(row.requirement, 'nice', "the model's own verdict is never overwritten");
  assert.equal(effectiveRequirement(row), 'must');

  const back = editKeyword(up.keywords, { op: 'level', term: 'ping-pong table', requirement: 'nice' });
  assert.ok(back.ok);
  assert.equal(back.keywords[1]?.override, undefined, 'the model level again means no override at all');
});

test('an alias addresses the same row as the term', () => {
  const list = [kw({ term: 'PostgreSQL', aliases: ['postgres'] })];
  const r = editKeyword(list, { op: 'ignore', term: 'POSTGRES' });
  assert.ok(r.ok);
  assert.equal(r.term, 'PostgreSQL');
  assert.ok(isIgnored(r.keywords[0]!));
});

test('an unknown term is refused rather than silently added', () => {
  const r = editKeyword(LIST, { op: 'ignore', term: 'Kafka' });
  assert.equal(r.ok, false);
});

test('ignore drops the row from the effective list; restore brings it back', () => {
  const off = editKeyword(LIST, { op: 'ignore', term: 'ping-pong table' });
  assert.ok(off.ok);
  assert.equal(effectiveKeywords(off.keywords).length, 1);
  assert.equal(off.keywords.length, 2, 'the row stays stored so the user can undo it');

  const on = editKeyword(off.keywords, { op: 'restore', term: 'ping-pong table' });
  assert.ok(on.ok);
  assert.equal(effectiveKeywords(on.keywords).length, 2);
});

test('ignoring a keyword raises the score without touching the formula', () => {
  const alignment = { title: 'strong', summary: 'strong', recent_role: 'strong' } as const;
  const list = [
    kw({ term: 'Laravel', requirement: 'must', primary: true, status: 'present' }),
    kw({ term: 'ping-pong table', requirement: 'must', status: 'cannot_claim' }),
  ];
  const before = scoreMatch(effectiveKeywords(list), alignment, 0);
  const after = scoreMatch(
    effectiveKeywords((editKeyword(list, { op: 'ignore', term: 'ping-pong table' }) as { keywords: MatchKeyword[] }).keywords),
    alignment,
    0,
  );
  assert.ok(after.score > before.score, `${before.score} → ${after.score}`);
});

test('reset clears an override on a model row and deletes a row the user added', async () => {
  const added = addKeyword(LIST, { term: 'Kafka', requirement: 'must' }, await context());
  assert.ok(added.ok);
  const levelled = editKeyword(added.keywords, { op: 'level', term: 'Laravel', requirement: 'nice' });
  assert.ok(levelled.ok);

  const clean = editKeyword(levelled.keywords, { op: 'reset', term: 'Laravel' });
  assert.ok(clean.ok);
  assert.equal(clean.keywords[0]?.override, undefined);
  assert.equal(effectiveRequirement(clean.keywords[0]!), 'must');

  const gone = editKeyword(clean.keywords, { op: 'reset', term: 'Kafka' });
  assert.ok(gone.ok);
  assert.equal(gone.keywords.length, LIST.length);
  assert.equal(gone.removed, true, 'the row is gone, not reverted — the flash has to say so');
});

test('an added term reads its status from the resume, never from a guess', async () => {
  const known = addKeyword(LIST, { term: 'Docker', requirement: 'must' }, await context());
  assert.ok(known.ok);
  const docker = known.keywords.at(-1)!;
  assert.equal(docker.status, 'present', 'written in the resume');
  assert.equal(docker.override?.added, true);
  assert.equal(docker.unanchored, undefined, 'the posting says Docker too');

  const missing = addKeyword(LIST, { term: 'Kafka', requirement: 'must' }, await context());
  assert.ok(missing.ok);
  assert.equal(missing.keywords.at(-1)?.status, 'ask_user', 'not in the resume — a question, not a claim');
});

test('an added term the posting never mentions is flagged unanchored', async () => {
  const r = addKeyword(LIST, { term: 'Kubernetes', requirement: 'nice' }, await context());
  assert.ok(r.ok);
  assert.equal(r.keywords.at(-1)?.unanchored, true);
});

test('an added term picks up the alias table, so k8s finds Kubernetes', async () => {
  const r = addKeyword([], { term: 'k8s', requirement: 'nice' }, await context('Ran Kubernetes in prod.'));
  assert.ok(r.ok);
  assert.equal(r.keywords[0]?.status, 'present');
});

test('a duplicate is refused, and an ignored duplicate says so', async () => {
  const dup = addKeyword(LIST, { term: 'laravel', requirement: 'must' }, await context());
  assert.equal(dup.ok, false);
  const off = editKeyword(LIST, { op: 'ignore', term: 'Laravel' });
  assert.ok(off.ok);
  const again = addKeyword(off.keywords, { term: 'Laravel', requirement: 'must' }, await context());
  assert.equal(again.ok, false);
  assert.match((again as { error: string }).error, /restore/);
});

test('an empty term is refused, and so is one too long to match anything', async () => {
  const ctx = await context();
  assert.equal(addKeyword(LIST, { term: '   ', requirement: 'must' }, ctx).ok, false);
  const long = addKeyword(LIST, { term: 'x'.repeat(61), requirement: 'must' }, ctx);
  assert.equal(long.ok, false, 'refused, not silently truncated to something that highlights nowhere');
});

/* ---------- carrying overrides into the next run ---------- */

test('the next run gets the stored levels and exclusions back', async () => {
  const previous: MatchKeyword[] = [
    kw({ term: 'Laravel', requirement: 'must', override: { requirement: 'nice' } }),
    kw({ term: 'ping-pong table', requirement: 'nice', override: { excluded: true } }),
    kw({ term: 'Docker', requirement: 'preferred' }),
  ];
  const fresh: MatchKeyword[] = [
    kw({ term: 'Laravel', requirement: 'must' }),
    kw({ term: 'ping-pong table', requirement: 'preferred' }),
    kw({ term: 'Docker', requirement: 'must' }),
  ];
  const r = carryOverrides(fresh, previous, await context());
  assert.equal(r.carried, 2);
  assert.equal(r.readded, 0);
  assert.equal(effectiveRequirement(r.keywords[0]!), 'nice');
  assert.ok(isIgnored(r.keywords[1]!));
  assert.equal(r.keywords[2]?.override, undefined, 'a row the user never touched carries nothing');
});

test('a hand-added term the model did not repeat comes back, re-read against the new resume', async () => {
  const previous = (addKeyword([], { term: 'Kafka', requirement: 'must' }, await context()) as { keywords: MatchKeyword[] }).keywords;
  assert.equal(previous[0]?.status, 'ask_user');
  const r = carryOverrides([kw({ term: 'Laravel' })], previous, await context(`${RESUME} Also ran Kafka.`));
  assert.equal(r.readded, 1);
  assert.equal(r.keywords.at(-1)?.term, 'Kafka');
  assert.equal(r.keywords.at(-1)?.status, 'present', 'written in since the last run');
  assert.equal(r.keywords.at(-1)?.override?.added, true);
});

test('when the model finally lists a hand-added term, the row is its own but the level stays the user\'s', async () => {
  const previous = (addKeyword([], { term: 'Kafka', requirement: 'must' }, await context()) as { keywords: MatchKeyword[] }).keywords;
  const r = carryOverrides([kw({ term: 'Kafka', requirement: 'nice', status: 'cannot_claim' })], previous, await context());
  assert.equal(r.readded, 0, 'no duplicate row');
  assert.equal(r.keywords.length, 1);
  assert.equal(r.keywords[0]?.status, 'cannot_claim', "the model's fresh verdict wins");
  assert.equal(effectiveRequirement(r.keywords[0]!), 'must', 'the level the user picked is still theirs');
  assert.equal(r.keywords[0]?.override?.added, undefined);
});

test('an override the model now agrees with is still kept — that is what makes it stick', async () => {
  const previous = [kw({ term: 'Laravel', requirement: 'must', override: { requirement: 'nice' } })];
  // The frame told the model "nice", so it says nice this time. Dropping the
  // override here would leave the level at the mercy of the next reply.
  const r = carryOverrides([kw({ term: 'Laravel', requirement: 'nice' })], previous, await context());
  assert.equal(r.keywords[0]?.override?.requirement, 'nice');
});

test('an override in the reply is stripped — only the user writes that field', async () => {
  const fresh = [kw({ term: 'Laravel', requirement: 'must', override: { excluded: true } })];
  const r = carryOverrides(fresh, [], await context());
  assert.equal(r.keywords[0]?.override, undefined);
  assert.equal(effectiveKeywords(r.keywords).length, 1, 'a prompt-injected exclusion cannot drop a must-have');
});

test('a rebuilt frame keeps every override — the machine guess resets, the human decision does not', async () => {
  // What "Rebuild keywords" produces (keyword-frame.ts): the model never saw
  // the old list, so the reply shares neither its order, its levels nor all of
  // its terms. carryOverrides reads the FULL stored row, not the frame that
  // was withheld, so all three edits still land.
  const ctx = await context();
  const previous = [
    kw({ term: 'Laravel', requirement: 'must', override: { requirement: 'nice' } }),
    kw({ term: 'ping-pong', requirement: 'nice', override: { excluded: true } }),
    ...(addKeyword([], { term: 'Kafka', requirement: 'must' }, ctx) as { keywords: MatchKeyword[] }).keywords,
  ];
  const rebuilt = [
    kw({ term: 'Docker', requirement: 'must' }),
    kw({ term: 'ping-pong', requirement: 'context' }),
    kw({ term: 'Laravel', requirement: 'must' }),
  ];
  const r = carryOverrides(rebuilt, previous, ctx);
  assert.equal(r.carried, 2);
  assert.equal(r.readded, 1, "the term the user added is not the model's to forget");
  assert.equal(effectiveRequirement(r.keywords.find((k) => k.term === 'Laravel')!), 'nice');
  assert.ok(isIgnored(r.keywords.find((k) => k.term === 'ping-pong')!));
  assert.equal(r.keywords.at(-1)?.term, 'Kafka');
  assert.equal(
    r.keywords.find((k) => k.term === 'Docker')?.override,
    undefined,
    'a term only the rebuild found arrives clean',
  );
});
