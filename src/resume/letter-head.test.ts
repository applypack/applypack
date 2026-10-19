import { test } from 'node:test';
import assert from 'node:assert/strict';
import { letterHead, letterPaper } from './letter-head';

const DAY = new Date('2026-10-19T12:00:00Z');

test('#581: Letter paper for a posting in the US or Canada, A4 for the rest and for one that names no country', () => {
  assert.equal(letterPaper(['US']), 'letter');
  assert.equal(letterPaper(['US', 'CA']), 'letter');
  assert.equal(letterPaper(['DE']), 'a4');
  assert.equal(letterPaper(['US', 'DE']), 'a4');
  assert.equal(letterPaper([]), 'a4');
});

test('the sender and their contact line come off the resume header, the date as the paper’s country writes it', () => {
  // The scratch install's resume, as uploaded (Markdown).
  const md = '# Alex Rivera\nSenior Backend Engineer · Austin, TX · alex.rivera@example.com · (512) 555-0147 · github.com/alexrivera\n\n## Summary\nBackend engineer with 8 years.';
  assert.deepEqual(letterHead(md, 'letter', DAY, 'UTC'), {
    name: 'Alex Rivera',
    contact: 'Austin, TX · alex.rivera@example.com · (512) 555-0147 · github.com/alexrivera',
    date: 'October 19, 2026',
  });
  const berlin = letterHead('Marta Keller\nmarta@example.com | +49 30 1234567 | Berlin, Germany\n\nSUMMARY\nBackend engineer.', 'a4', DAY, 'Europe/Berlin');
  assert.equal(berlin.name, 'Marta Keller');
  assert.equal(berlin.contact, 'marta@example.com · +49 30 1234567 · Berlin, Germany');
  assert.equal(berlin.date, '19 October 2026');
});

test('#624: the head carries the city and leaves the headline out, even a headline with a comma', () => {
  const md = '# Alex Rivera\nSoftware Engineer, Backend · Austin, TX · alex.rivera@example.com · (512) 555-0147 · github.com/alexrivera\n\n## Summary\nBackend engineer.';
  assert.equal(letterHead(md, 'letter', DAY, 'UTC').contact, 'Austin, TX · alex.rivera@example.com · (512) 555-0147 · github.com/alexrivera');
  // A headline on a line of its own stays out too.
  const own = letterHead('Alex Rivera\nSoftware Engineer, Backend\nalex.rivera@example.com | Austin, TX\n\nSUMMARY\nBackend engineer.', 'a4', DAY, 'UTC');
  assert.equal(own.contact, 'alex.rivera@example.com · Austin, TX');
});

test('a resume with no header gives no name and no contact line, only the date', () => {
  assert.deepEqual(letterHead('', 'a4', DAY, 'UTC'), { name: null, contact: null, date: '19 October 2026' });
});
