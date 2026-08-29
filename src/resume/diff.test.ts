import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffMatches } from './diff';
import type { MatchKeyword } from './prompts';
import { scoreMatch } from './score';

const kw = (term: string, status: MatchKeyword['status']): MatchKeyword => ({
  term,
  priority: 1,
  requirement: 'must',
  primary: false,
  status,
  aliases: [],
  where: null,
  note: null,
  elsewhere: null,
});

test('gained and lost track present transitions for terms both versions know', () => {
  const prev = { keywords: [kw('Node.js', 'add'), kw('Docker', 'present'), kw('AWS', 'cannot_claim')], breakdown: null };
  const next = {
    keywords: [kw('node.js', 'present'), kw('Docker', 'add'), kw('Kafka', 'present')],
    breakdown: null,
  };
  const d = diffMatches(prev, next);
  assert.deepEqual(d.gained, ['node.js']); // case-insensitive term matching
  assert.deepEqual(d.lost, ['Docker']);
  assert.equal(d.components, null); // Kafka is new — never counted as "gained"
});

test('component deltas come from the two breakdowns', () => {
  const align = { title: 'strong', summary: 'strong', recent_role: 'strong' } as const;
  // prev: primary missing (flag restating it is free) + one real flag → penalty 10.
  const prev = { keywords: [kw('Node.js', 'add')], breakdown: scoreMatch([{ status: 'add', requirement: 'must', primary: true }], align, 2) };
  const next = { keywords: [kw('Node.js', 'present')], breakdown: scoreMatch([{ status: 'present', requirement: 'must', primary: true }], align, 0) };
  const d = diffMatches(prev, next);
  assert.ok(d.components);
  assert.equal(prev.breakdown.penalty, 10);
  assert.equal(d.components.keywordPts, 30);
  assert.equal(d.components.penalty, -10);
  assert.equal(d.components.capBefore, 30);
  assert.equal(d.components.capAfter, null);
  assert.equal(d.components.score, next.breakdown.score - prev.breakdown.score);
});
