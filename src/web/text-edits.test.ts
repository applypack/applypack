import { test } from 'node:test';
import assert from 'node:assert/strict';

// The edit operations ship to the browser as a static ES module; node loads it the same way.
type Edit = { text: string; span: { start: number; end: number } } | { error: string };
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const edits = import('./public/text-edits.mjs') as Promise<{
  applyReplacement: (text: string, quote: string, replacement: string) => Edit;
  removeSpan: (text: string, quote: string) => Edit;
  insertIntoSkills: (text: string, term: string, where?: string) => Edit;
  moveLineToBlockTop: (text: string, quote: string) => Edit;
}>;

const ok = (r: Edit) => {
  assert.ok(!('error' in r), 'error' in r ? `unexpected error: ${r.error}` : '');
  return r as { text: string; span: { start: number; end: number } };
};
const err = (r: Edit) => {
  assert.ok('error' in r, 'expected an error, got an edit');
  return (r as { error: string }).error;
};

/*
 * A fixture in the shape the live corpus actually has: a contact line carrying
 * the email and phone, a KEY SKILLS section whose labels are bare and whose
 * values are stacked below (all six stored resumes look like this), and a
 * bullet block.
 */
const RESUME = [
  'Nazar Boyko',
  'Senior Full-Stack Engineer',
  'Austin, Texas, 78758 ∙ boyko.nazar@gmail.com ∙ +1 (612) 267-5544',
  '',
  'PROFESSIONAL SUMMARY',
  'Senior engineer (10+ years) shipping production systems end-to-end.',
  '',
  'KEY SKILLS',
  'Programming:',
  'Frameworks/Libraries:',
  'Go, PHP, JavaScript, TypeScript',
  '',
  'EXPERIENCE',
  '• Led backend architecture for PHP services processing payments.',
  '• Built a multi-gateway payment platform from scratch in Laravel.',
  '• Improved SEO rankings for marketing pages.',
].join('\n');

test('applyReplacement swaps exactly the quoted span', async () => {
  const { applyReplacement } = await edits;
  const r = ok(applyReplacement(RESUME, 'Senior Full-Stack Engineer', 'Back end Developer | Senior PHP Engineer'));
  assert.match(r.text, /^Back end Developer \| Senior PHP Engineer$/m);
  assert.equal(r.text.includes('Senior Full-Stack Engineer'), false);
  assert.equal(r.text.split('\n').length, RESUME.split('\n').length, 'no line was added or lost');
  assert.equal(r.text.slice(r.span.start, r.span.end), 'Back end Developer | Senior PHP Engineer');
});

test('applyReplacement keeps the bullet marker when the quote swallowed it', async () => {
  const { applyReplacement } = await edits;
  const r = ok(
    applyReplacement(RESUME, '• Improved SEO rankings for marketing pages.', 'Rebuilt the marketing site on Next.js.'),
  );
  assert.match(r.text, /^• Rebuilt the marketing site on Next\.js\.$/m);
  assert.equal(r.text.includes('• • '), false);
});

test('applyReplacement does not double a marker that was outside the quote', async () => {
  const { applyReplacement } = await edits;
  const r = ok(applyReplacement(RESUME, 'Improved SEO rankings for marketing pages.', 'Rebuilt the marketing site.'));
  assert.match(r.text, /^• Rebuilt the marketing site\.$/m);
});

test('applyReplacement refuses a quote it cannot find or an empty wording', async () => {
  const { applyReplacement } = await edits;
  assert.equal(err(applyReplacement(RESUME, 'nothing like this is in the resume at all', 'x')), 'not-found');
  assert.equal(err(applyReplacement(RESUME, 'Senior Full-Stack Engineer', '   ')), 'no-replacement');
});

test('removeSpan takes the whole line and its newline when the quote is the line', async () => {
  const { removeSpan } = await edits;
  const r = ok(removeSpan(RESUME, '• Improved SEO rankings for marketing pages.'));
  assert.equal(r.text.includes('SEO'), false);
  assert.equal(r.text.split('\n').length, RESUME.split('\n').length - 1, 'the line is gone, not blanked');
  assert.equal(r.text.endsWith('\n'), false, 'no trailing blank line left behind');
});

test('removeSpan cuts only the span when the quote is part of a line', async () => {
  const { removeSpan } = await edits;
  const r = ok(removeSpan(RESUME, 'shipping production systems end-to-end.'));
  assert.match(r.text, /^Senior engineer \(10\+ years\)\s*$/m, 'the rest of the line survives');
  assert.equal(r.text.split('\n').length, RESUME.split('\n').length, 'no line was removed');
});

test('removeSpan refuses the contact line — email and phone are not edits to make blind', async () => {
  const { removeSpan } = await edits;
  // The real corpus quotes this line 7 times in 237; gotcha 11 is exactly this.
  assert.equal(err(removeSpan(RESUME, 'Austin, Texas, 78758')), 'protected');
  assert.equal(err(removeSpan(RESUME, '78758')), 'protected');
  assert.equal(err(removeSpan(RESUME, 'Austin, Texas, 78758 ∙ boyko.nazar@gmail.com ∙ +1 (612) 267-5544')), 'protected');
});

