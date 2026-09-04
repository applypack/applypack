import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinWrapped, structureFromText } from './structure-from-text';
import { structureCoverage } from './json-resume';

/*
 * The two heading dialects, the wrapped bullet and the trailing tech-stack
 * line are all shapes measured on the three stored resumes — a .docx read by
 * docx-text.ts and two PDFs read by pdf-text.ts. Every fixture below is that
 * corpus in miniature.
 */

const DOCX_STYLE = `Nazar Boyko
Senior Software Engineer
Austin, Texas, 78758 ∙ boyko.nazar@gmail.com ∙ +1 (612) 267-5544 ∙ linkedin.com/in/nazar-boyko

## PROFESSIONAL SUMMARY

Senior full-stack engineer shipping production systems end-to-end.

## KEY SKILLS
Programming: PHP, Go, JavaScript
Frameworks/Libraries: Laravel, React

## PROFESSIONAL EXPERIENCE

V Shred | Austin, Texas, US ∙ Remote
Senior Software Engineer | Dec. 2024 – Present
- Led backend architecture for PHP systems.
- Built a notification system.

Technology Stack: PHP, Laravel, MySQL.

Vodwork | Hopkins, Minnesota, US ∙ Remote
Senior Full-Stack Engineer | Jan. 2021 – Dec. 2024
- Reduced the complexity of the system.

## EDUCATION
Lviv Polytechnic National University | M.Sc. Computer Science
`;

const PDF_STYLE = `Nazar Boyko
Senior Software Engineer
Austin, Texas, 78758 ∙ boyko.nazar@gmail.com ∙ +1 (612) 267-5544 ∙ linkedin.com/in/nazar-boyko

PROFESSIONAL SUMMARY
Senior full-stack engineer shipping production systems end-to-end.

KEY SKILLS
Programming: PHP, Go, JavaScript
Frameworks/Libraries: Laravel, React

PROFESSIONAL EXPERIENCE
V Shred Austin, Texas, US ∙ Remote
Senior Software Engineer Dec. 2024 – Present
• Led backend architecture for PHP systems processing high-volume financial
transactions, supporting millions in annual revenue.
• Built a notification system.
Technology Stack: PHP, Laravel, MySQL.
Vodwork Hopkins, Minnesota, US ∙ Remote
Senior Full-Stack Engineer Jan. 2021 – Dec. 2024
• Reduced the complexity of the system.
EDUCATION
Lviv Polytechnic National University M.Sc. Computer Science
`;

test('both heading dialects split into the same sections', () => {
  const docx = structureFromText(DOCX_STYLE);
  const pdf = structureFromText(PDF_STYLE);
  assert.equal(docx.basics.summary, 'Senior full-stack engineer shipping production systems end-to-end.');
  assert.equal(pdf.basics.summary, docx.basics.summary);
  assert.equal(docx.skills.length, 2);
  assert.equal(pdf.skills.length, 2);
  assert.equal(docx.education.length, 1);
  assert.equal(pdf.education.length, 1);
});

test('both dialects find the same roles and the same bullets', () => {
  const docx = structureFromText(DOCX_STYLE);
  const pdf = structureFromText(PDF_STYLE);
  assert.deepEqual(structureCoverage(docx), structureCoverage(pdf));
  assert.equal(docx.work.length, 2);
  assert.deepEqual(docx.work.map((w) => w.startDate), ['Dec. 2024', 'Jan. 2021']);
  assert.deepEqual(docx.work.map((w) => w.endDate), ['Present', 'Dec. 2024']);
  assert.deepEqual(docx.work.map((w) => w.position), ['Senior Software Engineer', 'Senior Full-Stack Engineer']);
});

test('the contact line is read into its own fields', () => {
  const b = structureFromText(DOCX_STYLE).basics;
  assert.equal(b.name, 'Nazar Boyko');
  assert.equal(b.label, 'Senior Software Engineer');
  assert.equal(b.email, 'boyko.nazar@gmail.com');
  assert.equal(b.phone, '+1 (612) 267-5544');
  assert.equal(b.url, 'linkedin.com/in/nazar-boyko');
  assert.equal(b.location, 'Austin, Texas, 78758');
});

test('a wrapped PDF bullet is joined back into one bullet', () => {
  const bullets = structureFromText(PDF_STYLE).work[0]?.highlights ?? [];
  assert.equal(bullets.length, 2);
  assert.equal(
    bullets[0],
    'Led backend architecture for PHP systems processing high-volume financial transactions, supporting millions in annual revenue.',
  );
});

test('a trailing tech-stack line joins its role instead of becoming one', () => {
  for (const text of [DOCX_STYLE, PDF_STYLE]) {
    const work = structureFromText(text).work;
    assert.equal(work.length, 2, 'no phantom third role');
    assert.match(work[0]?.summary ?? '', /Technology Stack: PHP, Laravel, MySQL\./);
  }
});

test('a labelled skills line becomes a group; a bare list becomes an unnamed one', () => {
  const skills = structureFromText(DOCX_STYLE).skills;
  assert.deepEqual(skills[0], { name: 'Programming', keywords: ['PHP', 'Go', 'JavaScript'] });
  const bare = structureFromText('NAME\n\nSKILLS\nPHP, Go, React\n').skills;
  assert.deepEqual(bare[0], { name: null, keywords: ['PHP', 'Go', 'React'] });
});

test('a label with nothing after it keeps the label — the table shape, not a guess', () => {
  // A skills table extracts as a stack of labels and then a stack of values.
  // Pairing them is the model's job (ADR 0039); the fallback keeps both, unpaired.
  const r = structureFromText('NAME\n\nKEY SKILLS\nProgramming:\nFrameworks:\nPHP, Go\nLaravel, React\n');
  assert.deepEqual(r.skills.map((s) => s.name), ['Programming', 'Frameworks', null, null]);
  assert.deepEqual(r.skills[2]?.keywords, ['PHP', 'Go']);
});

test('an unknown section is kept as headed prose rather than dropped', () => {
  const r = structureFromText('NAME\n\nVOLUNTEERING\nRan a meetup for two years.\n');
  assert.deepEqual(r.extras, [{ heading: 'VOLUNTEERING', lines: ['Ran a meetup for two years.'] }]);
});

test('a shouted sentence is not a heading', () => {
  const long = 'THIS IS A VERY LOUD SENTENCE THAT RUNS WELL PAST ANY REASONABLE HEADING LENGTH';
  const r = structureFromText(`NAME\n\nSUMMARY\n${long}\n`);
  assert.equal(r.extras.length, 0);
  assert.equal(r.basics.summary, long);
});

test('empty text gives an empty structure, not a throw', () => {
  assert.deepEqual(structureCoverage(structureFromText('')), { sections: 0, roles: 0, bullets: 0 });
  assert.deepEqual(structureCoverage(structureFromText('\n\n   \n')), { sections: 0, roles: 0, bullets: 0 });
});

test('joinWrapped keeps a finished sentence apart and joins a broken one', () => {
  assert.deepEqual(joinWrapped(['One sentence.', 'Another one.']), ['One sentence.', 'Another one.']);
  assert.deepEqual(joinWrapped(['A line broken at the page', 'width, like this.']), ['A line broken at the page width, like this.']);
  assert.deepEqual(joinWrapped(['• First bullet', '• Second bullet']), ['• First bullet', '• Second bullet']);
  assert.deepEqual(joinWrapped(['Company,', 'Somewhere']), ['Company, Somewhere']);
});
