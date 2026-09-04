import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonResumeSchema } from './json-resume';
import { anchorStructure, normaliseForAnchor, structureIsUsable } from './structure-anchor';

const RESUME = `Nazar Boyko
Senior Software Engineer
Austin, Texas ∙ boyko.nazar@gmail.com

## PROFESSIONAL SUMMARY
Senior full-stack engineer (10+ years) shipping production Laravel/React systems end-to-end.

## KEY SKILLS
Programming: PHP, Go, JavaScript

## PROFESSIONAL EXPERIENCE
V Shred | Austin, Texas, US ∙ Remote
Senior Software Engineer | Dec. 2024 – Present
- Led backend architecture for PHP/Laravel systems processing high-volume financial
  transactions, supporting millions in annual revenue with 99.9% uptime.
- Built and deployed a cross-platform notification system.
`;

const structure = (partial: unknown) => JsonResumeSchema.parse(partial);

test('a copied structure survives whole', () => {
  const report = anchorStructure(
    structure({
      basics: { name: 'Nazar Boyko', label: 'Senior Software Engineer', email: 'boyko.nazar@gmail.com' },
      work: [
        {
          name: 'V Shred',
          position: 'Senior Software Engineer',
          startDate: 'Dec. 2024',
          endDate: 'Present',
          highlights: ['Built and deployed a cross-platform notification system.'],
        },
      ],
      skills: [{ name: 'Programming', keywords: ['PHP', 'Go', 'JavaScript'] }],
    }),
    RESUME,
  );
  assert.equal(report.dropped, 0);
  assert.equal(report.structure.basics.name, 'Nazar Boyko');
  assert.equal(report.structure.work[0]?.highlights.length, 1);
  assert.ok(report.kept > 5);
});

test('a bullet the model tightened is dropped, not stored', () => {
  const report = anchorStructure(
    structure({
      work: [
        {
          name: 'V Shred',
          highlights: [
            'Built and deployed a cross-platform notification system.',
            'Drove revenue growth through best-in-class payment orchestration.',
          ],
        },
      ],
    }),
    RESUME,
  );
  assert.equal(report.dropped, 1);
  assert.deepEqual(report.structure.work[0]?.highlights, ['Built and deployed a cross-platform notification system.']);
  assert.deepEqual(report.samples, ['Drove revenue growth through best-in-class payment orchestration.']);
});

test('a wrapped resume line still anchors — whitespace is collapsed on both sides', () => {
  const wrapped =
    'Led backend architecture for PHP/Laravel systems processing high-volume financial transactions, supporting millions in annual revenue with 99.9% uptime.';
  const report = anchorStructure(structure({ work: [{ name: 'V Shred', highlights: [wrapped] }] }), RESUME);
  assert.equal(report.dropped, 0);
  assert.deepEqual(report.structure.work[0]?.highlights, [wrapped]);
});

test('a smart quote against a straight one is the same text', () => {
  const resume = 'NAME\n\nSomewhere Ltd\nRan the company’s “platform team” for two years.\n';
  const report = anchorStructure(
    structure({ work: [{ name: 'Somewhere Ltd', highlights: ["Ran the company's \"platform team\" for two years."] }] }),
    resume,
  );
  assert.equal(report.dropped, 0);
});

test('a role that loses every bullet is counted and kept, but does not carry the structure', () => {
  const report = anchorStructure(
    structure({
      work: [
        { name: 'V Shred', position: 'Senior Software Engineer', highlights: ['Invented this entirely.'] },
        { name: 'V Shred', highlights: ['Built and deployed a cross-platform notification system.'] },
      ],
    }),
    RESUME,
  );
  assert.equal(report.emptiedRoles, 1);
  assert.equal(report.structure.work.length, 2, 'the roles themselves are real, so they stay');
  assert.deepEqual(report.structure.work[0]?.highlights, []);
  assert.equal(structureIsUsable(report), true, 'another role still has its bullets');
});

test('an entry left with nothing at all is pruned', () => {
  const report = anchorStructure(
    structure({ work: [{ name: 'Fabricated Corp', position: 'Chief of Everything', highlights: [] }] }),
    RESUME,
  );
  assert.deepEqual(report.structure.work, []);
});

test('an extras heading the resume does not contain takes its section', () => {
  const report = anchorStructure(
    structure({ extras: [{ heading: 'AWARDS AND HONOURS', lines: ['Senior Software Engineer'] }] }),
    RESUME,
  );
  assert.deepEqual(report.structure.extras, []);
});

test('short strings pass without being counted as evidence', () => {
  // "Go" is two characters: proving it against a 500-character resume proves
  // nothing, so it is kept without pretending the check meant something.
  const report = anchorStructure(structure({ skills: [{ name: 'Programming', keywords: ['Go', 'PHP'] }] }), RESUME);
  assert.equal(report.dropped, 0);
  assert.deepEqual(report.structure.skills[0]?.keywords, ['Go', 'PHP']);
});

test('structureIsUsable: a structure the guard emptied is not worth storing', () => {
  const empty = anchorStructure(structure({ work: [{ name: 'Nowhere', highlights: ['Invented.'] }] }), RESUME);
  assert.equal(structureIsUsable(empty), false);
  const kept = anchorStructure(structure({ skills: [{ name: 'Programming', keywords: ['PHP'] }] }), RESUME);
  assert.equal(structureIsUsable(kept), true);
});

test('a structure written for the previous version does not survive new text', () => {
  // The bug this closes: a scan that finished after a version bump, or a row
  // written before the bump cleared the column, would otherwise draw words the
  // resume no longer contains. The render route anchors before it draws.
  const v1 = structure({
    basics: { name: 'Nazar Boyko' },
    work: [{ name: 'V Shred', highlights: ['Built and deployed a cross-platform notification system.'] }],
  });
  const v2Text = 'Nazar Boyko\n\n## PROFESSIONAL EXPERIENCE\nV Shred\n- An entirely rewritten bullet about something else.\n';
  const report = anchorStructure(v1, v2Text);
  assert.equal(report.dropped, 1);
  assert.deepEqual(report.structure.work[0]?.highlights, []);
  assert.equal(structureIsUsable(report), false, 'and so the deterministic reader is used instead');
});

test('normaliseForAnchor flattens the families that differ between a file and a model', () => {
  assert.equal(normaliseForAnchor('A —  B\tC'), 'a - b c');
  assert.equal(normaliseForAnchor('“quoted” ‘too’'), '"quoted" \'too\'');
  assert.equal(normaliseForAnchor('  Mixed CASE  '), 'mixed case');
});
