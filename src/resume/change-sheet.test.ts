import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposalOf, suggestionSheet } from './change-sheet';
import type { MatchAction, MatchRemoval } from './prompts';

const action = (what: string, over: Partial<MatchAction> = {}): MatchAction => ({
  section: 'summary',
  where: 'PROFESSIONAL SUMMARY',
  what,
  why: 'matches the posting',
  priority: 'high',
  quote: null,
  ...over,
});

/*
 * Every shape below is a verbatim `actions[].what` from the live database
 * (209 rows, 2026-09-04). Single quotes outnumber double quotes 131 to 45 and
 * curly quotes never occur, so the straight single quote — which is also the
 * apostrophe — carries most of the corpus.
 */
test('proposalOf reads the eight quoting shapes the model actually writes', () => {
  const cases: [string, string, string | null][] = [
    [
      `Rewrite as: "Back end developer with 10+ years building PHP and Laravel web applications."`,
      'Back end developer with 10+ years building PHP and Laravel web applications.',
      'Rewrite',
    ],
    [
      `Reword: 'Led code reviews and design guidance for the engineering team, raising code quality 20%.'`,
      'Led code reviews and design guidance for the engineering team, raising code quality 20%.',
      'Reword',
    ],
    [`Change to "Senior Backend Engineer"`, 'Senior Backend Engineer', 'Change'],
    [
      `Add: 'Converts business needs into technical specifications and resolves software bugs.'`,
      'Converts business needs into technical specifications and resolves software bugs.',
      'Add',
    ],
    [
      `Reorder to 'React.js, Vue.js, Node.js, Laravel, Symfony' so React appears early.`,
      'React.js, Vue.js, Node.js, Laravel, Symfony',
      'Reorder',
    ],
    [`Change title to "Senior Full-Stack PHP Engineer"`, 'Senior Full-Stack PHP Engineer', 'Change title'],
    [
      `Lead with: 'Built and ran 10+ PHP/Laravel microservices on AWS with Elasticsearch.'`,
      'Built and ran 10+ PHP/Laravel microservices on AWS with Elasticsearch.',
      'Lead',
    ],
    [
      `Rewrite so the stack is in the bullet, not just the footer: 'Built and owned PHP 8 services.'`,
      'Built and owned PHP 8 services.',
      // The lead is a sentence, not a label — the card falls back to "Proposed".
      null,
    ],
  ];
  for (const [what, text, verb] of cases) {
    const got = proposalOf(action(what));
    assert.deepEqual(got, { text, verb }, what);
  }
});

test('proposalOf takes the wording after a swap connective, not the one before it', () => {
  // Both spans are 19 characters: without the connective rule this is a coin toss.
  assert.equal(
    proposalOf(action(`Change 'Windsurf (Opus 4.6)' to just 'Windsurf and Claude' with no version number.`))?.text,
    'Windsurf and Claude',
  );
  assert.equal(
    proposalOf(
      action(
        `Replace 'Senior Software Engineer' with 'Senior Full-Stack PHP & Vue Developer | Laravel · TypeScript · AWS'`,
      ),
    )?.text,
    'Senior Full-Stack PHP & Vue Developer | Laravel · TypeScript · AWS',
  );
});

test('proposalOf refuses a quote that is the current wording, not a new one', () => {
  // The only false positive the plain "longest span" rule produced on the corpus.
  assert.equal(
    proposalOf(
      action(
        `Replace 'Reduced the complexity of the system, cutting costs by hundreds of thousands of dollars annually' with a specific version: name the system and a concrete figure.`,
      ),
    ),
    null,
  );
});

test('proposalOf treats a short quoted run as a term mention', () => {
  assert.equal(proposalOf(action(`Delete the stray '|' character sitting on its own line.`)), null);
  assert.equal(proposalOf(action(`Spell it "Node.js" instead of "Node" and move it to the front.`)), null);
  assert.equal(proposalOf(action(`Add "RabbitMQ" and "nginx" beside Kafka if confirmed`)), null);
});

