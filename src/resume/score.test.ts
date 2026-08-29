import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeScore,
  entriesFromKeywords,
  primaryCap,
  readBreakdown,
  scoreMatch,
  SCORING,
  type MatchAlignment,
} from './score';

const STRONG: MatchAlignment = { title: 'strong', summary: 'strong', recent_role: 'strong' };
const OFF: MatchAlignment = { title: 'off', summary: 'off', recent_role: 'off' };

const kw = (
  status: 'present' | 'add' | 'ask_user' | 'cannot_claim',
  requirement: 'must' | 'preferred' | 'nice' | 'context' = 'must',
  primary = false,
) => ({ status, requirement, primary });

test('perfect coverage with strong alignment and no flags is 100', () => {
  const b = scoreMatch([kw('present', 'must', true), kw('present', 'preferred')], STRONG, 0);
  assert.equal(b.score, 100);
  assert.equal(b.keywordPts, 60);
  assert.equal(b.alignmentPts, 40);
  assert.equal(b.cap, null);
});

test('statuses credit 1 / 0.5 / 0 / 0 and requirement levels weight 3 / 2 / 1 / 0', () => {
  // One must-have present (3 units) + one must-have add (1.5) of 6 must units.
  const b = scoreMatch([kw('present'), kw('add')], OFF, 0);
  assert.equal(b.keywordTotal, 6);
  assert.equal(b.keywordEarned, 4.5);
  assert.equal(b.keywordPts, 45);
  // ask_user and cannot_claim earn nothing but stay in the denominator.
  const c = scoreMatch([kw('present'), kw('ask_user'), kw('cannot_claim')], OFF, 0);
  assert.equal(c.keywordTotal, 9);
  assert.equal(c.keywordEarned, 3);
  // context keywords carry no weight at all.
  const d = scoreMatch([kw('present'), kw('present', 'context')], OFF, 0);
  assert.equal(d.keywordTotal, 3);
  assert.equal(d.keywordPts, 60);
  // nice (1) vs must (3): missing a nice-to-have hurts less than a must-have.
  const missNice = scoreMatch([kw('present'), kw('cannot_claim', 'nice')], OFF, 0);
  const missMust = scoreMatch([kw('present', 'nice'), kw('cannot_claim')], OFF, 0);
  assert.ok(missNice.keywordPts > missMust.keywordPts);
});

test('alignment grades map to 10/10/20 with half credit for partial', () => {
  const b = computeScore([], { title: 'partial', summary: 'off', recent_role: 'partial' }, 0);
  assert.equal(b.alignmentPts, 5 + 0 + 10);
  assert.equal(computeScore([], null, 0).alignmentPts, 0);
});

test('each counted red flag subtracts 10, bounded at 20, floor 0', () => {
  const b = scoreMatch([kw('present')], STRONG, 2);
  assert.equal(b.penalty, 20);
  assert.equal(b.score, 80);
  assert.equal(scoreMatch([], OFF, 5).score, 0);
  // The bound: five flags cannot dig deeper than 20 points (the treadmill fix —
  // a 97.9-point resume was stuck at 68 by three style "flags").
  const many = scoreMatch([kw('present')], STRONG, 5);
  assert.equal(many.penalty, 20);
  assert.equal(many.flagsCounted, 5);
  assert.equal(many.score, 80);
});

test('flags that restate missing primaries are not double-counted', () => {
  // 2 missing primary items, 3 flags → only the 1 extra flag costs points.
  const b = scoreMatch(
    [kw('cannot_claim', 'must', true), kw('cannot_claim', 'must', true), kw('present')],
    STRONG,
    3,
  );
  assert.equal(b.flagsCounted, 1);
  assert.equal(b.penalty, 10);
  assert.equal(b.cap, 30); // the cap still owns the stack punishment
});

test('a preferred technology never caps the score even when marked primary', () => {
  // The model marks React primary but the posting only prefers it — the code
  // guard demotes it: it still costs keyword credit, but no cap.
  const b = scoreMatch(
    [kw('present', 'must', true), kw('cannot_claim', 'preferred', true)],
    STRONG,
    0,
  );
  assert.equal(b.primaryTotal, 1);
  assert.equal(b.cap, null);
  assert.equal(b.score, 76); // 60×(3/5) + 40 — with the old behavior the cap 70 would bite
});

