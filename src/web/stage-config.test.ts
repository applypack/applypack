import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addStage,
  allStages,
  boardStages,
  DEFAULT_WORK_STAGES,
  dotClassFor,
  labelFor,
  MAX_WORK_STAGES,
  moveStage,
  nextStageKey,
  parseStageConfig,
  removeStage,
  renameStage,
  slugifyLabel,
  strandedStages,
  TERMINAL_KEYS,
  UNFILED_STAGE,
} from './stage-config';
import { offeredLocales, withLocale } from '../i18n/locale';
import { t } from '../i18n/t';

const W = (...keys: string[]) => keys.map((k) => ({ key: k, label: k.toUpperCase() }));

test('the Board columns hint names the fixed columns as the board names them, in every language (#572)', () => {
  for (const locale of offeredLocales()) {
    withLocale(locale, () => {
      const hint = t('settings.appliedAndTheTwoClosed');
      for (const stage of allStages([]).filter((s) => s.key === 'applied' || TERMINAL_KEYS.includes(s.key))) {
        assert.ok(hint.includes(stage.label), `${locale}: "${hint}" names ${stage.label}`);
      }
    });
  }
});

test('parse falls back to defaults on null, garbage and empty lists', () => {
  assert.deepEqual(parseStageConfig(null), DEFAULT_WORK_STAGES);
  assert.deepEqual(parseStageConfig('nope'), DEFAULT_WORK_STAGES);
  assert.deepEqual(parseStageConfig([]), DEFAULT_WORK_STAGES);
  assert.deepEqual(parseStageConfig([{ key: 'BAD KEY', label: 'x' }]), DEFAULT_WORK_STAGES);
});

test('parse drops reserved and duplicate keys', () => {
  const stored = [
    { key: 'screen', label: 'Screen' },
    { key: 'applied', label: 'Smuggled' },
    { key: 'screen', label: 'Again' },
    { key: 'offer', label: 'Offer' },
  ];
  assert.deepEqual(parseStageConfig(stored), [
    { key: 'screen', label: 'Screen' },
    { key: 'offer', label: 'Offer' },
  ]);
});

test('parse keeps a valid custom list as-is', () => {
  const stored = [{ key: 'hr-call', label: 'HR Call' }];
  assert.deepEqual(parseStageConfig(stored), stored);
});

test('slugify strips to ascii kebab', () => {
  assert.equal(slugifyLabel('HR Call!'), 'hr-call');
  assert.equal(slugifyLabel('  Take-Home  '), 'take-home');
  assert.equal(slugifyLabel('Співбесіда'), '');
});

test('addStage appends with a unique slug key', () => {
  const next = addStage(W('screen'), 'HR Call');
  assert.deepEqual(next, [...W('screen'), { key: 'hr-call', label: 'HR Call' }]);
});

test('addStage suffixes a taken key and falls back for non-ascii labels', () => {
  const withScreen = addStage(W('screen'), 'Screen!!') as { key: string }[];
  assert.equal(withScreen[withScreen.length - 1]!.key, 'screen-2');
  const cyrillic = addStage([], 'Співбесіда') as { key: string; label: string }[];
  assert.deepEqual(cyrillic, [{ key: 'stage', label: 'Співбесіда' }]);
});

test('a work column never takes the name of a column the board has of its own (#646)', () => {
  for (const name of ['Applied', 'applied', 'Rejected', 'GHOSTED', 'Ghosted!', 'Unfiled']) {
    assert.equal(addStage(W('screen'), name), 'duplicate-label', name);
    assert.equal(renameStage(W('screen'), 'screen', name), 'duplicate-label', name);
  }
  // In the reader's language too: the board shows the fixed columns in it.
  withLocale('uk', () => assert.equal(addStage(W('screen'), t('stages.rejected')), 'duplicate-label'));
  assert.ok(Array.isArray(addStage(W('screen'), 'Rejected by HR')), 'a name that only starts like one is its own');
});

test('a column name past the limit is refused, not cut to it (#646)', () => {
  assert.equal(addStage(W('screen'), 'x'.repeat(41)), 'too-long');
  assert.equal(renameStage(W('screen'), 'screen', 'x'.repeat(300)), 'too-long');
  assert.deepEqual(addStage([], `  ${'x'.repeat(40)}  `), [{ key: 'x'.repeat(36), label: 'x'.repeat(40) }]);
});

test('addStage guards empty, duplicate and the cap', () => {
  assert.equal(addStage([], '   '), 'empty-label');
  assert.equal(addStage(W('screen'), 'SCREEN'), 'duplicate-label');
  const full = Array.from({ length: MAX_WORK_STAGES }, (_, i) => ({
    key: `s${i}`,
    label: `S${i}`,
  }));
  assert.equal(addStage(full, 'One more'), 'limit');
});

test('removeStage drops the key or reports it unknown', () => {
  assert.deepEqual(removeStage(W('a', 'b'), 'a'), W('b'));
  assert.equal(removeStage(W('a'), 'zzz'), 'unknown-key');
});

