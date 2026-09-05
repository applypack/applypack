import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLiveness,
  interpretApiResult,
  isFetchableJobUrl,
  postingIdFromUrl,
  resolveLivenessProbe,
  runLivenessLadder,
  type LivenessJobInput,
} from './liveness';

const job = (over: Partial<LivenessJobInput>): LivenessJobInput => ({
  url: 'https://example.com/careers/1',
  externalId: '123456',
  atsType: 'MANUAL',
  atsToken: 'manual-example',
  ...over,
});

describe('resolveLivenessProbe — company fields', () => {
  it('maps every tracked ATS to its fixed-host API', () => {
    assert.deepEqual(
      resolveLivenessProbe(job({ atsType: 'GREENHOUSE', atsToken: 'gusto', externalId: '8128426' })),
      {
        vendor: 'greenhouse',
        apiUrl: 'https://boards-api.greenhouse.io/v1/boards/gusto/jobs/8128426',
        jobId: '8128426',
      },
    );
    const uuid = '466ed4a1-2c00-400e-8b9b-77b0c63d64d2';
    assert.deepEqual(
      resolveLivenessProbe(job({ atsType: 'LEVER', atsToken: 'veeva', externalId: uuid })),
      { vendor: 'lever', apiUrl: `https://api.lever.co/v0/postings/veeva/${uuid}`, jobId: uuid },
    );
    assert.deepEqual(
      resolveLivenessProbe(job({ atsType: 'ASHBY', atsToken: 'buffer', externalId: uuid })),
      { vendor: 'ashby', apiUrl: 'https://api.ashbyhq.com/posting-api/job-board/buffer', jobId: uuid },
    );
    assert.deepEqual(
      resolveLivenessProbe(job({ atsType: 'WORKABLE', atsToken: 'netguru', externalId: 'FADBE5F043' })),
      {
        vendor: 'workable',
        apiUrl: 'https://apply.workable.com/api/v2/accounts/netguru/jobs/FADBE5F043',
        jobId: 'FADBE5F043',
      },
    );
    // SmartRecruiters slugs are case-sensitive — case must survive.
    assert.deepEqual(
      resolveLivenessProbe(
        job({ atsType: 'SMARTRECRUITERS', atsToken: 'Devoteam', externalId: '744000146341189' }),
      ),
      {
        vendor: 'smartrecruiters',
        apiUrl: 'https://api.smartrecruiters.com/v1/companies/Devoteam/postings/744000146341189',
        jobId: '744000146341189',
      },
    );
  });

  it('resolves a Greenhouse job behind a custom domain via company fields', () => {
    const p = resolveLivenessProbe(
      job({
        atsType: 'GREENHOUSE',
        atsToken: 'block',
        externalId: '4667604008',
        url: 'http://block.xyz/careers/jobs/4667604008?gh_jid=4667604008',
      }),
    );
    assert.equal(p?.apiUrl, 'https://boards-api.greenhouse.io/v1/boards/block/jobs/4667604008');
  });

  it('returns null for aggregator/manual types with unrecognized URLs', () => {
    assert.equal(resolveLivenessProbe(job({ atsType: 'REMOTEOK' })), null);
    assert.equal(resolveLivenessProbe(job({ atsType: 'MANUAL' })), null);
  });

  it('rejects malicious or malformed segments', () => {
    assert.equal(
      resolveLivenessProbe(job({ atsType: 'GREENHOUSE', atsToken: '../secrets', externalId: '1234567' })),
      null,
    );
    assert.equal(
      resolveLivenessProbe(job({ atsType: 'GREENHOUSE', atsToken: 'ok', externalId: '1/2' })),
      null,
    );
    assert.equal(
      resolveLivenessProbe(job({ atsType: 'LEVER', atsToken: 'a%2e%2eb', externalId: '1234567' })),
      null,
    );
    assert.equal(
      resolveLivenessProbe(job({ atsType: 'WORKABLE', atsToken: '', externalId: 'ABC' })),
      null,
    );
    assert.equal(
      resolveLivenessProbe(
        job({ atsType: 'ASHBY', atsToken: 'x'.repeat(81), externalId: '1234567' }),
      ),
      null,
    );
  });
});

