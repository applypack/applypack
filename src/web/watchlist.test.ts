import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/*
 * The browser module is served as-is, so it is imported the same way the
 * browser loads it — see src/web/target.test.ts for the pattern.
 */
interface WatchlistModule {
  resolveLine: (s: { resolved: number; total: number; current: string | null; done: boolean }) => string;
  short: (u: string) => string;
  verdictLine: (r: { name: string; verdict: string }) => string;
}

let mod: WatchlistModule;

before(async () => {
  // The module calls init() at load; give it the globals it touches.
  (globalThis as Record<string, unknown>).document = {
    getElementById: () => null,
    querySelectorAll: () => [],
  };
  // @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
  mod = (await import('./public/watchlist.mjs')) as WatchlistModule;
});

describe('resolveLine', () => {
  it('counts what is done', () => {
    assert.equal(mod.resolveLine({ resolved: 0, total: 20, current: null, done: false }), '0 of 20 resolved');
  });

  it('names the URL in flight', () => {
    assert.equal(
      mod.resolveLine({ resolved: 7, total: 20, current: 'https://linear.app/careers', done: false }),
      '7 of 20 resolved · linear.app/careers',
    );
  });

  it('says what happens next when the run is done', () => {
    assert.match(mod.resolveLine({ resolved: 20, total: 20, current: null, done: true }), /opening the preview/);
  });
});

describe('short', () => {
  it('drops the scheme and the trailing slash', () => {
    assert.equal(mod.short('https://www.netlify.com/careers/'), 'www.netlify.com/careers');
    assert.equal(mod.short('http://acme.com'), 'acme.com');
  });

  it('caps a long URL so the line does not wrap', () => {
    assert.equal(mod.short(`https://acme.com/${'x'.repeat(200)}`).length, 60);
  });
});

describe('verdictLine', () => {
  it('reads as one sentence', () => {
    assert.equal(mod.verdictLine({ name: 'Vercel', verdict: 'Greenhouse · 88 postings' }), 'Vercel — Greenhouse · 88 postings');
  });
});
