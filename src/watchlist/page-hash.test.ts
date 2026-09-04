import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_ALERT_GAP_MS, decideChange, normalisePageText, pageHash } from './page-hash';

const NOW = new Date('2026-09-04T12:00:00Z');
const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

describe('normalisePageText', () => {
  it('keeps the prose and drops the markup', () => {
    assert.equal(normalisePageText(page('<h1>Careers</h1><p>We are hiring.</p>')), 'Careers We are hiring.');
  });

  // Measured: raw HTML changed on 4 of 10 careers pages between two fetches
  // ninety seconds apart. Every difference was in an attribute or a script.
  it('ignores the nonce, build id and session token that live in the markup', () => {
    const a = '<html><head><meta name="csp-nonce" content="abc123"><script>window.__BUILD="9f2c"</script></head><body><h1>Careers</h1></body></html>';
    const b = '<html><head><meta name="csp-nonce" content="zzz999"><script>window.__BUILD="0a11"</script></head><body><h1>Careers</h1></body></html>';
    assert.equal(pageHash(a), pageHash(b));
  });

  it('ignores a reflow that only moves the same words', () => {
    assert.equal(pageHash(page('<p>Open roles</p>')), pageHash(page('<p>Open\n\n   roles</p>')));
  });

  // The §17 plan proposed masking digits. On the sample, every digit in the
  // prose WAS the signal.
  it('keeps the counts a careers page publishes', () => {
    assert.notEqual(pageHash(page('<p>92 positions</p>')), pageHash(page('<p>93 positions</p>')));
    assert.notEqual(pageHash(page('<p>0 Job</p>')), pageHash(page('<p>1 Job</p>')));
  });

  it('keeps a word change, because a reader decides whether it matters', () => {
    assert.notEqual(pageHash(page('<p>Senior Engineer</p>')), pageHash(page('<p>Staff Engineer</p>')));
  });

  it('is stable across runs and short enough for a column', () => {
    const h = pageHash(page('<p>Careers</p>'));
    assert.equal(h, pageHash(page('<p>Careers</p>')));
    assert.equal(h.length, 32);
    assert.match(h, /^[0-9a-f]+$/);
  });
});

describe('decideChange', () => {
  const seen = (hash: string | null, alertedAt: Date | null = null) => ({
    lastContentHash: hash,
    lastContentAlertAt: alertedAt,
  });

  it('says nothing the first time — there is no change yet', () => {
    const d = decideChange(seen(null), page('<p>Careers</p>'), NOW);
    assert.equal(d.kind, 'first');
    assert.equal((d as { hash: string }).hash, pageHash(page('<p>Careers</p>')));
  });

  it('is quiet while the text is what we last reported', () => {
    const html = page('<p>Careers</p>');
    assert.equal(decideChange(seen(pageHash(html)), html, NOW).kind, 'unchanged');
  });

  it('reports a change when we have not said so today', () => {
    const d = decideChange(seen('old', new Date(NOW.getTime() - CHANGE_ALERT_GAP_MS)), page('<p>New</p>'), NOW);
    assert.equal(d.kind, 'changed');
    assert.equal((d as { hash: string }).hash, pageHash(page('<p>New</p>')));
  });

  it('reports a change when we have never alerted', () => {
    assert.equal(decideChange(seen('old', null), page('<p>New</p>'), NOW).kind, 'changed');
  });

  // The hash is only advanced on an alert, so a change inside the quiet
  // window is still pending at the next allowed check rather than swallowed.
  it('holds a change that lands less than a day after the last alert', () => {
    const anHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    assert.equal(decideChange(seen('old', anHourAgo), page('<p>New</p>'), NOW).kind, 'held');
  });

  it('releases it once a full day has passed', () => {
    const justOver = new Date(NOW.getTime() - CHANGE_ALERT_GAP_MS - 1);
    assert.equal(decideChange(seen('old', justOver), page('<p>New</p>'), NOW).kind, 'changed');
  });

  it('a page that changes twice inside the window still alerts once, on the newest text', () => {
    const recent = new Date(NOW.getTime() - 60 * 60 * 1000);
    // First change is held; the row keeps 'old'.
    assert.equal(decideChange(seen('old', recent), page('<p>Second</p>'), NOW).kind, 'held');
    // A day later the row still holds 'old', so the newest text is reported.
    const tomorrow = new Date(NOW.getTime() + CHANGE_ALERT_GAP_MS);
    const d = decideChange(seen('old', recent), page('<p>Third</p>'), tomorrow);
    assert.equal(d.kind, 'changed');
    assert.equal((d as { hash: string }).hash, pageHash(page('<p>Third</p>')));
  });
});
