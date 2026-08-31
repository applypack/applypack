import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_HAMMING_DISTANCE,
  MIN_NORMALIZED_CHARS,
  findCrossListing,
  fromDbBigInt,
  hamming64,
  normalizeJdText,
  normalizedLength,
  simhash64,
  toDbBigInt,
} from './fingerprint';

/** A body comfortably over the guard, built from varied prose. */
function longBody(seed: string): string {
  const sentences = [
    `We are hiring a ${seed} engineer to build and operate our platform.`,
    'You will design services, review code and mentor other engineers.',
    'Our stack is PHP, Laravel, TypeScript, Postgres and Docker on AWS.',
    'We offer remote work, a learning budget and twenty-five days of leave.',
    'Applicants should have at least five years of professional experience.',
    'The team ships continuously and owns what it builds end to end.',
    'You will work closely with product managers, designers and analysts.',
    'We run weekly demos and keep written decision records for every change.',
    'Interviews are a screening call, a technical pairing session and a chat.',
  ];
  return sentences.join(' ');
}

test('normalizeJdText strips markup, entities and URLs', () => {
  const tokens = normalizeJdText(
    '<p>Senior&nbsp;Engineer</p> apply at https://example.com/jobs?a=1 &amp; enjoy',
  );
  assert.deepEqual(tokens, ['senior', 'engineer', 'apply', 'at', 'enjoy']);
});

test('normalizeJdText keeps non-Latin scripts', () => {
  assert.deepEqual(normalizeJdText('Розробник Laravel у Києві'), [
    'розробник',
    'laravel',
    'у',
    'києві',
  ]);
  assert.deepEqual(normalizeJdText('シニアエンジニア'), ['シニアエンジニア']);
});

test('normalizeJdText tolerates junk input', () => {
  assert.deepEqual(normalizeJdText(null), []);
  assert.deepEqual(normalizeJdText(undefined), []);
  assert.deepEqual(normalizeJdText(''), []);
  assert.deepEqual(normalizeJdText('<<<>>>'), []);
});

test('identical text fingerprints to distance 0', () => {
  const a = simhash64(longBody('backend'));
  const b = simhash64(longBody('backend'));
  assert.notEqual(a, null);
  assert.equal(hamming64(a!, b!), 0);
});

test('markup differences do not change the fingerprint', () => {
  const plain = simhash64(longBody('backend'));
  const marked = simhash64(`<div><p>${longBody('backend')}</p></div>`);
  assert.equal(hamming64(plain!, marked!), 0);
});

test('a few edited words stay within the match threshold', () => {
  const original = longBody('backend');
  const edited = original
    .replace('twenty-five days of leave', 'thirty days of leave')
    .replace('five years', 'six years');
  const distance = hamming64(simhash64(original)!, simhash64(edited)!);
  assert.ok(
    distance > 0 && distance <= MAX_HAMMING_DISTANCE,
    `expected a small non-zero distance, got ${distance}`,
  );
});

test('unrelated bodies land far outside the threshold', () => {
  const jd = longBody('backend');
  const other = [
    'Our bakery is looking for a pastry chef with a passion for sourdough.',
    'Shifts start at four in the morning and the kitchen closes at noon.',
    'Experience with laminated dough and seasonal menus is appreciated.',
    'We provide uniforms, meals on shift and a monthly transport pass.',
    'The role is on site in Lviv and involves lifting heavy trays daily.',
    'Weekend availability is required during the winter holiday season.',
    'Our head baker will train you on our starter and fermentation schedule.',
    'We source flour from two regional mills and mill some grains ourselves.',
    'Applicants need a food handling certificate before their first shift.',
  ].join(' ');
  assert.ok(hamming64(simhash64(jd)!, simhash64(other)!) > MAX_HAMMING_DISTANCE);
});

test('a body under the guard gets no fingerprint', () => {
  // The exact shape that broke the plan's 200-char guard: a truncated
  // aggregator teaser with only the company blurb (ADR 0018).
  const teaser =
    'Hiring company: ClickUp. Type: full time. At ClickUp, we are building ' +
    'the future of work: the first truly converged AI workspace unifying ' +
    'tasks, docs, chat, calendar and enterprise search, all supercharged...';
  assert.ok(normalizedLength(normalizeJdText(teaser)) < MIN_NORMALIZED_CHARS);
  assert.equal(simhash64(teaser), null);
});

test('a body under three tokens gets no fingerprint', () => {
  assert.equal(simhash64('a b'), null);
  // An unspaced CJK body normalizes to one giant token; an all-zero hash
  // would otherwise match every other degenerate body.
  assert.equal(simhash64('シニアエンジニアを募集しています'.repeat(40)), null);
});

test('hamming64 counts differing bits', () => {
  assert.equal(hamming64(0n, 0n), 0);
  assert.equal(hamming64(0b1011n, 0b1001n), 1);
  assert.equal(hamming64(0n, 0xffffffffffffffffn), 64);
});

test('a top-bit fingerprint survives the signed BIGINT round trip', () => {
  // Postgres BIGINT is signed: this value is what Prisma refused outright
  // before the conversion existed.
  const hash = 13153543119183686648n;
  const stored = toDbBigInt(hash)!;
  assert.ok(stored < 0n, 'expected the signed form to be negative');
  assert.ok(stored >= -(2n ** 63n) && stored < 2n ** 63n, 'must fit in BIGINT');
  assert.equal(fromDbBigInt(stored), hash);
  assert.equal(toDbBigInt(null), null);
  assert.equal(fromDbBigInt(null), null);
});

test('hamming64 is correct across the signed/unsigned boundary', () => {
  const a = 13153543119183686648n;
  const b = a ^ 0b1011n; // three bits apart
  assert.equal(hamming64(a, b), 3);
  // Same answer when either side arrives in its stored signed form.
  assert.equal(hamming64(toDbBigInt(a)!, b), 3);
  assert.equal(hamming64(toDbBigInt(a)!, toDbBigInt(b)!), 3);
});

test('findCrossListing matches candidates stored in signed form', () => {
  const hash = 13153543119183686648n;
  const candidates = [
    { id: 5, companyId: 2, descriptionSimhash: toDbBigInt(hash) },
  ];
  assert.equal(findCrossListing(hash, 1, candidates)?.job.id, 5);
});

test('findCrossListing ignores the same company and picks the closest', () => {
  const fingerprint = 0b1111n;
  const candidates = [
    { id: 1, companyId: 7, descriptionSimhash: 0b1111n }, // same company
    { id: 2, companyId: 9, descriptionSimhash: 0b1011n }, // distance 1
    { id: 3, companyId: 8, descriptionSimhash: 0b1110n }, // distance 1, earlier
    { id: 4, companyId: 9, descriptionSimhash: null },
  ];
  const hit = findCrossListing(fingerprint, 7, candidates);
  assert.equal(hit?.job.id, 2);
  assert.equal(hit?.distance, 1);
});

test('findCrossListing returns null past the threshold or without a fingerprint', () => {
  const candidates = [{ id: 1, companyId: 9, descriptionSimhash: 0xffn }];
  assert.equal(findCrossListing(0n, 7, candidates), null);
  assert.equal(findCrossListing(null, 7, candidates), null);
  assert.equal(findCrossListing(0n, 7, []), null);
});
