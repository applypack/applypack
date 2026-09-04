import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AtsType } from '@prisma/client';
import { boardMissReason, verdictLabel, verdictLine } from './verdict';

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
    assert.equal(verdictLabel({ kind: 'feed', url: 'u', items: 12, via: 'u' }), 'RSS feed · 12 entries');
    assert.equal(verdictLabel({ kind: 'feed', url: 'u', items: 1, via: 'u' }), 'RSS feed · 1 entry');
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
