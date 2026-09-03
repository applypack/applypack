import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from '@prisma/client';
import {
  buildVerdicts,
  decideDismissReason,
  mergeVerdicts,
  type ProfileVerdict,
} from './verdict-merge';
import type { ClaudeClassification } from '../types';

const classification = (fit: number, over: Partial<ClaudeClassification> = {}): ClaudeClassification => ({
  fit_score: fit,
  location_match: true,
  salary_min_usd: null,
  salary_max_usd: null,
  tech_match: [],
  red_flags: [],
  summary: `fit ${fit}`,
  ...over,
});

const verdict = (
  profileId: number,
  profileName: string,
  fit: number,
  dismissReason: ProfileVerdict['dismissReason'] = null,
  over: Partial<ProfileVerdict> = {},
): ProfileVerdict => ({
  profileId,
  profileName,
  classification: classification(fit),
  dismissReason,
  priorityRulesApplied: [],
  telegramTargetId: null,
  ...over,
});

test('the winner is the search that wanted it, not the one that scored it highest', () => {
  // 88 is the top score, but that search dismissed on a country lock; the
  // row is kept by the 71, so the 71 must be the one speaking for it.
  const merged = mergeVerdicts([
    verdict(1, 'Backend', 88, 'location-mismatch'),
    verdict(2, 'QA', 71),
  ]);
  assert.equal(merged?.winner.profileId, 2);
  assert.equal(merged?.kept, true);
});

test('among searches that want it, the highest score wins', () => {
  const merged = mergeVerdicts([
    verdict(1, 'Backend', 74),
    verdict(2, 'QA', 91),
    verdict(3, 'Platform', 12, 'low-fit'),
  ]);
  assert.equal(merged?.winner.profileId, 2);
  assert.equal(merged?.kept, true);
});

test('when every search rejects it, the best rejection speaks for the row', () => {
  const merged = mergeVerdicts([
    verdict(1, 'Backend', 44, 'low-fit'),
    verdict(2, 'QA', 66, 'location-mismatch'),
  ]);
  assert.equal(merged?.kept, false);
  assert.equal(merged?.winner.profileId, 2);
});

test('the score line names every search, best first', () => {
  const merged = mergeVerdicts([
    verdict(2, 'QA', 41),
    verdict(1, 'Backend', 87),
    verdict(3, 'Platform', 63),
  ]);
  assert.equal(merged?.scoreLine, 'Backend 87 · Platform 63 · QA 41');
});

test('ties break on profile id, so a re-classify is stable', () => {
  const a = mergeVerdicts([verdict(5, 'Later', 80), verdict(2, 'Earlier', 80)]);
  const b = mergeVerdicts([verdict(2, 'Earlier', 80), verdict(5, 'Later', 80)]);
  assert.equal(a?.winner.profileId, 2);
  assert.equal(b?.winner.profileId, 2);
  assert.equal(a?.scoreLine, b?.scoreLine);
});

test('the winner carries the routing for the alert', () => {
  const merged = mergeVerdicts([
    verdict(1, 'Backend', 55, null, { telegramTargetId: 10 }),
    verdict(2, 'QA', 90, null, { telegramTargetId: 20 }),
  ]);
  assert.equal(merged?.winner.telegramTargetId, 20);
});

test('no verdicts means no merge — never a fabricated zero', () => {
  assert.equal(mergeVerdicts([]), null);
});

/* -------------------------------------------------------------------- */

const profile = (id: number, over: Partial<Profile> = {}): Profile =>
  ({
    id,
    name: `search ${id}`,
    minFitScore: 70,
    minSalaryUsd: 0,
    priorityRules: [],
    telegramTargetId: null,
    ...over,
  }) as unknown as Profile;

const JOB = { title: 'Senior Backend Engineer', description: 'We use Laravel.', location: 'Remote, US' };

test('each search is judged against its OWN threshold', () => {
  const results = new Map([
    [1, classification(75)],
    [2, classification(75)],
  ]);
  const { verdicts } = buildVerdicts(results, [profile(1, { minFitScore: 70 }), profile(2, { minFitScore: 80 })], JOB);
  assert.equal(verdicts.find((v) => v.profileId === 1)?.dismissReason, null);
  assert.equal(verdicts.find((v) => v.profileId === 2)?.dismissReason, 'low-fit');
});

test('a search with no verdict in the reply is skipped, not defaulted to zero', () => {
  const { verdicts } = buildVerdicts(new Map([[1, classification(80)]]), [profile(1), profile(2)], JOB);
  assert.deepEqual(
    verdicts.map((v) => v.profileId),
    [1],
  );
});

test("one search's priority rule lifts only its own score", () => {
  const rules = [{ label: 'PHP remote-US floor', techsAny: ['laravel'], regionsAny: ['US'], minFitFloor: 90 }];
  const results = new Map([
    [1, classification(40, { location_match: false })],
    [2, classification(40, { location_match: false })],
  ]);
  const { verdicts, boosted } = buildVerdicts(results, [profile(1, { priorityRules: rules }), profile(2)], JOB);
  assert.equal(boosted, 1);
  assert.equal(verdicts.find((v) => v.profileId === 1)?.classification.fit_score, 90);
  assert.equal(verdicts.find((v) => v.profileId === 2)?.classification.fit_score, 40);
  // The floor forces location_match too, so only search 1 keeps the posting;
  // search 2 is still on the raw 40 and fails its own threshold first.
  assert.equal(verdicts.find((v) => v.profileId === 1)?.dismissReason, null);
  assert.equal(verdicts.find((v) => v.profileId === 2)?.dismissReason, 'low-fit');
});

test('dismiss reasons keep their order of precedence', () => {
  const p = profile(1, { minFitScore: 70, minSalaryUsd: 100_000 });
  assert.equal(decideDismissReason(classification(50), p), 'low-fit');
  assert.equal(decideDismissReason(classification(80, { location_match: false }), p), 'location-mismatch');
  assert.equal(decideDismissReason(classification(80, { salary_min_usd: 60_000 }), p), 'low-salary');
  assert.equal(decideDismissReason(classification(80, { salary_min_usd: 120_000 }), p), null);
});
