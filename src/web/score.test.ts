import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeScore as computeScoreTs,
  entriesFromKeywords,
  SCORING as SCORING_TS,
  type MatchAlignment,
  type ScoreEntry,
} from '../resume/score';

// The browser copy ships as a static ES module; node loads it the same way.
// @ts-expect-error — plain JS with no declaration file; parity is asserted below.
const browser = import('./public/score.mjs') as Promise<{
  SCORING: typeof SCORING_TS;
  computeScore: typeof computeScoreTs;
  entriesFromLive: (rows: Record<string, unknown>[]) => ScoreEntry[];
}>;

/*
 * score.mjs must stay a line-for-line mirror of score.ts (ADR 0012). These
 * fixtures run the same inputs through both implementations and demand
 * identical breakdowns — edit one file without the other and this fails.
 */

const ALIGNMENTS: (MatchAlignment | null)[] = [
  { title: 'strong', summary: 'strong', recent_role: 'strong' },
  { title: 'partial', summary: 'off', recent_role: 'partial' },
  null,
];

const ENTRY_SETS: ScoreEntry[][] = [
  [],
  [
    { requirement: 'must', primary: true, credit: 1, primaryHit: true, ceilCredit: 1, ceilPrimaryHit: true },
    { requirement: 'preferred', primary: false, credit: 0.5, primaryHit: false, ceilCredit: 1, ceilPrimaryHit: false },
    { requirement: 'nice', primary: false, credit: 0, primaryHit: false, ceilCredit: 0, ceilPrimaryHit: false },
    { requirement: 'context', primary: false, credit: 1, primaryHit: false, ceilCredit: 1, ceilPrimaryHit: false },
  ],
  [
    { requirement: 'must', primary: true, credit: 0, primaryHit: false, ceilCredit: 0, ceilPrimaryHit: false },
    { requirement: 'must', primary: true, credit: 0, primaryHit: false, ceilCredit: 1, ceilPrimaryHit: true },
    { requirement: 'must', primary: false, credit: 1, primaryHit: false, ceilCredit: 1, ceilPrimaryHit: false },
  ],
  [
    { requirement: 'must', primary: true, credit: 1, primaryHit: true, ceilCredit: 1, ceilPrimaryHit: true },
    { requirement: 'must', primary: true, credit: 0.5, primaryHit: false, ceilCredit: 1, ceilPrimaryHit: true },
    { requirement: 'must', primary: true, credit: 0, primaryHit: false, ceilCredit: 0, ceilPrimaryHit: false },
  ],
  // An either/or group (ADR 0044): three alternatives, one of them met. Both
  // sides must fold it to one must-weight and one primary slot.
  [
    { requirement: 'must', primary: true, credit: 1, primaryHit: true, ceilCredit: 1, ceilPrimaryHit: true, group: 'front-end framework' },
    { requirement: 'must', primary: true, credit: 0, primaryHit: false, ceilCredit: 0, ceilPrimaryHit: false, group: 'front-end framework' },
    { requirement: 'must', primary: false, credit: 0, primaryHit: false, ceilCredit: 0, ceilPrimaryHit: false, group: 'Front-End Framework ' },
    { requirement: 'preferred', primary: false, credit: 0, primaryHit: false, ceilCredit: 1, ceilPrimaryHit: false, group: null },
  ],
];

test('score.mjs computeScore agrees with score.ts on every fixture', async () => {
  const { computeScore, SCORING } = await browser;
  assert.deepEqual(SCORING, SCORING_TS);
  for (const entries of ENTRY_SETS) {
    for (const alignment of ALIGNMENTS) {
      for (const flags of [0, 1, 3]) {
        assert.deepEqual(
          computeScore(entries, alignment, flags),
          computeScoreTs(entries, alignment, flags),
          `entries=${JSON.stringify(entries)} alignment=${JSON.stringify(alignment)} flags=${flags}`,
        );
        assert.deepEqual(
          computeScore(entries, alignment, flags, 10),
          computeScoreTs(entries, alignment, flags, 10),
          `fixedPenalty parity, flags=${flags}`,
        );
      }
    }
  }
});

test('a fixed penalty keeps the live estimate monotonic as primaries get typed in', async () => {
  const { computeScore, entriesFromLive } = await browser;
  const rows = (found: boolean) => [
    { requirement: 'must', primary: true, status: 'add', found },
    { requirement: 'must', primary: true, status: 'add', found },
    { requirement: 'must', primary: true, status: 'present', found: true },
  ];
  const alignment: MatchAlignment = { title: 'partial', summary: 'partial', recent_role: 'partial' };
  // Analysis-time: 2 primaries missing, 3 flags → offset left 1 counted → penalty 10.
  const before = computeScore(entriesFromLive(rows(false)), alignment, 3, 10);
  const after = computeScore(entriesFromLive(rows(true)), alignment, 3, 10);
  assert.equal(before.penalty, 10);
  assert.equal(after.penalty, 10);
  assert.ok(after.score > before.score, `typing primaries must raise the score (${before.score} → ${after.score})`);
  // The drift was the bug: re-deriving the offset live lifted counted flags
  // from 1 to 3 once both primaries were typed, and could LOWER the score.
  const drifted = computeScore(entriesFromLive(rows(true)), alignment, 3);
  assert.ok(drifted.penalty > after.penalty);
});

