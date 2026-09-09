import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sideBySide } from './screen-compare';
import { RubricSchema, specOf, type Criterion, type Rubric } from '../screening/rubric';
import type { ApplicantWithVerdict } from '../screening/store';

const c = (id: string, kind: Criterion['kind'], label: string, mode: Criterion['mode'], spec: Partial<Criterion['spec']> = {}): Criterion =>
  ({ id, kind, label, mode, weight: 3, source: 'you', spec: specOf(spec) });
const RUBRIC: Rubric = RubricSchema.parse({
  criteria: [c('g', 'authorization', 'EU', 'gate', { items: ['EU'] }), c('php', 'skill', 'PHP', 'scored', { terms: [{ term: 'PHP', aliases: [] }] }), c('node', 'skill', 'Node.js', 'scored', { terms: [{ term: 'Node.js', aliases: [] }] })],
});

function applicant(id: number, number: number, score: number, rows: object[], stale = false): ApplicantWithVerdict {
  return {
    id,
    screeningId: 1,
    number,
    name: `A${number}`,
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
    scoreAdjustment: number === 2 ? 10 : 0,
    adjustmentNote: null,
    createdAt: new Date(0),
    stale,
    verdict: {
      id,
      applicantId: id,
      rubricVersion: 1,
      promptVersion: 3,
      model: 'm',
      facts: {
        summary: { who: '', did: '', verdict: `talk to ${number}` },
        roles: [{ position: 'Dev', employer: 'Acme', start: '2020', end: 'Present', relevant: true, why: '', sector: 'fintech', companyType: null }],
        answers: [],
        standout: [{ fact: `fact ${number}`, quote: 'q' }],
        questions: [],
        risks: [],
        consistency: [],
        injection: false,
      },
      breakdown: {
        v: 2,
        score,
        cap: null,
        capReason: null,
        rows,
        weightTotal: 3,
        gateBucket: 'pass',
        gatesFailed: [],
        gatesUnknown: [],
        skillsCovered: 1,
        skillsStrong: 1,
        skillsTotal: 2,
        coreCovered: 0,
        coreTotal: 0,
        years: 4,
        recentMonths: 0,
        level: 'mid',
        confidence: { value: 0.8, band: 'high', answered: 2, total: 3, thin: false },
      },
      score,
      confidence: 'high',
      gateBucket: 'pass',
      createdAt: new Date(0),
    },
  };
}
const row = (id: string, answer: string, quote: string | null) => ({ id, kind: 'skill', label: id, mode: 'scored', weight: 3, credit: 1, pts: 3, max: 3, gate: null, answer, quote, detail: '', question: null });

test('sideBySide aligns the stored rows by criterion and leaves out a stale verdict', () => {
  const view = sideBySide(
    RUBRIC,
    [applicant(1, 1, 80, [row('g', 'pass', 'EU passport'), row('php', 'production', 'shipped PHP')]), applicant(2, 2, 60, [row('php', 'listed', null)]), applicant(3, 3, 90, [], true)],
    new Date('2026-09-09T00:00:00Z'),
  );
  assert.deepEqual(view.columns.map((x) => [x.number, x.score, x.adjusted, x.career, x.standout, x.verdictLine]), [
    [1, 80, 80, '6.8 years across 1 employer · average stay 6.8 years · in a role now · fintech', ['fact 1'], 'talk to 1'],
    [2, 60, 70, '6.8 years across 1 employer · average stay 6.8 years · in a role now · fintech', ['fact 2'], 'talk to 2'],
  ]);
  assert.deepEqual(view.rows.map((r) => [r.id, r.cells.map((cell) => cell?.answer ?? null)]), [
    ['g', ['pass', null]],
    ['php', ['production', 'listed']],
    ['node', [null, null]],
  ]);
});
