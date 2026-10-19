import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The landing demo (site/public/demo/) ships byte copies of the pure scoring
// modules so applypack.dev cannot drift from what the dashboard actually runs.
// target.mjs words its tooltips through i18n.mjs, which reads i18n-en.mjs, so those two ride along.
// If this fails, re-copy: cp src/web/public/{score,target,evidence,i18n,i18n-en}.mjs site/public/demo/
describe('site demo vendors the real scoring modules', () => {
  for (const name of ['score.mjs', 'target.mjs', 'evidence.mjs', 'i18n.mjs', 'i18n-en.mjs']) {
    it(`${name} is byte-identical to src/web/public`, () => {
      const original = readFileSync(join(__dirname, 'public', name), 'utf8');
      const vendored = readFileSync(join(__dirname, '..', '..', 'site', 'public', 'demo', name), 'utf8');
      assert.equal(vendored, original);
    });
  }
});

// The page shows the fixture's AI score beside the live number, so on the
// untouched resume the two must agree, or the demo opens on a delta nobody made.
describe('site demo fixture', () => {
  it("the AI score is what the live formula gives the fixture's own resume", async () => {
    const fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', 'site', 'public', 'demo', 'fixture.json'), 'utf8'));
    // @ts-expect-error — plain JS with no declaration file.
    const { scoreKeywords } = await import('./public/target.mjs');
    // @ts-expect-error — plain JS with no declaration file.
    const { computeScore, entriesFromLive } = await import('./public/score.mjs');
    const { rows } = scoreKeywords(fixture.keywords, fixture.resumeText);
    const { scoring } = fixture;
    const { score } = computeScore(entriesFromLive(rows), scoring.alignment, scoring.redFlagCount, scoring.penalty);
    assert.equal(score, fixture.aiScore);
  });
});
