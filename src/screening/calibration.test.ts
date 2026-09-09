import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, calibrationLine, type CalibrationRow } from './calibration';
import { RubricSchema, specOf, type Criterion, type Rubric } from './rubric';

const c = (id: string, kind: Criterion['kind'], label: string, mode: Criterion['mode'], weight: number, spec: Partial<Criterion['spec']> = {}): Criterion =>
  ({ id, kind, label, mode, weight, source: 'you', spec: specOf(spec) });
const RUBRIC: Rubric = RubricSchema.parse({
  criteria: [
    c('eu', 'authorization', 'EU work permit', 'gate', 3, { items: ['EU'] }),
    c('php', 'skill', 'PHP', 'scored', 5, { terms: [{ term: 'PHP', aliases: [] }], core: true }),
    c('vue', 'skill', 'Vue', 'scored', 3, { terms: [{ term: 'Vue', aliases: [] }] }),
    c('lead', 'custom', 'has led a team', 'scored', 2, { question: 'has led a team', answer: 'yesno' }),
  ],
});
const row = (number: number, position: number, decision: CalibrationRow['decision'], credits: Record<string, number | null>, over: Partial<CalibrationRow> = {}): CalibrationRow => ({
  number,
  position,
  computedPosition: position,
  decision,
  score: 100 - position * 10,
  adjusted: 100 - position * 10,
  bucket: 'pass',
  credits,
  answers: Object.fromEntries(Object.entries(credits).map(([k, v]) => [k, v === null ? '?' : v >= 0.8 ? 'production' : v >= 0.5 ? 'in a role' : 'skills list'])),
  gates: { eu: 'pass' },
  ...over,
});

test('too few decisions: the card only asks for them', () => {
  const cal = calibrate([row(1, 1, 'interview', { php: 1 }), row(2, 2, null, { php: 1 })], RUBRIC);
  assert.equal(cal.enough, false);
  assert.match(calibrationLine(cal), /1 decision so far; at least 3/);
  assert.match(calibrationLine(calibrate([], RUBRIC)), /Decide on at least 3 applicants/);
});

test('pairs, the top, the surprises and the separations', () => {
  const rows = [
    row(1, 1, 'interview', { php: 1, vue: 1, lead: 1 }),
    row(2, 2, 'declined', { php: 1, vue: 0.8, lead: 0 }),
    row(3, 3, 'hold', { php: 0.8, vue: 0.3, lead: null }),
    row(4, 4, 'interview', { php: 0.3, vue: 0, lead: 1 }, { gates: { eu: 'unknown' }, computedPosition: 5 }),
    row(5, 5, null, { php: 0.3, vue: 0.3, lead: 0 }, { computedPosition: 4 }),
    row(6, 6, 'declined', { php: 0, vue: 0, lead: 0 }),
  ];
  const cal = calibrate(rows, RUBRIC);
  assert.equal(cal.enough, true);
  assert.deepEqual(cal.decided, { interview: 2, hold: 1, declined: 2 });
  // Pairs the person ranked: (1>2) ok, (1>3) ok, (1>6) ok, (4>2) wrong, (4>3) wrong, (4>6) ok, (3>2) wrong, (3>6) ok.
  assert.deepEqual(cal.pairs, { concordant: 5, discordant: 3, fixedByAdjustment: 0 });
  assert.equal(cal.agreement, 0.63);
  assert.deepEqual(cal.top, { k: 2, hit: 1 });
  assert.deepEqual(
    cal.surprises.map((s) => [s.number, s.position, s.decision, s.why]),
    [
      [2, 2, 'declined', ['PHP: production', 'Vue: production']],
      [4, 4, 'interview', ['EU work permit: unknown', 'PHP: skills list', 'Vue: skills list']],
    ],
    'a declined applicant high in the table, an interview pick below the top 2, each with the criteria behind it',
  );
  assert.deepEqual(
    cal.separations.map((s) => [s.id, s.interviewed, s.declined, s.gap]),
    [
      ['lead', 1, 0, 1],
      ['php', 0.65, 0.5, 0.15],
      ['vue', 0.5, 0.4, 0.1],
    ],
    'the widest gap first: leading a team separates the picks, PHP barely does',
  );
  assert.equal(calibrationLine(cal), "1 of your 2 To interview sit in the table's top 2; the table orders 63% of your pairs the way you decided (5 of 8).");
});

test('an adjustment that moved a pick into order is counted', () => {
  const rows = [
    row(1, 1, 'interview', { php: 1 }, { computedPosition: 2 }),
    row(2, 2, 'declined', { php: 1 }, { computedPosition: 1 }),
    row(3, 3, 'declined', { php: 0 }),
  ];
  const cal = calibrate(rows, RUBRIC);
  assert.deepEqual(cal.pairs, { concordant: 2, discordant: 0, fixedByAdjustment: 1 });
  assert.match(calibrationLine(cal), /1 of those only after your adjustments\.$/);
});
