import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateActions, gateRemovals, type GateSources } from './replacement-gate';
import { readKeywords, readRemovals, type MatchAction, type MatchKeyword, type MatchRemoval } from './prompts';

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

/** Through the schema, the way every removal reaches the gate in production. */
const removal = (over: Partial<MatchRemoval>): MatchRemoval =>
  readRemovals([{ section: 'skills', where: 'Skills line', what: 'Drop the noise.', why: 'reads cleaner', quote: null, ...over }])[0]!;

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

test('a removal quote covering a wanted keyword loses its quote, keeps its advice', async () => {
  // The live failure (match 13): the model advised dropping three of six
  // frameworks and quoted the whole line, React and Vue.js inside it.
  const src = await sources({
    resumeText: 'Skills: Symfony, React, Vue, Laravel, Lumen, Phalcon',
    keywords: [
      keyword({ term: 'React', requirement: 'must', primary: true }),
      keyword({ term: 'Vue.js', requirement: 'must', aliases: ['Vue'] }),
    ],
  });
  const out = gateRemovals([removal({ quote: 'Symfony, React, Vue, Laravel, Lumen, Phalcon' })], src);
  assert.equal(out.blocked, 1);
  assert.equal(out.removals[0]!.quote, null, 'nothing is struck through or deletable in one press');
  assert.match(out.removals[0]!.why, /not applied — .*"React"/);
  assert.match(out.removals[0]!.what, /Drop the noise/, 'the advice survives');
});

test('a removal quote covering a lighter wanted keyword warns but stays applicable', async () => {
  const src = await sources({
    resumeText: 'Skills: Symfony, Phalcon, Memcached',
    keywords: [keyword({ term: 'Memcached', requirement: 'nice' })],
  });
  const out = gateRemovals([removal({ quote: 'Symfony, Phalcon, Memcached' })], src);
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 1);
  assert.equal(out.removals[0]!.quote, 'Symfony, Phalcon, Memcached');
  assert.match(out.removals[0]!.why, /check: .*"Memcached"/);
});

test('a removal quote reaching the contact line is blocked whatever it aimed at', async () => {
  const src = await sources({ keywords: [] });
  const out = gateRemovals(
    [removal({ section: 'format', quote: 'Austin, TX 78701 · alex@example.com · +1 512 555 0134' })],
    src,
  );
  assert.equal(out.blocked, 1);
  assert.equal(out.removals[0]!.quote, null);
  assert.match(out.removals[0]!.why, /keep the email and phone/);
});

test('a removal of genuine noise passes untouched', async () => {
  const src = await sources({ keywords: [keyword({ term: 'React', requirement: 'must', primary: true })] });
  const clean = removal({ section: 'summary', quote: 'References available on request', what: 'Delete it.' });
  const out = gateRemovals([clean, removal({ quote: null })], src);
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 0);
  assert.deepEqual(out.removals, [clean, removal({ quote: null })]);
});

test('a keyword the resume still carries elsewhere is not lost, so the rewrite stands', async () => {
  // The live case: the bullet's only "SQL" was the phrase "SQL injection", and
  // the skills line carries SQL too — blocking the rewrite protected nothing.
  const src = await sources({
    resumeText: ['Skills: PHP, SQL, PGSQL', '- Combined Snyk with static analysis to prevent SQL injection.'].join('\n'),
    keywords: [keyword({ term: 'SQL', requirement: 'must', primary: true })],
  });
  const out = gateActions(
    [action({ quote: 'Combined Snyk with static analysis to prevent SQL injection.', replacement: 'Hardened the checkout flow against injection and input-handling flaws.' })],
    src,
  );
  assert.equal(out.blocked, 0);
  assert.equal(out.warned, 1);
  assert.match(out.actions[0]!.why, /the resume still has it elsewhere/);
  assert.equal(out.actions[0]!.replacement, 'Hardened the checkout flow against injection and input-handling flaws.');
});

test('the last occurrence of a must-have still blocks', async () => {
  const src = await sources({
    resumeText: '- Built Laravel payment workflows on MySQL.',
    keywords: [keyword({ term: 'MySQL', requirement: 'must', primary: true })],
  });
  const out = gateActions(
    [action({ quote: 'Built Laravel payment workflows on MySQL.', replacement: 'Built Laravel payment workflows.' })],
    src,
  );
  assert.equal(out.blocked, 1);
  assert.match(out.actions[0]!.why, /drops "MySQL", a must-have/);
});

test('the posted title may be written on the headline and in the summary, nowhere else', async () => {
  const src = await sources({
    resumeText: 'Alex Example — Senior Backend Engineer',
    // Priority 2 is the posted job title (RULE_KEYWORDS); it is a label, not a skill.
    keywords: [keyword({ term: 'Web Developer', priority: 2, requirement: 'context', status: 'cannot_claim' })],
  });
  const retitle = { quote: 'Senior Backend Engineer', replacement: 'Web Developer — Full-Stack (PHP, Laravel)' };
  assert.equal(gateActions([action({ section: 'title', ...retitle })], src).blocked, 0);
  assert.equal(gateActions([action({ section: 'summary', ...retitle })], src).blocked, 0);
  const inABullet = gateActions([action({ section: 'experience', ...retitle })], src);
  assert.equal(inABullet.blocked, 1, 'claiming the title inside a role is a different thing');
  assert.match(inABullet.actions[0]!.why, /claims "Web Developer"/);
});
