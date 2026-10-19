import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readBoardInput } from './add-company';

describe('readBoardInput (#534)', () => {
  it('reads a board link as the board it names', () => {
    // The issue's own steps: refused as "HTTP 404 — token likely invalid", every field emptied.
    assert.deepEqual(readBoardInput('GREENHOUSE', 'https://job-boards.greenhouse.io/netlify'), {
      ok: true,
      atsType: 'GREENHOUSE',
      atsToken: 'netlify',
      picked: null,
    });
    assert.deepEqual(readBoardInput('ASHBY', '  https://jobs.ashbyhq.com/Linear/job-1 '), { ok: true, atsType: 'ASHBY', atsToken: 'linear', picked: null });
  });

  it('follows the link when it names another vendor than the select, and says which was picked', () => {
    assert.deepEqual(readBoardInput('LEVER', 'https://job-boards.greenhouse.io/netlify'), {
      ok: true,
      atsType: 'GREENHOUSE',
      atsToken: 'netlify',
      picked: 'LEVER',
    });
  });

  it('keeps a slug, a feed query and a feed or page link as typed, trimmed', () => {
    assert.deepEqual(readBoardInput('GREENHOUSE', ' netlify '), { ok: true, atsType: 'GREENHOUSE', atsToken: 'netlify', picked: null });
    assert.deepEqual(readBoardInput('DOU', 'category=PHP&remote'), { ok: true, atsType: 'DOU', atsToken: 'category=PHP&remote', picked: null });
    assert.deepEqual(readBoardInput('FEED', 'https://acme.com/jobs.rss'), { ok: true, atsType: 'FEED', atsToken: 'https://acme.com/jobs.rss', picked: null });
    assert.deepEqual(readBoardInput('CAREER_PAGE', 'https://acme.com/careers'), {
      ok: true,
      atsType: 'CAREER_PAGE',
      atsToken: 'https://acme.com/careers',
      picked: null,
    });
  });

  it('refuses a link to no board for a vendor whose token is a slug', () => {
    assert.deepEqual(readBoardInput('GREENHOUSE', 'https://acme.com/careers'), { ok: false });
  });
});
