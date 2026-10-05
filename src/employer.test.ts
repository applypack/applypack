import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanEmployer,
  employerFromDescription,
  employerGate,
  employerKey,
  hiringKey,
  hiringName,
  isReapplyChoice,
  sourceIsEmployer,
  withoutMuted,
} from './employer';

test('two spellings of one company share a key', () => {
  for (const name of ['Acme', 'ACME', 'Acme, Inc.', 'Acme Inc', 'The Acme Corporation', 'acme ltd.', 'Acme GmbH & Co. KG', 'Acme Sp. z o.o.', 'Acme S.A.', 'Acme B.V.', 'Acme & Co.']) {
    assert.equal(employerKey(name), 'acme', name);
  }
  assert.equal(employerKey('Café Élan S.R.L.'), 'cafe elan');
  assert.equal(employerKey('Booking.com'), 'booking com');
  assert.equal(employerKey('AT&T'), 'at and t');
  assert.equal(employerKey('Acme UG (haftungsbeschränkt)'), 'acme');
  // Cyrillic stays itself; only the marks fold.
  assert.equal(employerKey('СофтСерв'), 'софтсерв');
});

test('a key never merges names that differ in a word of their own', () => {
  assert.notEqual(employerKey('Acme Labs'), employerKey('Acme'));
  assert.notEqual(employerKey('Acme Group'), employerKey('Acme'));
  // A legal form is dropped only from the end, and never the whole name.
  assert.equal(employerKey('Inc'), 'inc');
  assert.equal(employerKey('Co Ltd'), 'co');
  assert.equal(employerKey('The'), 'the');
  assert.equal(employerKey(' — '), null);
});

test('cleanEmployer keeps a name and refuses what is not one', () => {
  assert.equal(cleanEmployer('  Acme\n Labs '), 'Acme Labs');
  assert.equal(cleanEmployer(''), null);
  assert.equal(cleanEmployer('   '), null);
  assert.equal(cleanEmployer(42), null);
  assert.equal(cleanEmployer(undefined), null);
  assert.equal(cleanEmployer('x'.repeat(121)), null);
});

test('the stored descriptions give their employer back', () => {
  assert.equal(employerFromDescription('Hiring company: ManTech. Category: Dev.\n\nWe build…'), 'ManTech');
  // A name with its own full stop: the lazy match runs to the one before whitespace.
  assert.equal(employerFromDescription('Hiring company: Acme Inc.. Contract: full-time.'), 'Acme Inc.');
  assert.equal(employerFromDescription('Hiring company: Booking.com.\n\nAbout'), 'Booking.com');
  assert.equal(employerFromDescription('Company: Sumble · Location: Remote\n\nWe are…'), 'Sumble');
  assert.equal(employerFromDescription('Company: Sumble\n\nWe are…'), 'Sumble');
  assert.equal(employerFromDescription('We are hiring. The company: great.'), null);
  assert.equal(employerFromDescription(''), null);
});

test('hiringKey: the named employer, else the source — never an aggregator itself', () => {
  assert.equal(hiringKey('Acme, Inc.', 'Remotive', true), 'acme');
  assert.equal(hiringKey(null, 'Remotive', true), null);
  assert.equal(hiringKey(undefined, 'Stripe', false), 'stripe');
});

test('which sources are the employer themselves', () => {
  assert.equal(sourceIsEmployer('GREENHOUSE'), true);
  assert.equal(sourceIsEmployer('FEED'), true);
  assert.equal(sourceIsEmployer('MANUAL'), true);
  assert.equal(sourceIsEmployer('REMOTIVE'), false);
  assert.equal(sourceIsEmployer('HN_HIRING'), false);
  assert.equal(hiringName('Acme', { name: 'Remotive', atsType: 'REMOTIVE' }), 'Acme');
  assert.equal(hiringName(null, { name: 'Remotive', atsType: 'REMOTIVE' }), null);
  assert.equal(hiringName(null, { name: 'Stripe', atsType: 'GREENHOUSE' }), 'Stripe');
});

test('rows the user brings carry many employers: the source’s own name is never one', () => {
  assert.equal(sourceIsEmployer('IMPORT'), false);
  assert.equal(hiringName('Acme', { name: 'September export', atsType: 'IMPORT' }), 'Acme');
  assert.equal(hiringName(null, { name: 'September export', atsType: 'IMPORT' }), null);
});

test('a mute turns a posting away; the window spares a watched company that wants everything', () => {
  const rules = { muted: new Set(['acme']), appliedRecently: new Set(['acme', 'globex']) };
  assert.equal(employerGate('acme', rules), 'muted');
  assert.equal(employerGate('acme', rules, true), 'muted');
  assert.equal(employerGate('globex', rules), 'applied');
  assert.equal(employerGate('globex', rules, true), null);
  assert.equal(employerGate('initech', rules), null);
  assert.equal(employerGate(null, rules), null);
  assert.equal(employerGate('acme', { muted: new Set(), appliedRecently: new Set() }), null);
});

test('the re-apply window takes its listed choices only', () => {
  assert.equal(isReapplyChoice(90), true);
  assert.equal(isReapplyChoice(7), false);
});

test('withoutMuted keeps the rows that name nobody', () => {
  assert.equal(withoutMuted([]), null);
  assert.deepEqual(withoutMuted(['acme']), { OR: [{ employerKey: null }, { employerKey: { notIn: ['acme'] } }] });
});
