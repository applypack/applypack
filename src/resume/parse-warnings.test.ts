import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWarnings } from './parse-warnings';

const CLEAN = [
  'Alex Doe — Senior Backend Engineer',
  'alex@example.com · +1 415 555 0100 · github.com/alexdoe',
  '',
  'Summary',
  'Backend engineer with ten years of PHP and Laravel, shipping payment systems.',
  '',
  'Experience',
  'Senior Engineer, Acme (2022-2026): cut checkout latency 35%, saving $200k a year.',
  'Engineer, Beta (2019-2022): built CI/CD pipelines used by 40 developers daily.',
].join('\n');

const codes = (text: string) => parseWarnings(text).map((w) => w.code);

test('a clean resume produces no warnings', () => {
  assert.deepEqual(codes(CLEAN), []);
});

test('a near-empty extraction reports too_short and stops there', () => {
  const w = parseWarnings('scanned page');
  assert.deepEqual(w.map((x) => x.code), ['too_short']);
  assert.match(w[0]!.message, /scanned/);
});

test('replacement and control characters are counted', () => {
  assert.ok(codes(`${CLEAN} bro�ken`).includes('unreadable_chars'));
  assert.ok(codes(`${CLEAN}\u0000\u0007`).includes('control_chars'));
});

test('missing contact details are flagged individually', () => {
  const noContact = CLEAN.replace('alex@example.com · +1 415 555 0100 · github.com/alexdoe', 'contact on request');
  const w = codes(noContact);
  assert.ok(w.includes('no_email'));
  assert.ok(w.includes('no_phone'));
});

test('glued words and over-length text are flagged', () => {
  const glued = `${CLEAN}\n${'Seniorbackendengineerwithagreatrecordofdelivery '.repeat(40)}`;
  assert.ok(codes(glued).includes('glued_words'));
  const long = `${CLEAN}\n${'A normal resume line about work done well here. '.repeat(200)}`;
  assert.ok(codes(long).includes('too_long'));
});
