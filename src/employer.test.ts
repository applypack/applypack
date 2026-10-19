import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanEmployer,
  COMPANY_NOT_NAMED,
  companyForMessage,
  companyForPage,
  companyOnPage,
  companyForPrompt,
  employerFromDescription,
  employerGate,
  employerKey,
  fetchedHiringName,
  hiringKey,
  hiringName,
  isReapplyChoice,
  postingForPrompt,
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
  assert.equal(sourceIsEmployer('FOLDER'), false);
  assert.equal(hiringName(null, { name: 'Tool output', atsType: 'FOLDER' }), null);
  assert.equal(hiringName('Acme', { name: 'September export', atsType: 'IMPORT' }), 'Acme');
  assert.equal(hiringName(null, { name: 'September export', atsType: 'IMPORT' }), null);
});

test('a mute turns a posting away; the window spares a watched company that wants everything', () => {
  const until = new Date('2026-12-01T00:00:00Z');
  const rules = { muted: new Set(['acme']), appliedUntil: new Map([['acme', until], ['globex', until]]) };
  assert.equal(employerGate('acme', rules), 'muted');
  assert.equal(employerGate('acme', rules, true), 'muted');
  assert.equal(employerGate('globex', rules), 'applied');
  assert.equal(employerGate('globex', rules, true), null);
  assert.equal(employerGate('initech', rules), null);
  assert.equal(employerGate(null, rules), null);
  assert.equal(employerGate('acme', { muted: new Set(), appliedUntil: new Map() }), null);
});

test('the re-apply window takes its listed choices only', () => {
  assert.equal(isReapplyChoice(90), true);
  assert.equal(isReapplyChoice(7), false);
});

test('withoutMuted keeps the rows that name nobody', () => {
  assert.equal(withoutMuted([]), null);
  assert.deepEqual(withoutMuted(['acme']), { OR: [{ employerKey: null }, { employerKey: { notIn: ['acme'] } }] });
});

test('a row that names no company has none to state: a prompt and a message never take the source for one (#401)', () => {
  // Seen live: the classifier read "Company: Saved postings", and the alert said "@ Export A".
  for (const [atsType, name] of [['IMPORT', 'Export A'], ['FOLDER', 'Saved postings'], ['REMOTEOK', 'RemoteOK'], ['HN_HIRING', 'HN Who is hiring']] as const) {
    assert.equal(companyForPrompt(null, { atsType, name }), COMPANY_NOT_NAMED, atsType);
    assert.equal(companyForMessage(null, { atsType, name }), 'company not named', atsType);
    // The employer the row named is who hires, whatever brought it.
    assert.equal(companyForPrompt('Globex', { atsType, name }), 'Globex', atsType);
    assert.equal(companyForMessage('Globex', { atsType, name }), 'Globex', atsType);
  }
  // A company's own board, feed or careers page, and a pasted posting: the source is the employer.
  for (const atsType of ['GREENHOUSE', 'LEVER', 'FEED', 'CAREER_PAGE', 'MANUAL']) {
    assert.equal(companyForPrompt(null, { atsType, name: 'Acme' }), 'Acme', atsType);
    assert.equal(companyForPrompt(undefined, { atsType, name: 'Acme' }), 'Acme', atsType);
    assert.equal(companyForMessage(null, { atsType, name: 'Acme' }), 'Acme', atsType);
  }
  assert.match(COMPANY_NOT_NAMED, /not named/);
});

test('a stored posting is handed to a prompt in one shape, with who hires as a prompt states it (#444)', () => {
  const row = { id: 7, title: 'Backend Engineer', location: 'Remote', description: 'The role.', url: 'https://rows.example/1', fitScore: 80 };
  // Seen on the dashboard's own presses: Compare, Rewrite and a screening all read "Company: September export".
  for (const [atsType, name] of [['IMPORT', 'September export'], ['FOLDER', 'Saved postings'], ['REMOTEOK', 'RemoteOK Feed']] as const) {
    assert.deepEqual(postingForPrompt({ ...row, employer: null, company: { name, atsType } }), { id: 7, title: 'Backend Engineer', companyName: COMPANY_NOT_NAMED, location: 'Remote', description: 'The role.' }, atsType);
    assert.equal(postingForPrompt({ ...row, employer: 'Fennel Works', company: { name, atsType } }).companyName, 'Fennel Works', atsType);
  }
  // A pasted posting and a company's own board: the source is who hires.
  assert.equal(postingForPrompt({ ...row, employer: null, company: { name: 'Quince Labs', atsType: 'MANUAL' } }).companyName, 'Quince Labs');
  assert.equal(postingForPrompt({ ...row, employer: null, company: { name: 'Acme', atsType: 'GREENHOUSE' } }).companyName, 'Acme');
  // Nothing of the row rides along but what a prompt reads.
  assert.deepEqual(Object.keys(postingForPrompt({ ...row, employer: null, company: { name: 'Acme', atsType: 'LEVER' } })), ['id', 'title', 'companyName', 'location', 'description']);
});

test('a fetched row says who hires by its own sign: an employer left out is the source, null is nobody', () => {
  assert.equal(fetchedHiringName(undefined, 'Acme Board'), 'Acme Board');
  assert.equal(fetchedHiringName('Globex', 'RemoteOK'), 'Globex');
  assert.equal(fetchedHiringName(null, 'RemoteOK'), null);
  assert.equal(fetchedHiringName(null, 'Saved postings'), null);
});

test('a page names who hires and where the row came through as two things (#444)', () => {
  // An aggregator, an imported file and a folder hold other people's postings: their own name is never the company.
  for (const [atsType, name] of [['REMOTEOK', 'RemoteOK Feed'], ['IMPORT', 'September export'], ['FOLDER', 'Saved postings']] as const) {
    assert.deepEqual(companyOnPage(null, { atsType, name }), { name: null, via: name }, atsType);
    assert.deepEqual(companyOnPage('Fennel Works', { atsType, name }), { name: 'Fennel Works', via: name }, atsType);
    assert.equal(companyForPage(null, { atsType, name }), 'Company not named', atsType);
    assert.equal(companyForPage('Fennel Works', { atsType, name }), 'Fennel Works', atsType);
  }
  // An employer's own board, and a posting the person pasted: the source is the company, and there is no "via".
  for (const atsType of ['GREENHOUSE', 'MANUAL']) {
    assert.deepEqual(companyOnPage(null, { atsType, name: 'Acme' }), { name: 'Acme', via: null }, atsType);
    assert.equal(companyForPage(undefined, { atsType, name: 'Acme' }), 'Acme', atsType);
  }
});
