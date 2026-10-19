import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWarnings } from '../resume/parse-warnings';
import { parsedView } from './parsed-view';

// TASKS R12: the parts a plain parser finds, and the ones it does not.
const RESUME = `Jane Example
Senior Backend Engineer
jane@example.com · +48 600 100 200 · github.com/jane · Warsaw, Poland

SUMMARY
Backend engineer who ships billing systems.

EXPERIENCE
Senior Backend Engineer — Acme
Jan 2021 – Present
- Built the billing service in Node.js.
- Cut p95 latency by 40%.
Backend Developer — Beta Corp
- Wrote REST APIs in PHP.

SKILLS
Node.js, TypeScript, PostgreSQL
`;

test('the name, the contacts, the sections and the roles a parser reads', () => {
  const view = parsedView(RESUME);
  assert.equal(view.name, 'Jane Example');
  assert.equal(view.headline, 'Senior Backend Engineer');
  assert.deepEqual(view.contacts.map((c) => [c.label, c.value !== null]), [
    ['Email', true],
    ['Phone', true],
    ['Link', true],
    ['Location', true],
  ]);
  assert.deepEqual(view.sections, ['Summary', 'Skills (1 group)', 'Experience (2 roles)']);
  assert.equal(view.roles[0]!.dates, 'Jan 2021 – Present');
  assert.equal(view.roles[0]!.bullets, 2);
  // The role with no dates is the one a filter drops: the page badges it.
  assert.equal(view.roles[1]!.dates, null);
});

test('a text that opens on a section says what is missing', () => {
  const view = parsedView('EXPERIENCE\nBackend Developer — Beta Corp\n- Wrote REST APIs in PHP.');
  assert.ok(view.contacts.every((c) => c.value === null));
  assert.deepEqual(view.sections, ['Experience (1 role)']);
});

test('a Markdown resume shows its name and contacts, as the warnings line does (#573)', () => {
  const text = readFileSync(join(__dirname, '..', 'resume', 'fixtures', 'markdown-headed-roles.md'), 'utf8');
  const view = parsedView(text);
  assert.equal(view.name, 'Marta Keller');
  assert.ok(view.contacts.every((c) => c.value !== null), JSON.stringify(view.contacts));
  assert.deepEqual(view.sections, ['Summary', 'Skills (3 groups)', 'Experience (2 roles)', 'Education', 'Languages']);
  assert.deepEqual(view.roles.map((r) => [r.title, r.dates]), [
    ['Senior Backend Engineer — Marketplace Co', 'March 2021 – Present'],
    ['Backend Engineer — Payments GmbH', 'June 2017 – February 2021'],
  ]);
  assert.equal(view.education[0]?.title, 'B.Sc. Computer Science — TU Berlin');
  // The line under the view says "contact details found" when these two are absent.
  const codes = parseWarnings(text).map((w) => w.code);
  assert.ok(!codes.includes('no_email') && !codes.includes('no_phone'));
});

test('the separators a flattened table row leaves are not part of a name', () => {
  // How the .docx reader renders a two-cell role line and an education row (gotcha 18).
  const view = parsedView('Jane Example\n\nEXPERIENCE\nSenior Backend Engineer Acme | | Jan 2021 – Present\n- Built the billing service.\n\nEDUCATION\nBSc Computer Science Warsaw University of Technology | | 2014 – 2018');
  assert.equal(view.roles[0]?.title, 'Senior Backend Engineer Acme');
  assert.equal(view.roles[0]?.dates, 'Jan 2021 – Present');
  assert.equal(view.education[0]?.title, 'BSc Computer Science Warsaw University of Technology');
});
