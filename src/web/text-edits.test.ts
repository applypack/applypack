import { test } from 'node:test';
import assert from 'node:assert/strict';

// The edit operations ship to the browser as a static ES module; node loads it the same way.
type Edit = { text: string; span: { start: number; end: number } } | { error: string };
// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const edits = import('./public/text-edits.mjs') as Promise<{
  applyReplacement: (text: string, quote: string, replacement: string) => Edit;
  removeSpan: (text: string, quote: string) => Edit;
  insertIntoSkills: (text: string, term: string, where?: string) => Edit;
  insertAfterLine: (text: string, anchor: string, wording: string) => Edit;
  inverseEdit: (before: string, after: string) => { start: number; removed: string; inserted: string };
  undoEdit: (text: string, edit: { start: number; removed: string; inserted: string }) => Edit;
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

test('insertIntoSkills refuses a section of labels with no values at all', async () => {
  const { insertIntoSkills } = await edits;
  // Bare labels and nothing to append to: there is no list, so no button.
  assert.equal(err(insertIntoSkills('KEY SKILLS\nProgramming:\nFrameworks/Libraries:\nOthers:', 'Kotlin', 'Programming')), 'no-skills-list');
  // A run of labels glued onto one line is not a term list either.
  assert.equal(
    err(insertIntoSkills('KEY SKILLS\nProgramming: Frameworks/Libraries: Data Storages: Others:', 'Kotlin', 'Programming')),
    'no-skills-list',
  );
});

test('insertIntoSkills never writes to the contact line', async () => {
  const { insertIntoSkills } = await edits;
  // The first live walk did exactly this: the contact line splits on ", " into
  // four parts with no colon, so it passed for a term list and a keyword was
  // appended after the LinkedIn URL. Nothing outside a skills section is a
  // skills list, and the contact line is refused on top of that.
  const r = insertIntoSkills(RESUME, 'GraphQL', 'Key Skills, Programming line');
  if (!('error' in r)) {
    assert.equal(r.text.split('\n')[2], RESUME.split('\n')[2], 'the contact line is untouched');
    assert.equal(r.text.includes('nazar-boyko, GraphQL'), false);
  }
});

test('insertIntoSkills reads a bare label as part of the section, not the end of it', async () => {
  const { insertIntoSkills } = await edits;
  // Every stored resume stacks labels and then values; "Programming:" must not
  // close KEY SKILLS, or the value lines below it are never seen as the target.
  const text = [
    'Nazar Boyko',
    'Austin, Texas ∙ nazar@example.com ∙ +1 (612) 267-5544',
    'KEY SKILLS',
    'Programming:',
    'Frameworks/Libraries:',
    'Go, PHP, JavaScript, TypeScript',
    'EXPERIENCE',
    'Shipped A, B, C for the team',
  ].join('\n');
  const r = ok(insertIntoSkills(text, 'Rust', 'Key Skills, Programming line'));
  assert.match(r.text, /^Go, PHP, JavaScript, TypeScript, Rust$/m, 'landed on the value line under the labels');
  assert.equal(r.text.includes('267-5544, Rust'), false, 'not the contact line');
  assert.equal(r.text.includes('B, C for the team, Rust'), false, 'not a sentence in EXPERIENCE');
});

test('insertIntoSkills refuses a term list that is not in a skills section', async () => {
  const { insertIntoSkills } = await edits;
  const text = 'EXPERIENCE\nShipped A, B and C, then D for the team\nSUMMARY\nOne, two, three.';
  assert.equal(err(insertIntoSkills(text, 'Rust', 'Programming')), 'no-skills-list');
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
  const { applyReplacement, removeSpan, insertIntoSkills } = await edits;
  const before = RESUME;
  applyReplacement(RESUME, 'Senior Full-Stack Engineer', 'X');
  removeSpan(RESUME, '• Improved SEO rankings for marketing pages.');
  insertIntoSkills(RESUME, 'Rust', 'Programming');
  assert.equal(RESUME, before);
});