test('ceiling: what honest editing can reach on this posting', () => {
  // All claimable and aligned → already at the ceiling.
  const done = scoreMatch([kw('present', 'must', true)], STRONG, 0);
  assert.equal(done.ceiling, done.score);

  // "add" primaries lift the reachable cap: today 0/2 present (cap 30), but
  // both are claimable — write them in and the cap is gone.
  const addable = scoreMatch([kw('add', 'must', true), kw('add', 'must', true)], OFF, 2);
  assert.equal(addable.cap, 30);
  assert.equal(addable.flagsCounted, 0); // both flags restate the missing primaries
  assert.equal(addable.ceiling, 100);

  // cannot_claim keeps the ceiling down — no edit invents experience.
  const honest = scoreMatch([kw('present'), kw('cannot_claim')], OFF, 0);
  assert.equal(honest.ceiling, Math.round(30 + 40));

  // The ceiling never sits below the score.
  const capped = scoreMatch([kw('present', 'must', true), kw('ask_user', 'must', true)], STRONG, 0);
  assert.ok((capped.ceiling ?? 0) >= capped.score);
});

test('treadmill regression: the real 68-ceiling resume now scores its work', () => {
  // Match 24 shape from the real DB: 16 must present, 4 preferred present,
  // 1 preferred ask_user, 1 context cannot_claim, primary 3/3, alignment all
  // strong, 3 soft "red flags". Old scoring: 97.9 raw − 30 = 68 forever.
  const keywords = [
    ...Array.from({ length: 3 }, () => kw('present', 'must', true)),
    ...Array.from({ length: 13 }, () => kw('present', 'must')),
    ...Array.from({ length: 4 }, () => kw('present', 'preferred')),
    kw('ask_user', 'preferred'),
    kw('cannot_claim', 'context'),
  ];
  const b = scoreMatch(keywords, STRONG, 3);
  assert.equal(b.keywordPts, 57.9);
  assert.equal(b.penalty, 20); // bounded — was 30
  assert.equal(b.score, 78); // was 68
  // Confirming the ask lifts the ceiling further; here it caps at 80.
  assert.equal(b.ceiling, 78);
});

test('primary-stack gate: the cap is absolute and comes last', () => {
  assert.equal(primaryCap(0, 3), SCORING.caps.none);
  assert.equal(primaryCap(1, 3), SCORING.caps.underHalf);
  assert.equal(primaryCap(2, 3), SCORING.caps.halfOrMore);
  assert.equal(primaryCap(3, 3), null);
  assert.equal(primaryCap(0, 0), null);

  // Laravel resume vs Node posting (gotcha 11): everything else perfect, still ≤30.
  const b = scoreMatch(
    [kw('cannot_claim', 'must', true), kw('cannot_claim', 'must', true), kw('present', 'preferred')],
    STRONG,
    0,
  );
  assert.equal(b.cap, 30);
  assert.equal(b.score, 30);

  // "add" on a primary item does not lift the cap — only "present" counts.
  const c = scoreMatch([kw('add', 'must', true), kw('present', 'must', true)], STRONG, 0);
  assert.equal(c.primaryPresent, 1);
  assert.equal(c.cap, SCORING.caps.halfOrMore);
});

test('no keywords means no keyword points, not free points', () => {
  const b = scoreMatch([], STRONG, 0);
  assert.equal(b.keywordPts, 0);
  assert.equal(b.score, 40);
});

test('entriesFromKeywords mirrors status credit, primary hits and reachable credit', () => {
  const entries = entriesFromKeywords([
    kw('add', 'must', true),
    kw('present', 'nice', true), // primary on a nice-to-have is demoted
    kw('ask_user', 'must'),
  ]);
  assert.deepEqual(
    entries.map((e) => [e.credit, e.primary, e.primaryHit, e.ceilCredit]),
    [
      [0.5, true, false, 1],
      [1, false, true, 1],
      [0, false, false, 0],
    ],
  );
});

test('readBreakdown roundtrips and rejects the legacy empty object', () => {
  const b = scoreMatch([kw('present')], STRONG, 1);
  const back = readBreakdown(JSON.parse(JSON.stringify(b)));
  assert.deepEqual(back, b);
  assert.equal(readBreakdown({}), null);
  assert.equal(readBreakdown(undefined), null);
});
