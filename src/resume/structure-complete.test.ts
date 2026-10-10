import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JsonResume } from './json-resume';
import { anchorStructure, structureIsUsable } from './structure-anchor';
import { structureGaps, structureIsComplete } from './structure-complete';
import { structureFromText } from './structure-from-text';

const role = (company: string, years: string, bullets: string[]): string[] => [
  `${company} — Senior Software Engineer`,
  years,
  ...bullets.map((b) => `- ${b}`),
  '',
];

const RESUME = [
  'Alex Example',
  'Senior Software Engineer',
  'alex@example.com | +1 555 010 0199',
  '',
  'SUMMARY',
  'Backend engineer with twelve years of PHP and Node.js behind payment and media products.',
  '',
  'EXPERIENCE',
  ...role('Northwind Fitness', 'Jan 2021 – Present', [
    'Designed Laravel payment workflows processing four million dollars a month.',
    'Cut checkout failures by moving retries onto Redis-backed queues.',
    'Led the migration of the monolith to services over two quarters.',
    'Mentored four engineers through their first on-call rotations.',
  ]),
  ...role('Vodwork Media', 'Mar 2018 – Dec 2020', [
    'Built the video transcoding pipeline on AWS Elastic Transcoder.',
    'Introduced contract tests between the API and three mobile clients.',
    'Reduced page load by caching rendered fragments at the edge.',
    'Owned the subscription billing integration with Stripe.',
  ]),
  ...role('Probegin Labs', 'Jun 2015 – Feb 2018', [
    'Shipped a multi-tenant CMS used by forty regional newsrooms.',
    'Replaced nightly cron imports with an event stream on RabbitMQ.',
    'Wrote the search service on Elasticsearch with typo tolerance.',
    'Kept the legacy Symfony application on supported PHP versions.',
  ]),
  ...role('Incity Portal', 'Sep 2009 – May 2015', [
    'Maintained the city portal serving two hundred thousand monthly readers.',
    'Automated classified-ad moderation with keyword and image rules.',
    'Moved deployments from FTP uploads to scripted releases.',
    'Supported the editorial team with reporting dashboards.',
  ]),
  'EDUCATION',
  'Lviv Polytechnic — BSc Computer Science',
  '2005 – 2009',
].join('\n');

/** The reading a careful model returns: here, the built-in reader's own, which by construction holds every line. */
const whole = (): JsonResume => structuredClone(structureFromText(RESUME));

test('the yardstick reads the fixture as four roles of four bullets', () => {
  const plain = structureFromText(RESUME);
  assert.equal(plain.work.length, 4);
  assert.deepEqual(plain.work.map((w) => w.highlights.length), [4, 4, 4, 4]);
});

test('a reading that holds every role and bullet is complete', () => {
  const gaps = structureGaps(whole(), RESUME);
  assert.deepEqual(gaps, { roles: 4, rolesInText: 4, lostRoles: [], linesInText: 16, lostLines: 0 });
  assert.equal(structureIsComplete(gaps), true);
});

test('the live case: two roles of four read, every string verbatim — the anchor passes it, this does not', () => {
  const partial = whole();
  partial.work = partial.work.slice(0, 2);
  const anchored = anchorStructure(partial, RESUME);
  assert.equal(anchored.dropped, 0, 'nothing was rewritten, so the anchor has nothing to say');
  assert.equal(structureIsUsable(anchored), true);

  const gaps = structureGaps(anchored.structure, RESUME);
  assert.equal(gaps.roles, 2);
  assert.equal(gaps.rolesInText, 4);
  assert.equal(gaps.lostRoles.length, 2);
  assert.match(gaps.lostRoles.join(' | '), /Probegin Labs.*\|.*Incity Portal/);
  assert.equal(gaps.lostLines, 8);
  assert.equal(structureIsComplete(gaps), false);
});

test('one bullet short of sixteen is drawn and counted; three short is not drawn', () => {
  const one = whole();
  one.work[2]!.highlights.pop();
  const few = structureGaps(one, RESUME);
  assert.equal(few.lostLines, 1);
  assert.deepEqual(few.lostRoles, []);
  assert.equal(structureIsComplete(few), true);

  const three = whole();
  three.work[0]!.highlights.pop();
  three.work[1]!.highlights.pop();
  three.work[2]!.highlights.pop();
  const many = structureGaps(three, RESUME);
  assert.equal(many.lostLines, 3);
  assert.equal(structureIsComplete(many), false);
});

test('a role filed under another section is not lost: its lines are still in the reading', () => {
  const moved = whole();
  const [last] = moved.work.splice(3, 1);
  moved.projects.push({ name: last!.name, description: null, url: null, highlights: last!.highlights });
  const gaps = structureGaps(moved, RESUME);
  assert.deepEqual(gaps.lostRoles, []);
  assert.equal(gaps.lostLines, 0);
  assert.equal(structureIsComplete(gaps), true);
});

test('the two readers may cut a line differently and still agree it is there', () => {
  // The model split one bullet in two …
  const split = whole();
  split.work[0]!.highlights.splice(0, 1, 'Designed Laravel payment workflows', 'processing four million dollars a month.');
  assert.equal(structureGaps(split, RESUME).lostLines, 0);
  // … or kept most of one and filed its tail elsewhere.
  const trimmed = whole();
  trimmed.work[1]!.highlights[0] = 'Built the video transcoding pipeline on AWS';
  assert.equal(structureGaps(trimmed, RESUME).lostLines, 0);
});

test('a role with no bullets is judged by its company and title, and its paragraph counts as a line', () => {
  const text = ['EXPERIENCE', 'Northwind Fitness — Staff Engineer', 'Jan 2021 – Present', 'Ran the platform team of nine across payments and identity.', '', 'EDUCATION', 'Lviv Polytechnic'].join('\n');
  const plain = structureFromText(text);
  assert.equal(plain.work.length, 1);
  assert.equal(structureIsComplete(structureGaps(plain, text)), true);

  // The model named the role and left its paragraph out: the role is there, a line of it is not.
  const thin = structuredClone(plain);
  thin.work[0]!.summary = null;
  thin.work[0]!.highlights = [];
  const thinGaps = structureGaps(thin, text);
  assert.deepEqual(thinGaps.lostRoles, []);
  assert.equal(thinGaps.lostLines, 1);
  assert.equal(structureIsComplete(thinGaps), false);

  // The model left the whole role out.
  const none = structuredClone(plain);
  none.work = [];
  const gone = structureGaps(none, text);
  assert.equal(gone.lostRoles.length, 1);
  assert.equal(structureIsComplete(gone), false);
});

test('a resume with no roles at all has nothing to lose', () => {
  const text = ['SKILLS', 'PHP, Laravel, MySQL'].join('\n');
  const gaps = structureGaps(structureFromText(text), text);
  assert.deepEqual(gaps, { roles: 0, rolesInText: 0, lostRoles: [], linesInText: 0, lostLines: 0 });
  assert.equal(structureIsComplete(gaps), true);
});
