import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AtsType } from '@prisma/client';
import { boardMissReason, firstCheckSize, verdictLabel, verdictLine } from './verdict';
import { t } from '../i18n/t';

describe('verdictLabel', () => {
  it('names the vendor and counts the postings', () => {
    assert.equal(
      verdictLabel({ kind: 'ats', atsType: AtsType.GREENHOUSE, atsToken: 'vercel', jobs: 88, via: 'x' }),
      'Greenhouse · 88 postings',
    );
    assert.equal(
      verdictLabel({ kind: 'ats', atsType: AtsType.GREENHOUSE, atsToken: 'netlify', jobs: 1, via: 'x' }),
      'Greenhouse · 1 posting',
    );
  });

  it('counts feed entries', () => {
    assert.equal(verdictLabel({ kind: 'feed', url: 'u', items: 12, via: 'u', crawlDelayMs: null }), 'RSS feed · 12 entries');
    assert.equal(verdictLabel({ kind: 'feed', url: 'u', items: 1, via: 'u', crawlDelayMs: null }), 'RSS feed · 1 entry');
  });

  it('labels a page drawn in the browser, and says what to do with it', () => {
    assert.equal(verdictLabel({ kind: 'needsBrowser', url: 'u' }), 'Needs a browser');
    assert.match(verdictLine({ kind: 'needsBrowser', url: 'u' }), /paste the page/);
  });

  it('labels the two verdicts that found nothing', () => {
    assert.equal(verdictLabel({ kind: 'watchOnly', reason: 'x' }), 'Nothing machine-readable');
    assert.equal(verdictLabel({ kind: 'refused', reason: 'x' }), 'Refused');
  });
});

describe('verdictLine', () => {
  it('says what was found when something was', () => {
    assert.equal(
      verdictLine({ kind: 'ats', atsType: AtsType.ASHBY, atsToken: 'linear', jobs: 28, via: 'x' }),
      'Ashby · 28 postings',
    );
  });

  it('says why nothing was, when nothing was — the reason is the useful half', () => {
    assert.equal(verdictLine({ kind: 'refused', reason: 'That URL answered HTTP 429.' }), 'That URL answered HTTP 429.');
    assert.equal(verdictLine({ kind: 'watchOnly', reason: 'No job board on that page.' }), 'No job board on that page.');
  });
});

describe('boardMissReason', () => {
  it('gets the article right for a vowel-initial vendor', () => {
    assert.match(boardMissReason({ atsType: AtsType.ASHBY, atsToken: 'deno' }), /^That is an Ashby board/);
    assert.match(boardMissReason({ atsType: AtsType.GREENHOUSE, atsToken: 'x' }), /^That is a Greenhouse board/);
  });

  it('quotes the token that failed, so the user can check it', () => {
    assert.match(boardMissReason({ atsType: AtsType.ASHBY, atsToken: 'deno' }), /does not serve "deno"/);
  });
});

describe('firstCheckSize (#681)', () => {
  it("sums what this batch's boards and feeds list, and counts only them", () => {
    const size = firstCheckSize([
      { kind: 'ats', atsType: AtsType.GREENHOUSE, atsToken: 'gitlab', jobs: 234, via: 'x' },
      { kind: 'ats', atsType: AtsType.ASHBY, atsToken: 'pleo', jobs: 35, via: 'x' },
      { kind: 'feed', url: 'u', items: 32, via: 'u', crawlDelayMs: null },
      { kind: 'changeWatch', url: 'u', chars: 900, crawlDelayMs: null },
      { kind: 'needsBrowser', url: 'u' },
    ]);
    assert.deepEqual(size, { boards: 3, postings: 301 });
    assert.match(t('watchlist.preview.hint', size), /: 301 postings on 3 companies in this list\./);
    assert.match(t('watchlist.preview.hint', { boards: 1, postings: 1 }), /: 1 posting on 1 company in this list\./);
  });
});