describe('resolveLivenessProbe — URL fallback', () => {
  const uuid = 'a1b2c3d4-0000-1111-2222-333344445555';

  it('recognizes hosted pages of all five vendors', () => {
    assert.equal(
      resolveLivenessProbe(job({ url: `https://jobs.lever.co/spotify/${uuid}` }))?.apiUrl,
      `https://api.lever.co/v0/postings/spotify/${uuid}`,
    );
    assert.equal(
      resolveLivenessProbe(job({ url: `https://jobs.eu.lever.co/acme/${uuid}` }))?.apiUrl,
      `https://api.eu.lever.co/v0/postings/acme/${uuid}`,
    );
    assert.equal(
      resolveLivenessProbe(job({ url: `https://jobs.ashbyhq.com/openai/${uuid}` }))?.apiUrl,
      'https://api.ashbyhq.com/posting-api/job-board/openai',
    );
    assert.equal(
      resolveLivenessProbe(job({ url: 'https://boards.greenhouse.io/gusto/jobs/8128426' }))?.apiUrl,
      'https://boards-api.greenhouse.io/v1/boards/gusto/jobs/8128426',
    );
    assert.equal(
      resolveLivenessProbe(job({ url: 'https://job-boards.greenhouse.io/gusto/jobs/8128426' }))?.apiUrl,
      'https://boards-api.greenhouse.io/v1/boards/gusto/jobs/8128426',
    );
    assert.equal(
      resolveLivenessProbe(job({ url: 'https://apply.workable.com/netguru/j/FADBE5F043/' }))?.apiUrl,
      'https://apply.workable.com/api/v2/accounts/netguru/jobs/FADBE5F043',
    );
    assert.equal(
      resolveLivenessProbe(
        job({ url: 'https://jobs.smartrecruiters.com/Devoteam/744000146341189-devops-engineer' }),
      )?.apiUrl,
      'https://api.smartrecruiters.com/v1/companies/Devoteam/postings/744000146341189',
    );
  });

  it('ignores lookalike and unparseable URLs', () => {
    assert.equal(resolveLivenessProbe(job({ url: 'https://jobs.lever.co.evil.com/a/b' })), null);
    assert.equal(resolveLivenessProbe(job({ url: 'https://boards.greenhouse.io/gusto' })), null);
    assert.equal(resolveLivenessProbe(job({ url: 'not a url' })), null);
    assert.equal(resolveLivenessProbe(job({ url: '' })), null);
    assert.equal(
      resolveLivenessProbe(job({ url: 'https://jobs.smartrecruiters.com/Acme/not-numeric' })),
      null,
    );
  });
});

describe('interpretApiResult', () => {
  it('greenhouse: 200 live, 404 gone, blocked/5xx uncertain', () => {
    assert.deepEqual(interpretApiResult('greenhouse', 200, '{}', '1'), {
      liveness: 'active',
      code: 'api_ok',
    });
    assert.deepEqual(interpretApiResult('greenhouse', 404, '', '1'), {
      liveness: 'expired',
      code: 'api_gone',
    });
    assert.equal(interpretApiResult('greenhouse', 403, '', '1').liveness, 'uncertain');
    assert.equal(interpretApiResult('greenhouse', 429, '', '1').code, 'access_blocked');
    assert.deepEqual(interpretApiResult('greenhouse', 500, '', '1'), {
      liveness: 'uncertain',
      code: 'server_error',
    });
  });

  it('lever: a 404 is never authoritative (confidential postings)', () => {
    assert.deepEqual(interpretApiResult('lever', 404, '{"ok":false}', '1'), {
      liveness: 'uncertain',
      code: 'api_ambiguous',
    });
    assert.equal(interpretApiResult('lever', 200, '{}', '1').liveness, 'active');
  });

  it('ashby: verdict comes from board membership + isListed', () => {
    const boardWith = (jobs: unknown[]) => JSON.stringify({ jobs });
    const id = 'AAA-1';
    assert.deepEqual(
      interpretApiResult('ashby', 200, boardWith([{ id: 'aaa-1', isListed: true }]), id),
      { liveness: 'active', code: 'api_ok' },
    );
    assert.deepEqual(
      interpretApiResult('ashby', 200, boardWith([{ id: 'aaa-1', isListed: false }]), id),
      { liveness: 'expired', code: 'api_delisted' },
    );
    assert.deepEqual(interpretApiResult('ashby', 200, boardWith([{ id: 'other' }]), id), {
      liveness: 'expired',
      code: 'api_delisted',
    });
    // Board 404 may just mean a renamed org slug — rung 2 decides.
    assert.deepEqual(interpretApiResult('ashby', 404, 'Not Found', id), {
      liveness: 'uncertain',
      code: 'api_ambiguous',
    });
    assert.equal(interpretApiResult('ashby', 200, 'not json', id).liveness, 'uncertain');
    assert.equal(interpretApiResult('ashby', 200, '{"jobs":"nope"}', id).liveness, 'uncertain');
  });

  it('workable: state drives the verdict, unknown states stay uncertain', () => {
    assert.equal(interpretApiResult('workable', 200, '{"state":"published"}', 'A').liveness, 'active');
    assert.deepEqual(interpretApiResult('workable', 200, '{"state":"closed"}', 'A'), {
      liveness: 'expired',
      code: 'api_delisted',
    });
    assert.equal(interpretApiResult('workable', 200, '{"state":"archived"}', 'A').liveness, 'expired');
    assert.equal(interpretApiResult('workable', 200, '{"state":"draft"}', 'A').liveness, 'uncertain');
    assert.equal(interpretApiResult('workable', 200, '{}', 'A').liveness, 'uncertain');
    assert.equal(interpretApiResult('workable', 404, '', 'A').liveness, 'expired');
  });

  it('smartrecruiters: active flag drives the verdict', () => {
    assert.equal(interpretApiResult('smartrecruiters', 200, '{"active":true}', '1').liveness, 'active');
    assert.deepEqual(interpretApiResult('smartrecruiters', 200, '{"active":false}', '1'), {
      liveness: 'expired',
      code: 'api_delisted',
    });
    assert.equal(interpretApiResult('smartrecruiters', 200, '{}', '1').liveness, 'uncertain');
    assert.equal(interpretApiResult('smartrecruiters', 404, '', '1').liveness, 'expired');
  });
});

