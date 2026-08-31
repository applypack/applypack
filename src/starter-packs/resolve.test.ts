import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAtsToken } from '../text-utils';
import {
  RESOLVE_ORDER,
  boardUrl,
  buildPreview,
  buildResolvePlan,
  deriveSlug,
  isAllowedAttempt,
  keyOf,
  type ResolvedEntry,
} from './resolve';

const target = {
  name: 'Rocket.Chat',
  segment: 'php-laravel',
  atsType: 'GREENHOUSE' as const,
  atsToken: 'rocketchat',
};

test('the resolve chain covers all ten per-company vendors, in order', () => {
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

test('isAllowedAttempt accepts planned pairs and rejects invented ones', () => {
  assert.ok(isAllowedAttempt(target, 'GREENHOUSE', 'rocketchat'));
  assert.ok(isAllowedAttempt(target, 'LEVER', 'rocketchat'));
  assert.equal(isAllowedAttempt(target, 'GREENHOUSE', 'someone-else'), false);
  assert.equal(isAllowedAttempt(target, 'MANUAL', 'rocketchat'), false);
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
    [resolved('Vercel', 'GREENHOUSE', 'vercel'), resolved('Linear', 'ASHBY', 'linear')],
    [{ name: 'Grammarly', segment: 'seg', reason: 'no public board' }],
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
  const first = buildPreview(entries, [], new Set());
  const afterImport = new Set(
    first.toAdd.map((e) => keyOf(e.atsType, e.atsToken)),
  );

  const second = buildPreview(entries, [], afterImport);
  assert.equal(second.toAdd.length, 0);
  assert.equal(second.alreadyAdded.length, 2);
});

test('buildPreview collapses two names that resolve to the same board', () => {
  const preview = buildPreview(
    [resolved('Kit', 'ASHBY', 'kit'), resolved('ConvertKit', 'ASHBY', 'kit')],
    [],
    new Set(),
  );
  assert.equal(preview.toAdd.length, 1);
  assert.equal(preview.alreadyAdded.length, 1);
});

test('buildPreview never drops an unresolved name', () => {
  const unresolved = [
    { name: 'Grammarly', segment: 'seg', reason: 'no public board' },
    { name: 'Retool', segment: 'seg', reason: 'HTTP 404' },
  ];
  const preview = buildPreview([], unresolved, new Set());
  assert.deepEqual(preview.unresolved, unresolved);
});
