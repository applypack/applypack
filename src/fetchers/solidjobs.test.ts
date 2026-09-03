import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapSolidJobsPage, solidJobsUrl } from './solidjobs';

// Trimmed from the live payload of 2026-09-03 (offers/IT, page 0 of 3).
const page = {
  jobs: [
    {
      jobOfferKey: '6edd62c3-422a-4246-a3c9-806915ad7596',
      title: 'Senior Azure Platform Engineer',
      division: 'IT',
      category: 'DevOps',
      company: 'Xebia',
      salary: { from: 20200.0, to: 27600.0, currency: 'PLN', period: 'Month', employmentType: 'B2B' },
      contractTime: 'full_time',
      locations: ['Wrocław'],
      isRemote: false,
      isHybrid: true,
      url: 'https://solid.jobs/o/k3s2o0ok/applypack',
      experienceLevel: 'Senior',
      skills: [
        { level: 'Expert', name: 'Azure' },
        { level: 'Advanced', name: 'Python' },
        { name: 'GitOps' },
      ],
      languages: [{ level: 'Advanced', name: 'Angielski' }],
      description: '<div class="well"><p><strong>Czym będziesz się zajmować?</strong></p><ul><li>Designing &amp; operating Azure</li></ul></div>',
      validFrom: '2026-09-03T19:27:39.4345406+02:00',
      validTo: '2026-10-04T19:27:39.4345406+02:00',
      updatedAt: '2026-09-03T19:19:31.7851301+02:00',
    },
    {
      jobOfferKey: 'remote-both',
      title: ' PHP Developer ',
      url: 'https://solid.jobs/o/abc/applypack',
      locations: ['Warszawa', 'Kraków'],
      isRemote: true,
      isHybrid: true,
      salary: { from: 15000, to: 15000, currency: 'PLN', period: 'Month', employmentType: 'UoP' },
    },
    { jobOfferKey: 'bare', title: 'QA', url: 'https://solid.jobs/o/q/applypack' },
    { title: 'no key', url: 'https://solid.jobs/o/x/applypack' },
  ],
  pageIndex: 0,
  pageSize: 500,
  totalCount: 1468,
  totalPages: 3,
};

describe('mapSolidJobsPage', () => {
  it('maps an offer: key, hybrid city, PLN salary and skills in the header, PL hint from the board', () => {
    const { jobs, hasMore } = mapSolidJobsPage(page, 7);
    assert.equal(hasMore, true);
    assert.equal(jobs.length, 3);
    const [xebia] = jobs;
    assert.equal(xebia?.externalId, '6edd62c3-422a-4246-a3c9-806915ad7596');
    assert.equal(xebia?.title, 'Senior Azure Platform Engineer');
    assert.equal(xebia?.url, 'https://solid.jobs/o/k3s2o0ok/applypack');
    assert.equal(xebia?.location, 'Hybrid · Wrocław, Poland');
    assert.deepEqual(xebia?.locationHints, { countries: ['PL'], workplace: 'HYBRID' });
    assert.equal(xebia?.postedAt.toISOString(), '2026-09-03T17:27:39.434Z');
    assert.equal(
      xebia?.description.split('\n\n')[0],
      'Hiring company: Xebia. Level: Senior. Contract: B2B, full time. Salary: 20200-27600 PLN (month). Skills: Azure (Expert), Python (Advanced), GitOps.',
    );
    assert.match(xebia?.description ?? '', /Czym będziesz się zajmować\?\n\n• Designing & operating Azure/);
  });

  it('reads remote-or-hybrid as remote, a flat salary as one number, and a bare offer as on-site Poland', () => {
    const { jobs } = mapSolidJobsPage(page, 7);
    const [, both, bare] = jobs;
    assert.equal(both?.title, 'PHP Developer');
    assert.equal(both?.location, 'Remote or hybrid · Warszawa, Kraków, Poland');
    assert.equal(both?.locationHints?.workplace, 'REMOTE');
    assert.equal(both?.description, 'Contract: UoP. Salary: 15000 PLN (month).');
    assert.equal(bare?.location, 'Poland');
    assert.deepEqual(bare?.locationHints, { countries: ['PL'], workplace: 'ONSITE' });
    assert.equal(bare?.description, '');
  });

  it('stops on the last page and on a malformed payload', () => {
    assert.equal(mapSolidJobsPage({ ...page, pageIndex: 2 }, 7).hasMore, false);
    assert.deepEqual(mapSolidJobsPage({ offers: [] }, 7), { jobs: [], hasMore: false });
  });

  it('builds the page URL with the mandatory campaign slug', () => {
    assert.equal(solidJobsUrl(2), 'https://solid.jobs/public-api/offers/IT?campaign=applypack&pageSize=500&pageIndex=2');
  });
});