describe('classifyLiveness — rule order', () => {
  const URL_GH = 'https://job-boards.greenhouse.io/gusto/jobs/999999999';
  const LONG = 'We are hiring a senior engineer to build things. '.repeat(10);

  it('404/410 → expired regardless of body', () => {
    assert.deepEqual(classifyLiveness(404, URL_GH, URL_GH, LONG), {
      liveness: 'expired',
      code: 'http_gone',
    });
    assert.equal(classifyLiveness(410, URL_GH, URL_GH, '').code, 'http_gone');
  });

  it('bot challenge wins over status and content-length heuristics', () => {
    assert.deepEqual(classifyLiveness(403, URL_GH, URL_GH, '<title>Just a moment...</title>'), {
      liveness: 'uncertain',
      code: 'bot_challenge',
    });
    assert.equal(classifyLiveness(200, URL_GH, URL_GH, 'please solve this CAPTCHA').code, 'bot_challenge');
  });

  it('403/429 blocked, 5xx server error — uncertain, never expired', () => {
    assert.deepEqual(classifyLiveness(403, URL_GH, URL_GH, 'Forbidden'), {
      liveness: 'uncertain',
      code: 'access_blocked',
    });
    assert.equal(classifyLiveness(429, URL_GH, URL_GH, '').code, 'access_blocked');
    assert.deepEqual(classifyLiveness(503, URL_GH, URL_GH, 'oops'), {
      liveness: 'uncertain',
      code: 'server_error',
    });
  });

  it('a redirect that lost the job id is uncertain — even with a closed banner on the landing page', () => {
    const landed = 'https://job-boards.greenhouse.io/gusto?error=true';
    const bannerBody = `<p>That posting is no longer accepting applications.</p>${LONG}`;
    assert.deepEqual(classifyLiveness(200, URL_GH, landed, bannerBody), {
      liveness: 'uncertain',
      code: 'redirected_off_posting',
    });
  });

  it('a redirect that keeps the job id is still the posting', () => {
    const from = 'http://block.xyz/careers/jobs/4667604008?gh_jid=4667604008';
    const to = 'https://block.xyz/careers/jobs/4667604008';
    assert.equal(classifyLiveness(200, from, to, LONG).liveness, 'active');
  });

  it('cross-host redirect without an id token is uncertain', () => {
    assert.deepEqual(
      classifyLiveness(200, 'https://himalayas.app/jobs/acme', 'https://acme.com/', LONG),
      { liveness: 'uncertain', code: 'redirected_off_posting' },
    );
  });

  it('closed banners → expired, in several languages', () => {
    const cases = [
      'This position is no longer accepting applications.',
      'The role has been filled.',
      'This job is no longer available.',
      'Applications for this position are closed.',
      'Diese Stellenanzeige ist nicht mehr verfügbar.',
      "Cette offre n'est plus disponible.",
      'Ta oferta pracy jest nieaktualna.',
      'Ця вакансія вже закрита.',
      'Esta oferta ya no está disponible.',
    ];
    for (const banner of cases) {
      assert.deepEqual(
        classifyLiveness(200, URL_GH, URL_GH, `<div>${banner}</div>${LONG}`),
        { liveness: 'expired', code: 'closed_banner' },
        banner,
      );
    }
  });

  it('live pages that merely mention filled forms or closing dates stay active', () => {
    const guards = [
      'Once the application form has been filled out, our team will reach out.',
      'Closing date: 31 December 2026. Apply now!',
      'We will keep your application on file after the position closes.',
    ];
    for (const text of guards) {
      assert.equal(classifyLiveness(200, URL_GH, URL_GH, `<p>${text}</p>${LONG}`).liveness, 'active', text);
    }
  });

  it('a near-empty rendered page (JS shell) is uncertain, not expired', () => {
    const shell = '<div id="app"></div><script src="/bundle.js"></script>';
    assert.deepEqual(classifyLiveness(200, URL_GH, URL_GH, shell), {
      liveness: 'uncertain',
      code: 'insufficient_content',
    });
  });

  it('a normal posting page is active', () => {
    assert.deepEqual(classifyLiveness(200, URL_GH, URL_GH, `<article>${LONG}</article>`), {
      liveness: 'active',
      code: 'page_ok',
    });
  });
});

