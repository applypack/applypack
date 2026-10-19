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

test('a name in the Title style opens the header, not a section (#591)', () => {
  const r = structureFromText(
    ['# Alex Rivera', 'Senior Backend Engineer · Austin, TX · alex@example.com', '', '## Summary', 'Backend engineer.', '', '# Side notes', 'One.'].join('\n'),
  );
  assert.equal(r.basics.name, 'Alex Rivera');
  assert.equal(r.basics.label, 'Senior Backend Engineer');
  assert.equal(r.basics.email, 'alex@example.com');
  assert.equal(r.basics.summary, 'Backend engineer.');
  // A Title line further down is still a heading.
  assert.deepEqual(r.extras.map((e) => e.heading), ['Side notes']);
});

test('a sentence with a comma is not a place', () => {
  // A resume with no headings is all header, and its prose has commas too.
  const flat = `Jane Example — Backend Engineer. Skills: Node.js, PostgreSQL.
Experience: Acme (2021–2026), backend engineer — built the billing service,
moved it from MySQL to PostgreSQL, cut p95 latency by 40%. Education: BSc.`;
  assert.equal(structureFromText(flat).basics.location, null);
  assert.equal(structureFromText('Jane Example\nKyiv, Ukraine (open to relocation) · jane@example.com').basics.location, 'Kyiv, Ukraine (open to relocation)');
  assert.equal(structureFromText('Jane Example\nWashington, D.C. · jane@example.com').basics.location, 'Washington, D.C.');
  assert.equal(structureFromText('Jane Example\nBuilt APIs, led teams. · jane@example.com').basics.location, null);
});

test('a wrapped PDF bullet is joined back into one bullet', () => {
  const bullets = structureFromText(PDF_STYLE).work[0]?.highlights ?? [];
  assert.equal(bullets.length, 2);
  assert.equal(
    bullets[0],
    'Led backend architecture for PHP systems processing high-volume financial transactions, supporting millions in annual revenue.',
  );
});

test('a trailing tech-stack line joins its role, after its bullets, instead of becoming one', () => {
  for (const text of [DOCX_STYLE, PDF_STYLE]) {
    const work = structureFromText(text).work;
    assert.equal(work.length, 2, 'no phantom third role');
    assert.match(work[0]?.after ?? '', /Technology Stack: PHP, Laravel, MySQL\./);
    assert.equal(work[0]?.summary, null, 'not a summary: the resume writes it after the bullets');
  }
});

test('the resume’s own section headings and the header lines no field reads are kept', () => {
  const r = structureFromText(
    'Nazar Boyko\nSenior Software Engineer\nAustin, Texas ∙ nb@example.com\nFully Work Authorized ∙ No Visa Sponsorship Required\n\nKEY SKILLS\nProgramming: PHP, Go\n\nPROFESSIONAL EXPERIENCE\nV Shred\nEngineer Jan 2020 – Present\n• Built things.',
  );
  assert.deepEqual(r.headings, { skills: 'KEY SKILLS', work: 'PROFESSIONAL EXPERIENCE' });
  assert.deepEqual(r.basics.lines, ['Fully Work Authorized ∙ No Visa Sponsorship Required']);
  assert.equal(r.basics.email, 'nb@example.com');
});

test('a skills line in capitals is a list, not a section heading', () => {
  const r = structureFromText('Alex\n\nKEY SKILLS\nProgramming: PHP, Go\nAWS, S3, EC2, SQS, RDS, OWASP\n');
  assert.deepEqual(Object.keys(r.headings), ['skills']);
  assert.deepEqual(r.skills.at(-1)?.keywords, ['AWS', 'S3', 'EC2', 'SQS', 'RDS', 'OWASP']);
});

test('a title with its own separators is the label once, not a header line too', () => {
  const r = structureFromText(
    'Nazar Boyko\nProduct Lead - PHP/Laravel Engineer | Roadmap Ownership & Architecture\nAustin, Texas ∙ nb@example.com\nFully Work Authorized ∙ No Visa Sponsorship Required\n\nSKILLS\nPHP, Go',
  );
  assert.equal(r.basics.label, 'Product Lead - PHP/Laravel Engineer | Roadmap Ownership & Architecture');
  assert.deepEqual(r.basics.lines, ['Fully Work Authorized ∙ No Visa Sponsorship Required']);
});

test('a long line marked as a heading is content, not a heading', () => {
  const r = structureFromText('Alex\n\n## SKILLS PHP 8, Laravel, Docker MySQL, Redis ## EDUCATION BSc Computer Science, State University, 2012 | ## EXPERIENCE Marketplace Co\n');
  assert.equal(Object.keys(r.headings).length, 0);
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

test('a heading in ordinary case is a section when the whole line is one', () => {
  const r = structureFromText(
    'Dana Ruiz\nLisbon, Portugal | dana@example.com\n\nSummary\nFull-stack engineer.\n\nWork experience:\nSenior Developer - Harborline, 2022-present\n- Built the dispatch API\n\nEducation\nBSc Computer Science, 2019\n\nSkills & Tools\nTypeScript, React, PostgreSQL\n',
  );
  assert.deepEqual(r.headings, { summary: 'Summary', work: 'Work experience', education: 'Education', skills: 'Skills & Tools' });
  assert.equal(r.basics.summary, 'Full-stack engineer.');
  assert.equal(r.work.length, 1);
  assert.deepEqual(r.basics.lines, []);
});

test('a wrapped line that opens with a section word stays content', () => {
  const r = structureFromText('Alex\n\nSUMMARY\nTen years of backend work, with\nExperience in payments\nand logistics.\n');
  assert.equal(Object.keys(r.headings).length, 1);
  assert.match(r.basics.summary ?? '', /Experience in payments/);
});

test('a contact line that opens with the title gives the label, and a date takes its comma with it', () => {
  const r = structureFromText(
    'Dana Ruiz\nSenior Full-Stack Developer | dana@example.com | github.com/dana | Lisbon, Portugal\n\nExperience\nSenior Developer - Harborline (remote), 2022-present\n- Built the dispatch API\n',
  );
  assert.equal(r.basics.label, 'Senior Full-Stack Developer');
  assert.deepEqual(r.basics.lines, []);
  assert.equal(r.basics.location, 'Lisbon, Portugal');
  assert.equal(r.work[0]?.position, 'Senior Developer - Harborline (remote)');
  assert.equal(r.work[0]?.startDate, '2022');
});
