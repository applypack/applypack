import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedScore, exportRows, groupRows, rowView } from './screen-view';
import type { ApplicantWithVerdict } from '../screening/store';

function applicant(over: Partial<ApplicantWithVerdict> & { verdict?: ApplicantWithVerdict['verdict'] }): ApplicantWithVerdict {
  return {
    id: 1,
    screeningId: 1,
    number: 1,
    name: 'A',
    email: null,
    phone: null,
    sourceFilename: 'a.pdf',
    mimeType: 'application/pdf',
    text: 'x',
    redactedText: 'x',
    redactions: [],
    parseStatus: 'ok',
    parseNote: null,
    textHash: 'h',
    simhash: null,
    decision: null,
    decidedAt: null,
    sameAsId: null,
    scoreAdjustment: 0,
    adjustmentNote: null,
    createdAt: new Date(0),
    verdict: null,
    stale: false,
    ...over,
  };
}

function verdict(score: number, bucket: 'pass' | 'ask' | 'fail', rubricVersion = 1): NonNullable<ApplicantWithVerdict['verdict']> {
  return {
    id: 1,
    applicantId: 1,
    rubricVersion,
    promptVersion: 1,
    model: 'm',
    facts: {
      summary: { who: 'w', did: 'd', verdict: 'talk first' },
      gates: [{ gate: 'EU', status: bucket === 'fail' ? 'fail' : bucket === 'ask' ? 'unknown' : 'pass', quote: null, question: null }],
      must: [
        { term: 'PHP', level: 'production', quote: null, last_used: null },
        { term: 'MySQL', level: 'listed', quote: null, last_used: null },
        { term: 'Node.js', level: 'role', quote: null, last_used: null },
      ],
      nice: [],
      roles: [],
      level: { observed: 'senior', signals: [] },
      impact: { grade: 'ok', quotes: [] },
      domain: { grade: 'unknown', why: '' },
      education: { status: 'unknown', note: null },
      questions: ['q'],
      risks: ['r'],
      consistency: [],
      injection: false,
    },
    breakdown: {
      v: 1,
      score,
      cap: null,
      capReason: null,
      parts: Object.fromEntries(['must', 'years', 'level', 'impact', 'domain', 'nice', 'education'].map((p) => [p, { pts: 0, max: 0, credit: null, detail: '' }])),
      weightTotal: 0,
      gateBucket: bucket,
      gatesFailed: [],
      gatesUnknown: [],
      mustCovered: 2,
      mustTotal: 3,
      primaryCovered: 1,
      primaryTotal: 1,
      years: 4,
      recentMonths: 2,
      confidence: { value: 0.8, band: 'high', answered: 4, total: 5, thin: false },
    },
    score,
    confidence: 'high',
    gateBucket: bucket,
    createdAt: new Date(0),
  };
}

test('rowView reads the stored verdict; groupRows orders by the adjusted score and separates', () => {
  const rows = [
    applicant({ id: 1, number: 1, verdict: verdict(70, 'pass'), scoreAdjustment: 30, adjustmentNote: 'referral' }),
    applicant({ id: 2, number: 2, verdict: verdict(90, 'ask') }),
    applicant({ id: 3, number: 3, verdict: verdict(95, 'pass') }),
    applicant({ id: 4, number: 4, verdict: verdict(60, 'pass', 1), stale: true }),
    applicant({ id: 5, number: 5, parseStatus: 'unreadable', parseNote: 'scan' }),
    applicant({ id: 6, number: 6 }),
  ].map(rowView);
  assert.equal(rows[0]!.verdict?.level, 'senior');
  assert.equal(rows[0]!.verdict?.mustStrong, 2, 'role and production count as strong, a skills line does not');
  const g = groupRows(rows);
  assert.deepEqual(g.scored.map((r) => r.number), [1, 3, 2], 'pass bucket by the adjusted score (70 + 30 = 100), then ask');
  assert.equal(adjustedScore(95, 30), 100, 'held to 100');
  assert.equal(adjustedScore(10, -30), 0);
  assert.deepEqual(g.pending.map((r) => r.number), [4, 6], 'stale and never-scored wait together');
  assert.deepEqual(g.unread.map((r) => r.number), [5]);
  const ex = exportRows(rows);
  assert.deepEqual(ex.map((r) => [r.number, r.score, r.note]), [
    [1, 70, null],
    [3, 95, null],
    [2, 90, null],
    [4, null, 'scored under an earlier rubric'],
    [6, null, 'not scored yet'],
    [5, null, 'scan'],
  ]);
});