describe('postingIdFromUrl', () => {
  it('extracts uuids, workable shortcodes and long numbers', () => {
    assert.equal(
      postingIdFromUrl('https://jobs.lever.co/x/466ed4a1-2c00-400e-8b9b-77b0c63d64d2/apply'),
      '466ed4a1-2c00-400e-8b9b-77b0c63d64d2',
    );
    assert.equal(postingIdFromUrl('https://apply.workable.com/acme/j/FADBE5F043/'), 'FADBE5F043');
    assert.equal(postingIdFromUrl('http://block.xyz/careers/jobs/4667604008'), '4667604008');
    assert.equal(postingIdFromUrl('https://himalayas.app/jobs/acme-engineer'), null);
  });
});

describe('isFetchableJobUrl', () => {
  it('allows public http(s) URLs only', () => {
    assert.equal(isFetchableJobUrl('https://example.com/jobs/1'), true);
    assert.equal(isFetchableJobUrl('http://block.xyz/careers/jobs/1?gh_jid=1'), true);
  });

  it('refuses local, private and non-http targets', () => {
    for (const bad of [
      'file:///etc/passwd',
      'ftp://example.com/x',
      'http://localhost:3000/jobs',
      'http://127.0.0.1/latest',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/x',
      'http://intranet/x',
      'http://db.internal/x',
      'http://user:pass@example.com/x',
      'http://2130706433/',
      'nonsense',
    ]) {
      assert.equal(isFetchableJobUrl(bad), false, bad);
    }
  });

  it('guards the post-redirect URL, not just the requested one', () => {
    // checkPostingPage follows redirects and re-runs this predicate on the URL
    // that answered, so a public host cannot bounce the fetch into the private
    // range and have the body read.
    assert.equal(isFetchableJobUrl('https://careers.example.com/jobs/1'), true);
    assert.equal(isFetchableJobUrl('http://169.254.169.254/latest/meta-data/'), false);
  });

  it('a cross-host redirect is uncertain even when the page reads fine', () => {
    const body = '<p>'.concat('Real job copy. '.repeat(40), '</p>');
    assert.deepEqual(
      classifyLiveness(200, 'https://careers.example.com/jobs/1', 'https://elsewhere.example/x', body),
      { liveness: 'uncertain', code: 'redirected_off_posting' },
    );
  });
});

it('a pasted posting with no URL gets its own code, not "unsafe link" (#161)', async () => {
  // MANUAL has no board API to ask, so the ladder needs no network to answer.
  assert.deepEqual(await runLivenessLadder(job({ url: '', atsType: 'MANUAL' })), { liveness: 'uncertain', code: 'no_url', rung: 2 });
});
