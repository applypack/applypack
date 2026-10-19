import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedScore, calibrationRows, consistentVerdict, exportRows, extendedRetention, groupRows, rowView, scoredBeforePosting } from './screen-view';
import type { ApplicantWithVerdict } from '../screening/store';
import { trajectoryLine } from '../screening/trajectory';
import { formatDateShort } from './format';
import { offeredLocales, withLocale } from '../i18n/locale';
import { t } from '../i18n/t';

function applicant(over: Partial<ApplicantWithVerdict & { letters: number }> & { verdict?: ApplicantWithVerdict['verdict'] }): ApplicantWithVerdict & { letters: number } {
  return {
    id: 1,
    letters: 0,
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
  const gate = bucket === 'fail' ? 'fail' : bucket === 'ask' ? 'unknown' : 'pass';
  return {
    id: 1,
    applicantId: 1,
    rubricVersion,
    promptVersion: 2,
    model: 'm',
    facts: {
      summary: { who: 'w', did: 'd', verdict: 'talk first' },
      roles: [
        { position: 'Dev', employer: 'Acme', start: '2021', end: 'Present', relevant: true, why: '', sector: 'fintech', companyType: 'product' },
        { position: 'Dev', employer: 'Beta', start: '2018', end: '2020', relevant: true, why: '', sector: 'retail', companyType: null },
      ],
      standout: [{ fact: 'Speaks Polish', quote: 'Polish C1' }],
      answers: [
        { id: 'g', status: gate, quote: null, question: null },
        { id: 'php', rung: 'production' },
        { id: 'sql', rung: 'listed' },
        { id: 'node', rung: 'role' },
      ],
      questions: ['q'],
      risks: ['r'],
      consistency: [],
      injection: false,
    },
    breakdown: {
      v: 2,
      score,
      cap: null,
      capReason: null,
      rows: [
        { id: 'g', kind: 'authorization', label: 'EU', mode: 'gate', weight: 3, credit: null, pts: 0, max: 0, gate, answer: gate, quote: null, detail: '', question: null },
        { id: 'php', kind: 'skill', label: 'PHP', mode: 'scored', weight: 3, credit: 1, pts: 3, max: 3, gate: null, answer: 'production', quote: null, detail: '', question: null },
      ],
      weightTotal: 3,
      gateBucket: bucket,
      gatesFailed: [],
      gatesUnknown: [],
      skillsCovered: 3,
      skillsStrong: 2,
      skillsTotal: 3,
      coreCovered: 1,
      coreTotal: 1,
      years: 4,
      recentMonths: 2,
      level: 'senior',
      confidence: { value: 0.8, band: 'high', answered: 4, total: 5, thin: false },
    },
    score,
    confidence: 'high',
    gateBucket: bucket,
    createdAt: new Date(0),
  };
}

test('scoredBeforePosting counts verdicts older than the posting edit', () => {
  const rows = [{ scoredAt: new Date('2026-09-09T10:00:00Z') }, { scoredAt: new Date('2026-09-09T12:00:00Z') }, { scoredAt: null }];
  assert.equal(scoredBeforePosting(rows, null), 0, 'no edit, nothing stale');
  assert.equal(scoredBeforePosting(rows, new Date('2026-09-09T11:00:00Z')), 1);
  assert.equal(scoredBeforePosting(rows, new Date('2026-09-09T13:00:00Z')), 2);
});

test('the verdict never names another bucket than the gates reached (#566)', () => {
  const bd = (gateBucket: 'pass' | 'ask' | 'fail', gatesUnknown: string[] = [], gatesFailed: string[] = []) => ({ gateBucket, gatesUnknown, gatesFailed });
  assert.deepEqual(consistentVerdict('Priority to talk to: strong payments work.', bd('pass')), { text: 'Priority to talk to: strong payments work.', modelWritten: true });
  assert.deepEqual(consistentVerdict('Priority to talk to.', bd('ask', ['EU work authorisation', 'German B2'])), {
    text: 'Ask about EU work authorisation and German B2 before scheduling.',
    modelWritten: false,
  });
  assert.deepEqual(consistentVerdict('Ask about the notice period before scheduling.', bd('fail', [], ['5+ years: backend'])), {
    text: 'Not this position: 5+ years: backend not met.',
    modelWritten: false,
  });
  assert.deepEqual(consistentVerdict('Not this position: no Java.', bd('pass')), { text: 'Priority to talk to: every gate passed.', modelWritten: false });
  assert.equal(consistentVerdict('Ask about the notice period first.', bd('ask', ['Notice'])).modelWritten, true, 'the same bucket keeps the model\'s words');
  assert.equal(consistentVerdict('Strong on payments; thin on Kafka.', bd('fail', [], ['x'])).modelWritten, true, 'a verdict that names no bucket stays');
});

test('Keep 90 more days adds to the date the screening is kept until, not to today (#554)', () => {
  const now = new Date('2026-10-18T09:00:00Z');
  const fresh = new Date('2027-01-16T09:00:00Z');
  assert.equal(extendedRetention(fresh, 90, now).toISOString(), '2027-04-16T09:00:00.000Z', 'a new screening, kept 90 days from creation, gains 90 more');
  assert.equal(extendedRetention(new Date('2026-10-01T00:00:00Z'), 90, now).toISOString(), '2027-01-16T09:00:00.000Z', 'a date already gone counts from today');
  // The flash writes the date as the header does, and an abbreviated month ("17 квіт.") ends it without a second dot.
  for (const locale of offeredLocales()) {
    withLocale(locale, () => {
      for (let month = 0; month < 12; month++) {
        const date = formatDateShort(new Date(Date.UTC(2027, month, 17)));
        const flash = t('screenRoute.kept', { date });
        assert.ok(flash.includes(date) && !flash.endsWith('..'), `${locale}: ${flash}`);
      }
    });
  }
});

test('rowView reads the stored verdict; groupRows orders by the adjusted score and separates', () => {
  const rows = [
    applicant({ id: 1, number: 1, verdict: verdict(70, 'pass'), scoreAdjustment: 30, adjustmentNote: 'referral' }),
    applicant({ id: 2, number: 2, verdict: verdict(90, 'ask') }),
    applicant({ id: 3, number: 3, verdict: verdict(95, 'pass') }),
    applicant({ id: 4, number: 4, verdict: verdict(60, 'pass', 1), stale: true }),
    applicant({ id: 5, number: 5, parseStatus: 'unreadable', parseNote: 'scan' }),
    applicant({ id: 6, number: 6 }),
    applicant({ id: 7, number: 7, parseStatus: 'held', parseNote: 'Held for a look: after redaction the leak check still found email.' }),
  ].map((a) => rowView(a, new Date('2026-09-09T00:00:00Z')));
  assert.equal(rows[0]!.verdict?.level, 'senior');
  assert.deepEqual(rows[0]!.verdict?.standout, [{ fact: 'Speaks Polish', quote: 'Polish C1' }]);
  assert.equal(trajectoryLine(rows[0]!.verdict!.career), '8.8 years across 2 employers · average stay 4.4 years · in a role now · fintech, retail');
  assert.equal(rows[0]!.verdict?.mustStrong, 2, 'the breakdown counts the skills in a role or in production');
  assert.deepEqual(rows[0]!.verdict?.gates, [{ gate: 'EU', status: 'pass' }], 'gates are the gate-mode rows');
  const g = groupRows(rows);
  assert.deepEqual(g.scored.map((r) => r.number), [1, 3, 2], 'pass bucket by the adjusted score (70 + 30 = 100), then ask');
  assert.equal(adjustedScore(95, 30), 100, 'held to 100');
  assert.equal(adjustedScore(10, -30), 0);
  assert.deepEqual(g.pending.map((r) => r.number), [4, 6], 'stale and never-scored wait together');
  assert.deepEqual(g.held.map((r) => r.number), [7], 'held for a look is neither pending nor unreadable (TASKS E4)');
  assert.deepEqual(g.unread.map((r) => r.number), [5]);
  const ex = exportRows(rows);
  assert.deepEqual(ex.map((r) => [r.number, r.score, r.note]), [
    [1, 70, null],
    [3, 95, null],
    [2, 90, null],
    [4, null, 'scored under an earlier rubric'],
    [6, null, 'not scored yet'],
    [7, null, 'Held for a look: after redaction the leak check still found email.'],
    [5, null, 'scan'],
  ]);
  assert.deepEqual(ex[0]!.standout, ['Speaks Polish']);
  assert.equal(ex[0]!.career, trajectoryLine(rows[0]!.verdict!.career));
  assert.deepEqual([ex[3]!.standout, ex[3]!.career], [[], null], 'a stale verdict exports neither');
});

test('calibrationRows carries the table order, the computed order and every criterion', () => {
  const rows = calibrationRows(
    [
      applicant({ id: 1, number: 1, verdict: verdict(70, 'pass'), scoreAdjustment: 30, decision: 'interview' }),
      applicant({ id: 2, number: 2, verdict: verdict(90, 'pass'), decision: 'declined' }),
      applicant({ id: 3, number: 3 }),
    ],
    new Date('2026-09-09T00:00:00Z'),
  );
  assert.deepEqual(
    rows.map((r) => [r.number, r.position, r.computedPosition, r.decision, r.score, r.adjusted, r.credits, r.gates, r.answers.php]),
    [
      [1, 1, 2, 'interview', 70, 100, { php: 1 }, { g: 'pass' }, 'production'],
      [2, 2, 1, 'declined', 90, 90, { php: 1 }, { g: 'pass' }, 'production'],
    ],
    'the adjusted order puts №1 first, the computed order №2; the unscored row is left out',
  );
});
