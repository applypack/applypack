import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Prisma applies migrations in the order of their directory names. Two that
 * share a timestamp are ordered by what follows it — by an accident of
 * spelling, not by anyone's choice (#372). Two branches cut on the same day
 * collide easily, and CI's `migrate diff` does not see it: the schema at the
 * end is the same either way. This fails the second one when it is rebased.
 *
 * A migration that every install has applied cannot be renamed — its name is
 * the key in `_prisma_migrations` — so the pair that already collides stays,
 * named here.
 */
const SHARED_BEFORE_THIS_RULE: Record<string, string[]> = {
  '20261005000000': ['app_settings_locale', 'application_pack'],
};

const MIGRATION = /^(\d{14})_([a-z0-9_]+)$/;

function migrations(): { stamp: string; name: string }[] {
  return readdirSync(join(__dirname, '..', 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const parts = MIGRATION.exec(entry.name);
      assert.ok(parts, `${entry.name}: a migration is named <14 digits>_<lower_snake_case>`);
      return { stamp: parts[1]!, name: parts[2]! };
    });
}

/** The names under each timestamp that more than one migration carries. */
function shared(list: { stamp: string; name: string }[]): Record<string, string[]> {
  const byStamp = new Map<string, string[]>();
  for (const m of list) byStamp.set(m.stamp, [...(byStamp.get(m.stamp) ?? []), m.name]);
  return Object.fromEntries([...byStamp].filter(([, names]) => names.length > 1).map(([stamp, names]) => [stamp, names.sort()]));
}

test('every migration has a timestamp of its own', () => {
  const list = migrations();
  assert.ok(list.length > 0, 'prisma/migrations holds the migrations');
  // Exactly the known pair: a new collision fails here, and so does a list that names one that is gone.
  assert.deepEqual(shared(list), SHARED_BEFORE_THIS_RULE);
});

test('a second migration on a taken timestamp is found', () => {
  const list = [
    { stamp: '20270101000000', name: 'add_a' },
    { stamp: '20270101000000', name: 'add_b' },
    { stamp: '20270102000000', name: 'add_c' },
  ];
  assert.deepEqual(shared(list), { '20270101000000': ['add_a', 'add_b'] });
});