test('the last work column cannot be removed', () => {
  assert.equal(removeStage(W('a'), 'a'), 'last-column');
});

test('a 40-char label still mints a schema-legal key on collision', () => {
  const label = 'x'.repeat(40);
  const first = addStage([], label) as { key: string }[];
  const second = addStage(
    [{ key: first[0]!.key, label: 'other name' }],
    label,
  ) as { key: string }[];
  assert.equal(first[0]!.key.length <= 40, true);
  assert.equal(second[1]!.key, `${'x'.repeat(36)}-2`);
  assert.equal(second[1]!.key.length <= 40, true);
});

test('moveStage swaps neighbours and no-ops at the edges', () => {
  assert.deepEqual(moveStage(W('a', 'b', 'c'), 'c', 'up'), W('a', 'c', 'b'));
  assert.deepEqual(moveStage(W('a', 'b'), 'a', 'up'), W('a', 'b'));
  assert.deepEqual(moveStage(W('a', 'b'), 'b', 'down'), W('a', 'b'));
  assert.deepEqual(moveStage(W('a', 'b'), 'zzz', 'down'), W('a', 'b'));
});

test('renameStage changes the label and never the key', () => {
  const next = renameStage(W('screen'), 'screen', 'First chat');
  assert.deepEqual(next, [{ key: 'screen', label: 'First chat' }]);
  assert.equal(renameStage(W('screen'), 'zzz', 'x'), 'unknown-key');
  assert.equal(renameStage(W('a', 'b'), 'a', 'B'), 'duplicate-label');
  assert.equal(renameStage(W('a'), 'a', '  '), 'empty-label');
  // #683: a fixed column is not gone, it is fixed.
  for (const fixed of ['applied', 'rejected', 'ghosted']) assert.equal(renameStage(W('screen'), fixed, 'x'), 'fixed-column');
});

test('board and full orders wrap the work list with the fixed stages', () => {
  const work = W('screen');
  assert.deepEqual(
    boardStages(work).map((s) => s.key),
    ['applied', 'screen'],
  );
  assert.deepEqual(
    allStages(work).map((s) => s.key),
    ['applied', 'screen', 'rejected', 'ghosted'],
  );
});

test('labelFor resolves fixed, work and unknown keys', () => {
  assert.equal(labelFor(W('screen'), 'applied'), 'Applied');
  assert.equal(labelFor(W('screen'), 'screen'), 'SCREEN');
  assert.equal(labelFor(W('screen'), 'long-gone'), 'long-gone');
});

test('nextStageKey walks the funnel forward and revives terminals', () => {
  const work = DEFAULT_WORK_STAGES;
  assert.equal(nextStageKey(work, 'applied'), 'screen');
  assert.equal(nextStageKey(work, 'screen'), 'tech');
  assert.equal(nextStageKey(work, 'offer'), 'rejected');
  assert.equal(nextStageKey(work, 'rejected'), 'screen');
  assert.equal(nextStageKey(work, 'ghosted'), 'screen');
  assert.equal(nextStageKey([], 'applied'), 'rejected');
});

test('default dots: Applied, the four work columns in cycle order, the exits', () => {
  const work = DEFAULT_WORK_STAGES;
  assert.equal(dotClassFor(work, 'applied'), 'bg-info');
  // Not violet: that is AI spend and the Saved status only (DESIGN.md).
  assert.equal(dotClassFor(work, 'screen'), 'border-2 border-info bg-transparent');
  assert.equal(dotClassFor(work, 'tech'), 'bg-warn');
  assert.equal(dotClassFor(work, 'onsite'), 'border-2 border-warn bg-transparent');
  assert.equal(dotClassFor(work, 'offer'), 'bg-ok');
  assert.equal(dotClassFor(work, 'rejected'), 'bg-line-strong');
  assert.equal(dotClassFor(work, 'unknown'), 'bg-info');
});

test('a stage no column covers is stranded, and Unfiled is where it shows', () => {
  const work = [
    { key: 'screen', label: 'Screen' },
    { key: 'tech', label: 'Tech' },
  ];
  // Everything a live board holds is covered; the normal case is empty.
  assert.deepEqual(strandedStages(work, ['applied', 'screen', 'rejected', null]), []);
  // "onsite" was a column until someone removed it.
  assert.deepEqual(strandedStages(work, ['screen', 'onsite', 'onsite', 'offer']), ['onsite', 'offer']);
  // A card in Unfiled moves on into the first real column.
  assert.equal(nextStageKey(work, UNFILED_STAGE.key), 'screen');
  assert.equal(dotClassFor(work, UNFILED_STAGE.key), 'bg-info');
});

test('nobody can create a second Unfiled column', () => {
  const stored = [
    { key: 'unfiled', label: 'Mine' },
    { key: 'screen', label: 'Screen' },
  ];
  assert.deepEqual(parseStageConfig(stored), [{ key: 'screen', label: 'Screen' }]);
});
