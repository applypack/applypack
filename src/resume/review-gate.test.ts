import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateReviewAdvice } from './review-gate';

// TASKS R3: the review's example lines pass the same fact gate as a suggestion and a letter.
const RESUME = 'Jane Example — Backend Engineer. Acme (2021–2026): built the billing service in Node.js and TypeScript, moved it from MySQL to PostgreSQL, cut p95 latency by 40%.';
const advice = (example: string | null, ask: string | null = null) => ({
  priority: 'high' as const,
  dimension: 'impact' as const,
  issue: 'The billing bullet says what, not how much.',
  why: 'Numbers carry a bullet.',
  fix: 'Add the scale of the work.',
  example,
  ask,
  quote: null,
});

test('an example built from the resume stands', () => {
  const out = gateReviewAdvice([advice('Cut p95 latency of the Node.js billing service by 40% after moving it to PostgreSQL.')], [RESUME]);
  assert.equal(out.blocked, 0);
  assert.ok(out.advice[0]!.example);
});

test('an invented figure is not shown, and becomes the question it needed', () => {
  const out = gateReviewAdvice([advice('Cut p95 latency by 40% for 2M daily requests.')], [RESUME]);
  assert.equal(out.blocked, 1);
  assert.equal(out.advice[0]!.example, null);
  assert.match(out.advice[0]!.ask ?? '', /What is the real figure here\?$/);
  // The fix itself stays: the advice is still worth reading.
  assert.equal(out.advice[0]!.fix, 'Add the scale of the work.');
});

test('a figure the candidate supplied earlier is a source; an ask the model already wrote is kept', () => {
  const supplied = gateReviewAdvice([advice('Cut p95 latency by 40% for 2M daily requests.')], [RESUME, 'How many requests a day? 2M daily requests']);
  assert.equal(supplied.blocked, 0);
  const kept = gateReviewAdvice([advice('Cut p95 latency by 55% across the billing service.', 'How big was the billing team?')], [RESUME]);
  assert.equal(kept.blocked, 1);
  assert.equal(kept.advice[0]!.ask, 'How big was the billing team?');
});

test('advice whose claim the text contradicts is not shown (#584)', () => {
  const resume = ['Jane Example', 'EXPERIENCE', '- Built the GraphQL gateway for the Frachtwerk freight platform.', '- Cut p95 latency by 40%.'].join('\n');
  const claim = (issue: string) => ({ ...advice(null), issue });
  const out = gateReviewAdvice(
    [claim('GraphQL is never in a bullet, only in the skills line.'), claim('React is never mentioned in any experience bullet.'), claim('Logistics is three roles back.')],
    [resume],
  );
  assert.deepEqual(out.advice.map((a) => a.issue), ['React is never mentioned in any experience bullet.', 'Logistics is three roles back.']);
  assert.equal(out.untrue, 1);
});
