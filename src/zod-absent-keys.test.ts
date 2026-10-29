import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import { ScreenReplySchema } from './screening/prompts';

/*
 * zod 4 refuses an object key that is absent when its schema is z.unknown()
 * or z.any() piped straight into a transform ("expected nonoptional, received
 * undefined"); zod 3 handed the transform undefined. An unticked checkbox is
 * absent from a form, so `mine: z.unknown().transform(…)` refused every Tailor
 * resume and Cover letter launch with the box unticked, from v2.63.13 (the
 * zod 4 move) to v2.63.20. `.optional()` before the transform reads it as zod
 * 3 did. The walk below keeps the shape out of src/.
 */

/* CommonJS output (no "type": "module" in package.json), so __dirname is the src root. */
const SRC = __dirname;
const BARE_TRANSFORM = /z\s*\.\s*(?:unknown|any)\(\)\s*\.\s*transform\(/g;

test('no z.unknown() or z.any() goes straight into a transform', () => {
  const found = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.includes('.test.'))
    .flatMap((e) => {
      const file = relative(SRC, join(e.parentPath, e.name)).split(sep).join('/');
      return [...readFileSync(join(e.parentPath, e.name), 'utf8').matchAll(BARE_TRANSFORM)].map(() => file);
    });
  assert.deepEqual(found, [], 'add .optional() before .transform(): an absent key is refused otherwise');
});

test('an absent key reaches a transform behind .optional()', () => {
  const form = z.object({ mine: z.unknown().optional().transform((v) => v === '1') });
  assert.deepEqual(form.parse({}), { mine: false });
  assert.equal(z.object({ mine: z.unknown().transform((v) => v === '1') }).safeParse({}).success, false, 'the shape the walk refuses');
});

test('a screening role with no company type keeps the reply', () => {
  const reply = ScreenReplySchema.safeParse({ roles: [{ position: 'QA Engineer', employer: 'Acme', start: '2020', end: '2024' }] });
  assert.ok(reply.success);
  assert.equal(reply.data.roles[0]?.companyType, null);
});
