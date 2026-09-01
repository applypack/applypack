import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calibration,
  foldJob,
  funnel,
  groupByJob,
  velocity,
  type StageEventRow,
} from './stats';

let seq = 0;
const ev = (
  jobId: number,
  toStage: string | null,
  occurredOn: string,
  source: 'ui' | 'backfill' | 'correction' = 'ui',
): StageEventRow => ({
  jobId,
  toStage,
  occurredOn: new Date(`${occurredOn}T00:00:00.000Z`),
  recordedAt: new Date(2026, 0, 1, 0, 0, ++seq),
  source,
});

test('foldJob: a cleared stage voids the run before it', () => {
  const h = foldJob([
    ev(1, 'offer', '2026-05-01'), // mis-click
    ev(1, null, '2026-05-01', 'correction'),
    ev(1, 'applied', '2026-05-02'),
  ]);
  assert.equal(h.maxRank, 0); // the offer is gone
  assert.equal(h.dates.has('offer'), false);
});

test('foldJob: backfill rows reach stages but carry no dates', () => {
  const h = foldJob([ev(2, 'screen', '2026-05-01', 'backfill')]);
  assert.equal(h.maxRank, 1);
  assert.equal(h.dates.size, 0);
});

test('foldJob: terminal comes from the last event only', () => {
  const rejectedThenMoved = foldJob([
    ev(3, 'applied', '2026-05-01'),
    ev(3, 'rejected', '2026-05-03'),
  ]);
  assert.equal(rejectedThenMoved.terminal, 'rejected');

  const stillGoing = foldJob([
    ev(4, 'applied', '2026-05-01'),
    ev(4, 'screen', '2026-05-03'),
  ]);
  assert.equal(stillGoing.terminal, null);
});

test('funnel: ever-reached is monotone and terminals are counted', () => {
  const rows = [
    ev(1, 'offer', '2026-05-10'), // implies applied..onsite
    ev(2, 'applied', '2026-05-01'),
    ev(2, 'rejected', '2026-05-05'),
    ev(3, 'applied', '2026-05-01'),
  ];
  const f = funnel(groupByJob(rows).values());
  assert.deepEqual(
    f.rows.map((r) => [r.stage, r.everReached]),
    [
      ['applied', 3],
      ['screen', 1],
      ['tech', 1],
      ['onsite', 1],
      ['offer', 1],
    ],
  );
  assert.equal(f.rejected, 1);
  assert.equal(f.ghosted, 0);
  assert.equal(f.inFlight, 2);
});

test('velocity: median over positive-day hops, same-day counted apart', () => {
  const rows = [
    ev(1, 'applied', '2026-05-01'),
    ev(1, 'screen', '2026-05-04'), // 3 days
    ev(2, 'applied', '2026-05-01'),
    ev(2, 'screen', '2026-05-08'), // 7 days
    ev(3, 'applied', '2026-05-01'),
    ev(3, 'screen', '2026-05-01'), // same-day: excluded, counted
  ];
  const hops = velocity(groupByJob(rows).values());
  const applied2screen = hops.find((h) => h.from === 'applied' && h.to === 'screen')!;
  assert.equal(applied2screen.medianDays, 5);
  assert.equal(applied2screen.n, 2);
  assert.equal(applied2screen.sameDay, 1);
});

test('velocity: waiting jobs are censored, terminal jobs are not', () => {
  const rows = [
    ev(1, 'applied', '2026-05-01'), // waiting for screen
    ev(2, 'applied', '2026-05-01'),
    ev(2, 'rejected', '2026-05-02'), // resolved without screen
  ];
  const hops = velocity(groupByJob(rows).values());
  const applied2screen = hops.find((h) => h.to === 'screen')!;
  assert.equal(applied2screen.censored, 1);
  assert.equal(applied2screen.medianDays, null);

  const applied2rejected = hops.find((h) => h.to === 'rejected')!;
  assert.equal(applied2rejected.n, 1);
  assert.equal(applied2rejected.medianDays, 1);
});

