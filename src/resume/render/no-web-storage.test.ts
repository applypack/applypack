import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// #610: a process that loads the clean .docx renderer outside the launcher —
// a once-script, Docker's `node dist/...` — says nothing about Web Storage.
// Web Storage is switched on where this Node has the flag (Node 25 on has it
// on anyway), so the test bites on every Node CI runs.

test('loading docx leaves no localStorage behind and prints no warning', () => {
  const on = process.allowedNodeEnvironmentFlags.has('--experimental-webstorage') ? ['--experimental-webstorage'] : [];
  const load = `require(${JSON.stringify(join(__dirname, 'clean-docx.ts'))}); process.stdout.write(String('localStorage' in globalThis));`;
  const run = spawnSync(process.execPath, [...on, '--import', 'tsx', '-e', load], { cwd: join(__dirname, '..', '..', '..'), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'false');
  assert.doesNotMatch(run.stderr, /localStorage/);
});
