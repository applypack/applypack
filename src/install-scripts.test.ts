import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * npm 11 lists every dependency whose install scripts `allowScripts` in
 * package.json does not name, and a later npm will not run them (#526). The
 * built-in database and the Prisma client come from such scripts, so an
 * unreviewed one would break `npm install && npm start`: a dependency update
 * that brings a new one fails here until it is approved or denied.
 */

const ROOT = join(__dirname, '..');
const read = <T>(file: string): T => JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as T;
const { allowScripts = {} } = read<{ allowScripts?: Record<string, boolean> }>('package.json');
const lock = read<{ packages: Record<string, { hasInstallScript?: boolean }> }>('package-lock.json');

const withScripts = Object.entries(lock.packages)
  .filter(([path, p]) => path !== '' && p.hasInstallScript)
  .map(([path]) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length));

test('every dependency with install scripts is reviewed', () => {
  assert.ok(withScripts.length > 0);
  for (const name of withScripts) assert.ok(name in allowScripts, `${name} has install scripts and no allowScripts entry`);
});

test('the scripts npm start depends on are allowed', () => {
  for (const name of ['prisma', '@prisma/client', '@prisma/engines']) assert.equal(allowScripts[name], true, name);
  const postgres = withScripts.filter((n) => n.startsWith('@embedded-postgres/'));
  assert.ok(postgres.length > 0);
  for (const name of postgres) assert.equal(allowScripts[name], true, name);
});

test('the list names no package the lockfile no longer has', () => {
  for (const name of Object.keys(allowScripts)) assert.ok(withScripts.includes(name), `${name} is not installed with scripts any more`);
});