test('removeSpan leaves a date range alone — 8 digits is not a phone', async () => {
  const { removeSpan } = await edits;
  const text = 'EXPERIENCE\nSenior Engineer 2022-2026 at Acme\n• A bullet.';
  const r = ok(removeSpan(text, 'Senior Engineer 2022-2026 at Acme'));
  assert.equal(r.text.includes('2022-2026'), false);
});

test('insertIntoSkills appends to a real term list with the separator it already uses', async () => {
  const { insertIntoSkills } = await edits;
  const text = 'KEY SKILLS\nProgramming: Go, PHP, JavaScript\nFrameworks: Laravel | Vue | React';
  assert.match(ok(insertIntoSkills(text, 'Kotlin', 'Programming line')).text, /^Programming: Go, PHP, JavaScript, Kotlin$/m);
  assert.match(ok(insertIntoSkills(text, 'Svelte', 'Frameworks line')).text, /^Frameworks: Laravel \| Vue \| React \| Svelte$/m);
});

test('insertIntoSkills refuses the stacked-label shape every stored resume has', async () => {
  const { insertIntoSkills } = await edits;
  // "Programming:" is a bare label; the values are three lines below. Appending
  // there would write the term onto a label — measured on all 6 live resumes.
  assert.equal(err(insertIntoSkills('KEY SKILLS\nProgramming:\nFrameworks/Libraries:\nOthers:', 'Kotlin', 'Programming')), 'no-skills-list');
  // A run of labels glued onto one line is not a term list either.
  assert.equal(
    err(insertIntoSkills('KEY SKILLS\nProgramming: Frameworks/Libraries: Data Storages: Others:', 'Kotlin', 'Programming')),
    'no-skills-list',
  );
});

test('insertIntoSkills is a no-op for a term the resume already claims', async () => {
  const { insertIntoSkills } = await edits;
  const text = 'KEY SKILLS\nProgramming: Go, PHP, JavaScript';
  assert.equal(err(insertIntoSkills(text, 'PHP', 'Programming')), 'already-present');
  assert.equal(err(insertIntoSkills(text, '  ', 'Programming')), 'no-term');
});

test('insertIntoSkills prefers a list under a skills heading over an unrelated one', async () => {
  const { insertIntoSkills } = await edits;
  const text = ['EXPERIENCE', 'Shipped A, B, C for the team', '', 'KEY SKILLS', 'Programming: Go, PHP'].join('\n');
  assert.match(ok(insertIntoSkills(text, 'Rust', 'nothing that matches')).text, /^Programming: Go, PHP, Rust$/m);
});

test('moveLineToBlockTop lifts a bullet to the top of its own block', async () => {
  const { moveLineToBlockTop } = await edits;
  const r = ok(moveLineToBlockTop(RESUME, 'Built a multi-gateway payment platform from scratch in Laravel.'));
  const bullets = r.text.split('\n').filter((l) => l.startsWith('•'));
  assert.equal(bullets[0], '• Built a multi-gateway payment platform from scratch in Laravel.');
  assert.equal(bullets.length, 3, 'nothing was lost');
  assert.equal(r.text.slice(r.span.start, r.span.end), bullets[0]);
});

test('moveLineToBlockTop refuses a paragraph and a bullet already on top', async () => {
  const { moveLineToBlockTop } = await edits;
  assert.equal(err(moveLineToBlockTop(RESUME, 'Senior engineer (10+ years)')), 'not-a-bullet');
  assert.equal(err(moveLineToBlockTop(RESUME, 'Led backend architecture for PHP services')), 'already-first');
  assert.equal(err(moveLineToBlockTop(RESUME, 'no such line anywhere in this text')), 'not-found');
});

test('the operations read a two-line quote, which 22 stored quotes are', async () => {
  const { applyReplacement, removeSpan } = await edits;
  const text = 'SUMMARY\nDesigned and integrated real-time address\nverification services (USPS, Smarty).\n• Kept.';
  const quote = 'Designed and integrated real-time address verification services (USPS, Smarty).';
  assert.match(ok(applyReplacement(text, quote, 'Integrated USPS and Smarty address verification.')).text, /Integrated USPS/);
  const cut = ok(removeSpan(text, quote));
  assert.equal(cut.text.includes('USPS'), false);
  assert.match(cut.text, /^• Kept\.$/m);
});

test('every operation leaves the input string untouched', async () => {
  const { applyReplacement, removeSpan, insertIntoSkills, moveLineToBlockTop } = await edits;
  const before = RESUME;
  applyReplacement(RESUME, 'Senior Full-Stack Engineer', 'X');
  removeSpan(RESUME, '• Improved SEO rankings for marketing pages.');
  insertIntoSkills(RESUME, 'Rust', 'Programming');
  moveLineToBlockTop(RESUME, 'Built a multi-gateway payment platform from scratch in Laravel.');
  assert.equal(RESUME, before);
});
