import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAtsToken } from '../text-utils';
import {
  RESOLVE_ORDER,
  boardUrl,
  buildPreview,
  buildResolvePlan,
  allowedAttempt,
  deriveSlug,
  failureReason,
  keyOf,
  resolveEntry,
  type ProbeAnswer,
  type ResolveAttempt,
  type ResolvedEntry,
} from './resolve';

const target = {
  name: 'Rocket.Chat',
  segment: 'php-laravel',
  atsType: 'GREENHOUSE' as const,
  atsToken: 'rocketchat',
};

test('the resolve chain covers all twelve per-company vendors, in order', () => {
  assert.deepEqual(RESOLVE_ORDER, [
    'GREENHOUSE',
    'ASHBY',
    'LEVER',
    'WORKABLE',
    'SMARTRECRUITERS',
    'RECRUITEE',
    'BREEZY',
    'BAMBOOHR',
    'PINPOINT',
    'RIPPLING',
      'PERSONIO',
      'TEAMTAILOR',
  ]);
});

test('deriveSlug lowercases and drops punctuation', () => {
  assert.equal(deriveSlug('Rocket.Chat'), 'rocketchat');
  assert.equal(deriveSlug('Cockroach Labs'), 'cockroachlabs');
  assert.equal(deriveSlug('Lemon.io'), 'lemonio');
  assert.equal(deriveSlug('Fly.io'), 'flyio');
  assert.equal(deriveSlug('N26'), 'n26');
});

test('buildResolvePlan tries the pinned board first, then every vendor', () => {
  const plan = buildResolvePlan(target);

  assert.deepEqual(plan[0], {
    atsType: 'GREENHOUSE',
    atsToken: 'rocketchat',
    pinned: true,
  });
  assert.ok(plan.every((a, i) => i === 0 || !a.pinned));
  assert.deepEqual(
    plan.slice(1).map((a) => a.atsType),
    RESOLVE_ORDER.filter((v) => v !== 'GREENHOUSE'),
  );
});

test('buildResolvePlan never probes the same pair twice', () => {
  // The pinned token equals the derived slug, so GREENHOUSE must not repeat.
  const keys = buildResolvePlan(target).map((a) => keyOf(a.atsType, a.atsToken));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, RESOLVE_ORDER.length);
});

test('buildResolvePlan keeps a pinned token that differs from the derived slug', () => {
  const plan = buildResolvePlan({
    name: 'Lightspeed',
    segment: 'php-laravel',
    atsType: 'ASHBY',
    atsToken: 'lightspeedhq',
  });
  assert.deepEqual(plan[0], {
    atsType: 'ASHBY',
    atsToken: 'lightspeedhq',
    pinned: true,
  });
  // Every vendor still gets a shot at the derived slug, Ashby included.
  assert.equal(plan.length, RESOLVE_ORDER.length + 1);
  assert.ok(
    plan.some((a) => a.atsType === 'ASHBY' && a.atsToken === 'lightspeed'),
  );
});

test('buildResolvePlan skips the fallback when a name has no usable slug', () => {
  const plan = buildResolvePlan({
    name: '!!',
    segment: 'x',
    atsType: 'LEVER',
    atsToken: 'kinsta',
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0]?.pinned, true);
});

test('allowedAttempt returns planned pairs and rejects invented ones', () => {
  assert.deepEqual(allowedAttempt(target, 'GREENHOUSE', 'rocketchat'), {
    atsType: 'GREENHOUSE',
    atsToken: 'rocketchat',
    pinned: true,
  });
  assert.equal(allowedAttempt(target, 'LEVER', 'rocketchat')?.pinned, false);
  assert.equal(allowedAttempt(target, 'GREENHOUSE', 'someone-else'), null);
  assert.equal(allowedAttempt(target, 'MANUAL', 'rocketchat'), null);
});

test('boardUrl round-trips through extractAtsToken for every vendor', () => {
  for (const atsType of RESOLVE_ORDER) {
    const parsed = extractAtsToken(boardUrl(atsType, 'acme'));
    assert.deepEqual(
      parsed,
      { atsType, atsToken: 'acme' },
      `${atsType} board URL did not round-trip`,
    );
  }
});

const resolved = (
  name: string,
  atsType: ResolvedEntry['atsType'],
  atsToken: string,
): ResolvedEntry => ({
  name,
  segment: 'seg',
  atsType,
  atsToken,
  jobsCount: 3,
  pinned: true,
  boardUrl: boardUrl(atsType, atsToken),
});

