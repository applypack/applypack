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
} from './stage-config';

const W = (...keys: string[]) => keys.map((k) => ({ key: k, label: k.toUpperCase() }));

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

test('addStage never mints a reserved key', () => {
  const next = addStage([], 'Applied') as { key: string }[];
  assert.equal(next[0]!.key, 'applied-2');
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

test('default dots reproduce the pre-config board exactly', () => {
  const work = DEFAULT_WORK_STAGES;
  assert.equal(dotClassFor(work, 'applied'), 'bg-info');
  assert.equal(dotClassFor(work, 'screen'), 'bg-violet');
  assert.equal(dotClassFor(work, 'tech'), 'bg-warn');
  assert.equal(dotClassFor(work, 'onsite'), 'border-2 border-warn bg-transparent');
  assert.equal(dotClassFor(work, 'offer'), 'bg-ok');
  assert.equal(dotClassFor(work, 'rejected'), 'bg-line-strong');
  assert.equal(dotClassFor(work, 'unknown'), 'bg-info');
});
