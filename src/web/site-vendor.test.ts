import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The landing demo (site/public/demo/) ships byte copies of the pure scoring
// modules so applypack.dev cannot drift from what the dashboard actually runs.
// If this fails, re-copy: cp src/web/public/{score,target}.mjs site/public/demo/
describe('site demo vendors the real scoring modules', () => {
  for (const name of ['score.mjs', 'target.mjs']) {
    it(`${name} is byte-identical to src/web/public`, () => {
      const original = readFileSync(join(__dirname, 'public', name), 'utf8');
      const vendored = readFileSync(join(__dirname, '..', '..', 'site', 'public', 'demo', name), 'utf8');
      assert.equal(vendored, original);
    });
  }
});