test('buildPreview separates new boards from ones already tracked', () => {
  const preview = buildPreview(
    {
      resolved: [resolved('Vercel', 'GREENHOUSE', 'vercel'), resolved('Linear', 'ASHBY', 'linear')],
      quiet: [],
      unresolved: [{ name: 'Grammarly', segment: 'seg', reason: 'gone' }],
    },
    new Set(['ASHBY:linear']),
  );

  assert.deepEqual(preview.toAdd.map((e) => e.name), ['Vercel']);
  assert.deepEqual(preview.alreadyAdded.map((e) => e.name), ['Linear']);
  assert.deepEqual(preview.unresolved.map((e) => e.name), ['Grammarly']);
});

test('buildPreview is idempotent — a re-import adds nothing', () => {
  const entries = [
    resolved('Vercel', 'GREENHOUSE', 'vercel'),
    resolved('Linear', 'ASHBY', 'linear'),
  ];
  const first = buildPreview({ resolved: entries, quiet: [], unresolved: [] }, new Set());
  const afterImport = new Set(
    first.toAdd.map((e) => keyOf(e.atsType, e.atsToken)),
  );

  const second = buildPreview({ resolved: entries, quiet: [], unresolved: [] }, afterImport);
  assert.equal(second.toAdd.length, 0);
  assert.equal(second.alreadyAdded.length, 2);
});

test('buildPreview collapses two names that resolve to the same board', () => {
  const preview = buildPreview(
    { resolved: [resolved('Kit', 'ASHBY', 'kit'), resolved('ConvertKit', 'ASHBY', 'kit')], quiet: [], unresolved: [] },
    new Set(),
  );
  assert.equal(preview.toAdd.length, 1);
  assert.equal(preview.alreadyAdded.length, 1);
});

test('buildPreview never drops an unresolved name', () => {
  const unresolved = [
    { name: 'Grammarly', segment: 'seg', reason: 'gone' as const },
    { name: 'Retool', segment: 'seg', reason: 'unavailable' as const, detail: 'fetch failed' },
  ];
  const preview = buildPreview({ resolved: [], quiet: [], unresolved }, new Set());
  assert.deepEqual(preview.unresolved, unresolved);
});

test('buildPreview lists a quiet board apart, or as tracked with its zero (#638)', () => {
  const buffer = { name: 'Buffer', segment: 'seg', atsType: 'ASHBY' as const, atsToken: 'buffer', boardUrl: boardUrl('ASHBY', 'buffer') };
  const spryker = { name: 'Spryker', segment: 'seg', atsType: 'GREENHOUSE' as const, atsToken: 'spryker', boardUrl: boardUrl('GREENHOUSE', 'spryker') };
  const preview = buildPreview({ resolved: [], quiet: [buffer, spryker], unresolved: [] }, new Set(['GREENHOUSE:spryker']));
  assert.deepEqual(preview.quiet, [buffer]);
  assert.deepEqual(preview.unresolved, [], 'a board that answered is not "could not resolve"');
  assert.deepEqual(preview.alreadyAdded, [{ ...spryker, jobsCount: 0, pinned: true }]);
  assert.deepEqual(preview.toAdd, []);
});

/*
 * resolveEntry walks a plan on recorded answers: the ten catalog boards of
 * #638 as the vendors answered them on 2026-10-29.
 */
type Answers = Record<string, ProbeAnswer>;
const NOT_FOUND: ProbeAnswer = { ok: false, status: 404, error: 'HTTP 404' };

function recorded(answers: Answers) {
  const asked: string[] = [];
  const probe = async (a: ResolveAttempt): Promise<ProbeAnswer> => {
    asked.push(keyOf(a.atsType, a.atsToken));
    return answers[keyOf(a.atsType, a.atsToken)] ?? NOT_FOUND;
  };
  return { probe, asked };
}

const FAR = Number.MAX_SAFE_INTEGER;

test('resolveEntry takes the pinned board when it holds a job, asking nothing else', async () => {
  const { probe, asked } = recorded({ 'ASHBY:amplitude': { ok: true, jobsCount: 44 } });
  const outcome = await resolveEntry({ name: 'Amplitude', segment: 'js-product', atsType: 'ASHBY', atsToken: 'amplitude' }, probe, FAR);
  assert.equal(outcome.kind, 'resolved');
  assert.deepEqual(outcome.entry, {
    name: 'Amplitude',
    segment: 'js-product',
    atsType: 'ASHBY',
    atsToken: 'amplitude',
    pinned: true,
    jobsCount: 44,
    boardUrl: 'https://jobs.ashbyhq.com/amplitude',
  });
  assert.deepEqual(asked, ['ASHBY:amplitude']);
});

