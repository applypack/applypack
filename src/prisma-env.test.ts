import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRISMA_CLI_ENV } from './prisma-env';

// #524: no Prisma CLI command ApplyPack runs may call checkpoint.prisma.io.

const SRC = __dirname;

test('the Prisma CLI is told not to report home', () => {
  assert.equal(PRISMA_CLI_ENV.CHECKPOINT_DISABLE, '1');
});

test('every stage of the image sets it, so a build and a `docker compose exec app npx prisma …` stay quiet too', () => {
  const stages = readFileSync(join(SRC, '..', 'Dockerfile'), 'utf8').split(/^FROM /m).slice(1);
  assert.ok(stages.length > 0);
  for (const stage of stages) {
    for (const [key, value] of Object.entries(PRISMA_CLI_ENV)) {
      assert.match(stage, new RegExp(`^ENV ${key}=${value}$`, 'm'), `stage ${stage.split('\n')[0]} does not set ${key}`);
    }
  }
});

test('every file that runs the Prisma CLI gives it that environment', () => {
  const runners = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.includes('.test.'))
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => /\bnpx prisma\b|['"]prisma['"],\s*\[/.test(readFileSync(f, 'utf8').replace(/^\s*(?:\/\/|\*).*$/gm, '')));
  assert.ok(runners.length > 0, 'init.ts runs prisma migrate deploy');
  for (const f of runners) assert.match(readFileSync(f, 'utf8'), /PRISMA_CLI_ENV/, f);
});