test('proposalOf does not read an apostrophe as a quote', () => {
  assert.equal(
    proposalOf(action(`Surface PostgreSQL and Google Cloud wording consistently with the posting's terms.`)),
    null,
  );
  assert.equal(
    proposalOf(action(`State plainly that you're applying for the Vue & PHP track, not Angular & PHP.`)),
    null,
  );
  // An apostrophe INSIDE the proposal must not close it early.
  assert.equal(
    proposalOf(action(`Reword: 'Owned the client's payment platform end to end, at 99.9% uptime.'`))?.text,
    "Owned the client's payment platform end to end, at 99.9% uptime.",
  );
});

test('proposalOf returns instructions without a wording as null', () => {
  for (const what of [
    'Cut to 4 bullets: keep architecture, payment platform, notification/TypeScript.',
    'Add a number: users covered, services integrated, or login failure reduction.',
    'Move the backend architecture bullet to first position',
  ]) {
    assert.equal(proposalOf(action(what)), null, what);
  }
});

test('proposalOf prefers the model’s own replacement field over parsing', () => {
  const withField = { ...action(`Reword: 'the parsed one, which is long enough'`), replacement: '  the field one  ' };
  assert.deepEqual(proposalOf(withField), { text: 'the field one', verb: 'Replace' });
  // An empty field falls back to the sentence rather than blanking the card.
  assert.equal(proposalOf({ ...withField, replacement: '   ' })?.text, 'the parsed one, which is long enough');
});

test('proposalOf folds curly quotes so a re-styled reply still parses', () => {
  assert.equal(
    proposalOf(action('Rewrite as: “Senior backend engineer building Node.js services.”'))?.text,
    'Senior backend engineer building Node.js services.',
  );
});

const removal = (over: Partial<MatchRemoval> = {}): MatchRemoval => ({
  section: 'experience',
  where: 'OGD, bullet 3',
  what: 'Drop the SEO bullet.',
  why: 'unrelated to the posting',
  quote: 'Improved SEO rankings for marketing pages.',
  ...over,
});

test('suggestionSheet is Markdown with Now, Proposed and why for every entry', () => {
  const sheet = suggestionSheet(
    { jobTitle: 'Back end Developer', companyName: 'Acme', resumeName: 'Nazar CV' },
    [
      action(`Change to "Back end Developer | Senior PHP Engineer".`, {
        section: 'title',
        where: 'Headline under name',
        quote: 'Senior Backend Software Engineer',
        why: 'Mirrors the posting title for ATS title match.',
      }),
    ],
    [removal()],
  );
  assert.match(sheet, /^# Resume changes — Back end Developer at Acme$/m);
  assert.match(sheet, /^Resume: Nazar CV$/m);
  assert.match(sheet, /^## What to change \(1\)$/m);
  assert.match(sheet, /^### 1\. Headline under name — title$/m);
  assert.match(sheet, /^\*\*Now:\*\*$/m);
  assert.match(sheet, /^> Senior Backend Software Engineer$/m);
  assert.match(sheet, /^\*\*Change:\*\*$/m);
  assert.match(sheet, /^> Back end Developer \| Senior PHP Engineer$/m);
  assert.match(sheet, /^_Why: Mirrors the posting title for ATS title match\._$/m);
  assert.match(sheet, /^## What to remove \(1\)$/m);
  assert.match(sheet, /^### 1\. OGD, bullet 3 — experience \(remove\)$/m);
  // A removal proposes nothing; only its quote is shown.
  assert.equal(sheet.includes('**Proposed:**'), false);
  assert.match(sheet, /^> Improved SEO rankings for marketing pages\.$/m);
  assert.equal(sheet.includes('\n\n\n'), false, 'no triple blank lines');
  assert.ok(sheet.endsWith('\n'));
});

test('suggestionSheet quotes every line of a multi-line removal', () => {
  const sheet = suggestionSheet(
    { jobTitle: 'X', companyName: 'Y', resumeName: 'Z' },
    [],
    [removal({ quote: 'First line of the block\nSecond line of the block' })],
  );
  assert.match(sheet, /^> First line of the block$/m);
  assert.match(sheet, /^> Second line of the block$/m);
});

test('suggestionSheet says so when there is nothing to carry out', () => {
  const sheet = suggestionSheet({ jobTitle: 'X', companyName: 'Y', resumeName: 'Z' }, [], []);
  assert.match(sheet, /No edits suggested\./);
  assert.equal(sheet.includes('## What to change'), false);
});
