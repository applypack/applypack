import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALIAS_GROUPS, aliasesFor, withTableAliases } from './keyword-aliases';
import { loadKeywordMatcher } from './keyword-matcher';

test('alias table: lowercase trimmed spellings, unique across groups, two or more per group', () => {
  const seen = new Set<string>();
  for (const group of ALIAS_GROUPS) {
    assert.ok(group.length >= 2, `group too small: ${group.join(', ')}`);
    for (const s of group) {
      assert.equal(s, s.trim().toLowerCase(), `not canonical: "${s}"`);
      assert.ok(s.length > 0);
      assert.ok(!seen.has(s), `"${s}" appears in two groups`);
      seen.add(s);
    }
  }
  assert.ok(ALIAS_GROUPS.length >= 100);
});

test('aliasesFor: case-insensitive lookup, never the term itself, empty when unknown', () => {
  assert.deepEqual(aliasesFor('Node.js'), ['node', 'nodejs']);
  assert.deepEqual(aliasesFor('  GOLANG '), ['go']);
  assert.deepEqual(aliasesFor('K8s'), ['kubernetes']);
  assert.deepEqual(aliasesFor('Laravel'), []);
  assert.deepEqual(aliasesFor(''), []);
});

test('withTableAliases merges table spellings of the term and of its aliases, keeps the model ones', () => {
  const k = { term: 'PostgreSQL', aliases: ['postgres', 'pg'], status: 'present' };
  assert.deepEqual(withTableAliases(k), { ...k, aliases: ['postgres', 'pg', 'psql', 'pgsql'] });
  // Reached through a model alias: the term itself is unknown to the table.
  assert.deepEqual(withTableAliases({ term: 'ECMAScript 2020', aliases: ['javascript'] }).aliases, ['javascript', 'js', 'ecmascript']);
  // Nothing to add → the same object, so callers can tell.
  const untouched = { term: 'Laravel', aliases: [] };
  assert.equal(withTableAliases(untouched), untouched);
  const complete = { term: 'Go', aliases: ['golang'] };
  assert.equal(withTableAliases(complete), complete);
});

test('F6: the table connects both granularities through findTerm', async () => {
  const { findTerm } = await loadKeywordMatcher();
  const both: [term: string, text: string][] = [
    ['React', 'React.js'],
    ['React.js', 'React'],
    ['Node', 'Node.js'],
    ['Node.js', 'node'],
    ['PostgreSQL', 'PGSQL'],
    ['Kubernetes', 'K8s'],
    ['Golang', 'Go'],
    ['CI/CD', 'continuous integration'],
    ['Amazon Web Services', 'AWS'],
  ];
  for (const [term, text] of both) {
    assert.equal(findTerm(text, term, aliasesFor(term)).length, 1, `${term} in ${text}`);
  }
  // Related is not the same: no group crosses a sibling technology.
  assert.equal(findTerm('Vue', 'React', aliasesFor('React')).length, 0);
  assert.equal(findTerm('Laravel', 'Rails', aliasesFor('Rails')).length, 0);
});
