import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateActions, type GateSources } from './replacement-gate';
import { readKeywords, type MatchAction, type MatchKeyword } from './prompts';

const RESUME = [
  'Alex Example — Senior Backend Engineer',
  'Skills: PHP 8, Laravel, Docker, MySQL',
  '- Designed Laravel payment workflows processing $4M/month, cutting failed checkouts 18%.',
  '- Led migration of the monolith to services; release time fell from 2 weeks to 2 days.',
].join('\n');

const POSTING = 'Senior Backend Engineer (B2B SaaS)\nNode.js and TypeScript services for a fintech platform, East Coast hours.';

/** Through the schema, the way every keyword reaches the gate in production. */
const keyword = (over: Partial<MatchKeyword> & { term: string }): MatchKeyword =>
  readKeywords([{ priority: 1, requirement: 'must', primary: false, status: 'present', aliases: [], ...over }])[0]!;

const action = (over: Partial<MatchAction>): MatchAction => ({
  section: 'experience',
  where: 'first bullet',
  what: 'Reword it.',
  why: 'serves the posting',
  priority: 'high',
  quote: null,
  replacement: null,
  insert_after: null,
  ...over,
});

async function sources(over: Partial<GateSources> = {}): Promise<GateSources> {
  // The real browser matcher, loaded the way keyword-matcher.ts loads it.
  // @ts-expect-error — plain JS with no declaration file.
  const matcher = (await import('../web/public/target.mjs')) as GateSources['matcher'];
  return { resumeText: RESUME, posting: POSTING, facts: [], keywords: [], matcher, ...over };
}

test('an invented figure blocks; a figure the resume carries passes', async () => {
  const src = await sources();
  const invented = action({ quote: 'Led migration of the monolith to services', replacement: 'Led migration of the monolith to services, cutting infrastructure cost 40%.' });
  const real = action({ quote: 'Designed Laravel payment workflows', replacement: 'Owned Laravel payment workflows processing $4M/month.' });
  const out = gateActions([invented, real], src);
  assert.equal(out.blocked, 1);
  assert.equal(out.actions[0]!.replacement, null, 'the blocked wording is gone');
  assert.match(out.actions[0]!.why, /not applied — .*40%/);
  assert.equal(out.actions[1]!.replacement, 'Owned Laravel payment workflows processing $4M/month.');
  assert.equal(out.actions[1]!.why, 'serves the posting', 'a clean pass leaves why alone');
});

test('the posting is a source: its vocabulary is not an invented employer', async () => {
  const src = await sources();
  const out = gateActions(
    [action({ quote: 'Senior Backend Engineer', replacement: 'Senior Backend Engineer for B2B SaaS, available for East Coast hours' })],
    src,
  );
  assert.equal(out.blocked, 0, out.actions[0]!.why);
});

test('a replacement may not introduce a keyword the resume has no evidence for', async () => {
  const src = await sources({
    keywords: [keyword({ term: 'Node.js', status: 'cannot_claim', primary: true })],
  });
  const out = gateActions(
    [action({ quote: 'Led migration of the monolith to services', replacement: 'Led migration of the monolith to Node.js services.' })],
    src,
  );
  assert.equal(out.blocked, 1);
  assert.match(out.actions[0]!.why, /claims "Node\.js"/);
});

test('an unconfirmed keyword warns rather than blocks — the confirm flow comes first', async () => {
  const src = await sources({ keywords: [keyword({ term: 'Kubernetes', status: 'ask_user', requirement: 'preferred' })] });
  const out = gateActions(
    [action({ quote: 'Led migration of the monolith to services', replacement: 'Led migration of the monolith to services on Kubernetes.' })],
    src,
  );
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 1);
  assert.match(out.actions[0]!.why, /check: says "Kubernetes"/);
  assert.equal(out.actions[0]!.replacement, 'Led migration of the monolith to services on Kubernetes.');
});

test('KEEP WANTED KEYWORDS: losing a must-have blocks, losing a nice-to-have warns', async () => {
  const src = await sources({
    keywords: [
      keyword({ term: 'Docker', requirement: 'must' }),
      keyword({ term: 'MySQL', requirement: 'nice', priority: 3 }),
    ],
  });
  const out = gateActions(
    [
      action({ quote: 'Skills: PHP 8, Laravel, Docker, MySQL', replacement: 'Skills: PHP 8, Laravel, MySQL' }),
      action({ quote: 'Skills: PHP 8, Laravel, Docker, MySQL', replacement: 'Skills: PHP 8, Laravel, Docker' }),
    ],
    src,
  );
  assert.equal(out.blocked, 1);
  assert.equal(out.warned, 1);
  assert.equal(out.actions[0]!.replacement, null);
  assert.match(out.actions[0]!.why, /drops "Docker", a must-have/);
  assert.equal(out.actions[1]!.replacement, 'Skills: PHP 8, Laravel, Docker');
  assert.match(out.actions[1]!.why, /check: drops "MySQL"/);
});

test('a pre-ADR-0012 keyword with no level reads as preferred, so losing it warns', async () => {
  // The schema defaults a missing level to "preferred" whatever the priority;
  // the gate never sees an undefined level, and a lost preferred term is a note.
  const src = await sources({ keywords: [keyword({ term: 'Docker', requirement: undefined, priority: 1 })] });
  const out = gateActions([action({ quote: 'Skills: PHP 8, Laravel, Docker, MySQL', replacement: 'Skills: PHP 8, Laravel, MySQL' })], src);
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 1);
});

test('an addition replaces nothing, so it cannot lose a keyword', async () => {
  const src = await sources({ keywords: [keyword({ term: 'Docker', requirement: 'must' })] });
  const out = gateActions(
    [action({ quote: null, insert_after: 'Skills: PHP 8, Laravel, Docker, MySQL', replacement: 'Ran the Laravel services in Docker on MySQL.' })],
    src,
  );
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 0);
});

test('actions without a replacement pass through untouched, and the wording is plain-punctuated', async () => {
  const src = await sources();
  const bare = action({ what: 'Cut to four bullets.' });
  const curly = action({ quote: 'Senior Backend Engineer', replacement: 'Senior Backend Engineer — “payments”' });
  const out = gateActions([bare, curly], src);
  assert.deepEqual(out.actions[0], bare);
  assert.equal(out.actions[1]!.replacement, 'Senior Backend Engineer - "payments"');
});
