import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyResume,
  JsonResumeSchema,
  readStructure,
  structureCoverage,
  structureStrings,
} from './json-resume';

test('emptyResume gives every section, so a renderer never branches on null', () => {
  const r = emptyResume();
  assert.equal(r.basics.name, null);
  assert.deepEqual(r.basics.profiles, []);
  for (const key of ['work', 'education', 'skills', 'languages', 'certificates', 'projects', 'extras'] as const) {
    assert.deepEqual(r[key], [], key);
  }
});

test('a blank string is null, not an empty field', () => {
  const r = JsonResumeSchema.parse({ basics: { name: '  Nazar Boyko ', label: '   ', email: null } });
  assert.equal(r.basics.name, 'Nazar Boyko');
  assert.equal(r.basics.label, null);
  assert.equal(r.basics.email, null);
});

test('caps slice rather than reject: a 200-term skills line keeps 120 terms', () => {
  const keywords = Array.from({ length: 200 }, (_, i) => `term-${i}`);
  const r = JsonResumeSchema.parse({ skills: [{ name: 'Programming', keywords }] });
  assert.equal(r.skills.length, 1);
  assert.equal(r.skills[0]?.keywords.length, 120);
  assert.equal(r.skills[0]?.keywords[0], 'term-0');
});

test('caps slice rather than reject: 60 roles keep 40', () => {
  const work = Array.from({ length: 60 }, (_, i) => ({ name: `Company ${i}`, highlights: [] }));
  assert.equal(JsonResumeSchema.parse({ work }).work.length, 40);
});

test('an over-long entry drops out of its list instead of failing the parse', () => {
  const r = JsonResumeSchema.parse({
    work: [{ name: 'V Shred', highlights: ['short one', 'x'.repeat(2_000), 'another'] }],
  });
  assert.deepEqual(r.work[0]?.highlights, ['short one', 'another']);
});

test('readStructure: null, junk and a wrong shape all mean "no structure"', () => {
  assert.equal(readStructure(null), null);
  assert.equal(readStructure(undefined), null);
  assert.equal(readStructure('not an object'), null);
  assert.equal(readStructure(42), null);
});

test('readStructure keeps a structure whose unknown extra keys are ignored', () => {
  const r = readStructure({ basics: { name: 'Nazar Boyko' }, awards: [{ title: 'ignored' }] });
  assert.equal(r?.basics.name, 'Nazar Boyko');
  assert.equal((r as unknown as { awards?: unknown }).awards, undefined);
});

test('structureStrings lists every string the guard has to anchor', () => {
  const r = JsonResumeSchema.parse({
    basics: { name: 'Nazar Boyko', summary: 'Ten years.', profiles: ['github.com/n'] },
    work: [{ name: 'V Shred', position: 'Senior', highlights: ['Shipped a thing.'] }],
    skills: [{ name: 'Programming', keywords: ['PHP', 'Go'] }],
    extras: [{ heading: 'AWARDS', lines: ['Something'] }],
  });
  const strings = structureStrings(r);
  for (const expected of ['Nazar Boyko', 'Ten years.', 'github.com/n', 'V Shred', 'Senior', 'Shipped a thing.', 'Programming', 'PHP', 'Go', 'AWARDS', 'Something']) {
    assert.ok(strings.includes(expected), `missing ${expected}`);
  }
  assert.ok(!strings.includes(''), 'no empty strings reach the guard');
});

test('structureCoverage counts what the page reports', () => {
  const r = JsonResumeSchema.parse({
    basics: { summary: 'Ten years.' },
    skills: [{ name: 'Programming', keywords: ['PHP'] }],
    work: [
      { name: 'V Shred', highlights: ['a', 'b'] },
      { name: 'Vodwork', highlights: ['c'] },
    ],
  });
  assert.deepEqual(structureCoverage(r), { sections: 3, roles: 2, bullets: 3 });
  assert.deepEqual(structureCoverage(emptyResume()), { sections: 0, roles: 0, bullets: 0 });
});