test('resolveEntry falls through an empty pinned board to a guess that holds jobs', async () => {
  // Webflow's Greenhouse board answered 0 while its Ashby board listed 19.
  const { probe } = recorded({
    'GREENHOUSE:webflow': { ok: true, jobsCount: 0 },
    'ASHBY:webflow': { ok: true, jobsCount: 19 },
  });
  const outcome = await resolveEntry({ name: 'Webflow', segment: 'js-product', atsType: 'GREENHOUSE', atsToken: 'webflow' }, probe, FAR);
  assert.equal(outcome.kind, 'resolved');
  assert.equal(outcome.kind === 'resolved' && outcome.entry.pinned, false);
  assert.equal(outcome.kind === 'resolved' && outcome.entry.atsType, 'ASHBY');
});

test('resolveEntry calls a pinned board with no openings quiet, not unresolved (#638)', async () => {
  const { probe } = recorded({
    'ASHBY:buffer': { ok: true, jobsCount: 0 },
    // SmartRecruiters answers 200 and nothing for any name: still no board.
    'SMARTRECRUITERS:buffer': { ok: true, jobsCount: 0 },
  });
  const outcome = await resolveEntry({ name: 'Buffer', segment: 'remote-first', atsType: 'ASHBY', atsToken: 'buffer' }, probe, FAR);
  assert.deepEqual(outcome, {
    kind: 'quiet',
    entry: { name: 'Buffer', segment: 'remote-first', atsType: 'ASHBY', atsToken: 'buffer', boardUrl: 'https://jobs.ashbyhq.com/buffer' },
  });
});

test('resolveEntry says why a pinned board failed, by its status (#638)', async () => {
  const cases: Array<[string, ProbeAnswer, string]> = [
    ['Postman', NOT_FOUND, 'gone'],
    ['MacPaw', { ok: false, status: 403, error: 'HTTP 403 from RECRUITEE' }, 'refused'],
    ['Skylum', { ok: false, error: 'fetch failed' }, 'unavailable'],
  ];
  for (const [name, pinned, reason] of cases) {
    const { probe } = recorded({ 'GREENHOUSE:pinned': pinned });
    const outcome = await resolveEntry({ name, segment: 'seg', atsType: 'GREENHOUSE', atsToken: 'pinned' }, probe, FAR);
    assert.equal(outcome.kind, 'unresolved', name);
    assert.equal(outcome.kind === 'unresolved' && outcome.entry.reason, reason, name);
    assert.equal(outcome.kind === 'unresolved' && outcome.entry.detail, pinned.error, `${name} keeps the probe's words for the log`);
  }
});

test('failureReason reads the status, and only a looked-up token is gone', () => {
  assert.equal(failureReason({ ok: false, status: 404 }), 'gone');
  assert.equal(failureReason({ ok: false, status: 410 }), 'gone');
  assert.equal(failureReason({ ok: false, status: 302 }), 'gone', 'a redirect away from the API, as BambooHR sends a dead slug home');
  assert.equal(failureReason({ ok: false, status: 403 }), 'refused');
  assert.equal(failureReason({ ok: false, status: 401 }), 'refused');
  assert.equal(failureReason({ ok: false, status: 429 }), 'unavailable');
  assert.equal(failureReason({ ok: false, status: 503 }), 'unavailable');
  assert.equal(failureReason({ ok: false, error: 'fetch failed' }), 'unavailable');
});

test('resolveEntry past its deadline: timed out before the pinned board, else the pinned answer speaks', async () => {
  const target = { name: 'Buffer', segment: 'seg', atsType: 'ASHBY' as const, atsToken: 'buffer' };
  const early = await resolveEntry(target, recorded({}).probe, 0, () => 1);
  assert.deepEqual(early, { kind: 'unresolved', entry: { name: 'Buffer', segment: 'seg', reason: 'timedOut' } });

  // The clock runs out after the first answer: the guesses are never asked.
  let clock = 0;
  const { probe, asked } = recorded({ 'ASHBY:buffer': { ok: true, jobsCount: 0 } });
  const late = await resolveEntry(target, async (a) => { clock = 10; return probe(a); }, 5, () => clock);
  assert.equal(late.kind, 'quiet');
  assert.deepEqual(asked, ['ASHBY:buffer']);
});