test('velocity: backfill-only in-flight jobs still count as waiting', () => {
  const rows = [ev(1, 'applied', '2026-04-30', 'backfill')];
  const hops = velocity(groupByJob(rows).values());
  const applied2screen = hops.find((h) => h.to === 'screen')!;
  assert.equal(applied2screen.censored, 1);
  assert.equal(applied2screen.n, 0);
});

test('velocity: a negative span from a crossed correction is dropped', () => {
  const rows = [
    ev(1, 'applied', '2026-05-10'),
    ev(1, 'screen', '2026-05-04'), // "before" applying — bad data
  ];
  const hops = velocity(groupByJob(rows).values());
  const applied2screen = hops.find((h) => h.to === 'screen')!;
  assert.equal(applied2screen.n, 0);
  assert.equal(applied2screen.sameDay, 0);
  assert.equal(applied2screen.medianDays, null);
});

const jobWith = (
  fitScore: number | null,
  events: StageEventRow[],
): { fitScore: number | null; history: ReturnType<typeof foldJob> } => ({
  fitScore,
  history: foldJob(events),
});

test('calibration: below MIN_RATE_N the rate is null, not 0', () => {
  const jobs = [
    jobWith(90, [ev(1, 'applied', '2026-05-01'), ev(1, 'screen', '2026-05-03')]),
    jobWith(92, [ev(2, 'applied', '2026-05-01'), ev(2, 'rejected', '2026-05-03')]),
  ];
  const c = calibration(jobs);
  const top = c.bands.find((b) => b.label === '≥85')!;
  assert.equal(top.applied, 2);
  assert.equal(top.interviewResolved, 2);
  assert.equal(top.interviewRate, null);
  assert.equal(c.verdict, 'insufficient');
});

test('calibration: in-flight jobs stay out of the denominator', () => {
  const resolved = Array.from({ length: 5 }, (_, i) =>
    jobWith(90, [
      ev(100 + i, 'applied', '2026-05-01'),
      ev(100 + i, i < 3 ? 'screen' : 'rejected', '2026-05-05'),
    ]),
  );
  const waiting = jobWith(90, [ev(200, 'applied', '2026-05-01')]);
  const c = calibration([...resolved, waiting]);
  const top = c.bands.find((b) => b.label === '≥85')!;
  assert.equal(top.applied, 6);
  assert.equal(top.interviewResolved, 5);
  assert.equal(top.interviewRate, 3 / 5);
});

test('calibration: verdict compares the lowest and highest known bands', () => {
  const mk = (fit: number, id: number, interviewed: boolean) =>
    jobWith(fit, [
      ev(id, 'applied', '2026-05-01'),
      ev(id, interviewed ? 'screen' : 'rejected', '2026-05-05'),
    ]);
  const low = Array.from({ length: 5 }, (_, i) => mk(40, 300 + i, i < 1)); // 20%
  const high = Array.from({ length: 5 }, (_, i) => mk(90, 400 + i, i < 4)); // 80%
  assert.equal(calibration([...low, ...high]).verdict, 'separating');
  assert.equal(calibration([...high.map((j) => ({ ...j, fitScore: 40 })), ...low.map((j) => ({ ...j, fitScore: 90 }))]).verdict, 'inverted');

  const flat = [...low, ...low.map((j, i) => jobWith(90, [
    ev(500 + i, 'applied', '2026-05-01'),
    ev(500 + i, i < 1 ? 'screen' : 'rejected', '2026-05-05'),
  ]))];
  assert.equal(calibration(flat).verdict, 'flat');
});

test('calibration: jobs without a fit score are counted aside', () => {
  const c = calibration([jobWith(null, [ev(1, 'applied', '2026-05-01')])]);
  assert.equal(c.unknownFit, 1);
  assert.equal(c.bands.every((b) => b.applied === 0), true);
});