test('inverseEdit names only the part that changed', async () => {
  const { inverseEdit } = await edits;
  assert.deepEqual(inverseEdit('Alpha bravo charlie', 'Alpha DELTA charlie'), {
    start: 6, removed: 'bravo', inserted: 'DELTA',
  });
  // A pure insertion and a pure deletion are the same shape with one side empty.
  assert.deepEqual(inverseEdit('Alpha charlie', 'Alpha bravo charlie'), { start: 6, removed: '', inserted: 'bravo ' });
  assert.deepEqual(inverseEdit('Alpha bravo charlie', 'Alpha charlie'), { start: 6, removed: 'bravo ', inserted: '' });
  assert.deepEqual(inverseEdit('same', 'same'), { start: 4, removed: '', inserted: '' });
});

test('inverseEdit round-trips every operation', async () => {
  const { applyReplacement, removeSpan, insertIntoSkills, inverseEdit, undoEdit } = await edits;
  const text = 'KEY SKILLS\nProgramming: Go, PHP\n\nEXPERIENCE\n• Led backend architecture.\n• Improved SEO rankings.';
  const runs = [
    applyReplacement(text, 'Led backend architecture.', 'Owned the payments backend end to end.'),
    removeSpan(text, '• Improved SEO rankings.'),
    insertIntoSkills(text, 'Rust', 'Programming'),
  ];
  for (const r of runs) {
    const after = ok(r).text;
    const back = ok(undoEdit(after, inverseEdit(text, after)));
    assert.equal(back.text, text, 'undo restores the text exactly');
  }
});

test('insertAfterLine adds the wording as the next line and inherits the bullet marker', async () => {
  const { insertAfterLine } = await edits;
  const r = ok(insertAfterLine(RESUME, 'Built a multi-gateway payment platform from scratch in Laravel.', 'Cut checkout failures 18% with retry queues.'));
  const lines = r.text.split('\n');
  const i = lines.findIndex((l) => l.includes('multi-gateway'));
  assert.equal(lines[i + 1], '• Cut checkout failures 18% with retry queues.', 'takes the anchor line’s marker');
  assert.equal(lines.length, RESUME.split('\n').length + 1, 'exactly one line added');
  assert.equal(r.text.slice(r.span.start, r.span.end), '• Cut checkout failures 18% with retry queues.');
});

test('insertAfterLine does not double a marker the wording already carries, nor add one under a paragraph', async () => {
  const { insertAfterLine } = await edits;
  const withMarker = ok(insertAfterLine(RESUME, 'Improved SEO rankings', '- Already a bullet.'));
  assert.match(withMarker.text, /^- Already a bullet\.$/m);
  assert.equal(withMarker.text.includes('• - '), false);
  const underProse = ok(insertAfterLine(RESUME, 'Senior engineer (10+ years)', 'Remote full-time since 2015.'));
  assert.match(underProse.text, /^Remote full-time since 2015\.$/m);
});

test('insertAfterLine lands after the LAST line of a two-line anchor and refuses a missing one', async () => {
  const { insertAfterLine } = await edits;
  const text = 'SUMMARY\nDesigned and integrated real-time address\nverification services (USPS, Smarty).\n• Kept.';
  const r = ok(insertAfterLine(text, 'Designed and integrated real-time address verification services (USPS, Smarty).', 'New line.'));
  assert.deepEqual(r.text.split('\n').slice(2, 4), ['verification services (USPS, Smarty).', 'New line.']);
  assert.equal(err(insertAfterLine(text, 'no such anchor anywhere here', 'x')), 'not-found');
  assert.equal(err(insertAfterLine(text, 'Kept.', '  ')), 'no-replacement');
});

test('undoEdit refuses once the user has typed over the edit', async () => {
  const { applyReplacement, inverseEdit, undoEdit } = await edits;
  const text = 'Alpha\nBravo line here\nCharlie';
  const after = ok(applyReplacement(text, 'Bravo line here', 'Delta line here')).text;
  const edit = inverseEdit(text, after);
  assert.equal(err(undoEdit(after.replace('Delta', 'Echo'), edit)), 'moved-on');
  // And it still works on the untouched text.
  assert.equal(ok(undoEdit(after, edit)).text, text);
});