test('live entries equal server entries when the text matches the analysed snapshot', async () => {
  const { entriesFromLive, computeScore } = await browser;
  // At load time a "present" keyword is found in the text and an "add" one is
  // not — the live estimate must then equal the stored server score.
  const keywords = [
    { requirement: 'must', primary: true, status: 'present' },
    { requirement: 'must', primary: true, status: 'add' },
    { requirement: 'preferred', primary: false, status: 'ask_user' },
    { requirement: 'nice', primary: false, status: 'cannot_claim' },
  ] as const;
  const serverEntries = entriesFromKeywords(keywords.map((k) => ({ ...k })));
  const liveRows = keywords.map((k) => ({ ...k, found: k.status === 'present' }));
  const alignment: MatchAlignment = { title: 'strong', summary: 'partial', recent_role: 'strong' };
  assert.deepEqual(
    computeScore(entriesFromLive(liveRows), alignment, 1),
    computeScoreTs(serverEntries, alignment, 1),
  );
});

test('live credit: typing a cannot_claim term never counts, typing an add term earns full credit', async () => {
  const { entriesFromLive } = await browser;
  const rows = [
    { requirement: 'must', primary: true, status: 'cannot_claim', found: true },
    { requirement: 'must', primary: true, status: 'add', found: true },
    { requirement: 'must', primary: false, status: 'add', found: false },
    { requirement: 'must', primary: false, status: 'ask_user', found: true },
    { requirement: 'preferred', primary: true, status: 'present', found: true },
  ];
  const entries = entriesFromLive(rows);
  assert.deepEqual(
    entries.map((e) => [e.credit, e.primaryHit, e.ceilCredit]),
    [
      [0, false, 0], // cannot_claim: claim safety, even when typed
      [1, true, 1], // add + found: written in, counts fully and lifts the cap
      [0.5, false, 1], // add not yet written: keeps its half credit, reachable 1
      [1, false, 0], // ask_user typed: counts in text, ceiling waits for confirmation
      [1, false, 1], // preferred marked primary: demoted — never caps (v3)
    ],
  );
  assert.equal(entries[4]?.primary, false);
});

test('an either/or group is one requirement, not three (ADR 0044)', () => {
  // The live case: "frameworks like React, Next.js, or Vue.js" — the candidate
  // has React. Split into three musts it reads as one of three; as one group
  // it reads as the requirement met, which is what the posting asked.
  const grouped = entriesFromKeywords([
    { requirement: 'must', primary: true, status: 'present', group: 'front-end framework' },
    { requirement: 'must', primary: true, status: 'cannot_claim', group: 'front-end framework' },
    { requirement: 'must', primary: true, status: 'cannot_claim', group: 'front-end framework' },
  ]);
  const split = entriesFromKeywords([
    { requirement: 'must', primary: true, status: 'present' },
    { requirement: 'must', primary: true, status: 'cannot_claim' },
    { requirement: 'must', primary: true, status: 'cannot_claim' },
  ]);
  const alignment: MatchAlignment = { title: 'strong', summary: 'strong', recent_role: 'strong' };
  const one = computeScoreTs(grouped, alignment, 0);
  const three = computeScoreTs(split, alignment, 0);

  assert.equal(one.keywordTotal, 3, 'one must-weight, not three');
  assert.equal(one.primaryTotal, 1);
  assert.equal(one.primaryPresent, 1);
  assert.equal(one.cap, null, 'the primary stack is covered, so no cap');
  assert.equal(one.score, 100);

  assert.equal(three.keywordTotal, 9);
  assert.equal(three.primaryPresent, 1);
  assert.equal(three.cap, SCORING_TS.caps.underHalf, 'ungrouped, the same resume is capped at 45');
  assert.equal(three.score, 45);
});

test('a group takes the best member on every axis, and its strongest level', () => {
  const bd = computeScoreTs(
    [
      { requirement: 'nice', primary: false, credit: 0, primaryHit: false, ceilCredit: 0, ceilPrimaryHit: false, group: 'cms' },
      { requirement: 'must', primary: true, credit: 0.5, primaryHit: false, ceilCredit: 1, ceilPrimaryHit: true, group: 'cms' },
    ],
    null,
    0,
  );
  assert.equal(bd.keywordTotal, 3, 'weighted as a must — the strongest level among its members');
  assert.equal(bd.keywordEarned, 1.5, 'credited by the best member');
  assert.equal(bd.primaryTotal, 1, 'one primary slot, not two');
});

test('a keyword with no group is untouched, as every pre-v8 row is', () => {
  const rows = [
    { requirement: 'must' as const, primary: true, status: 'present' as const },
    { requirement: 'must' as const, primary: true, status: 'cannot_claim' as const },
  ];
  assert.deepEqual(computeScoreTs(entriesFromKeywords(rows), null, 0).keywordTotal, 6);
});
