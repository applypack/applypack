import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapLandingJobsItem } from './landingjobs';

// rss-parser's view of two live entries (2026-09-03), trimmed.
const lisbon = {
  'lj:category': 'QA / Testing',
  'lj:job_type': 'Permanent',
  'lj:remote_policy': 'Partial remote',
  'lj:location': { 'lj:city': ['Lisbon'], 'lj:country': ['Portugal'] },
  'lj:salary': '€39.200 - €47.600',
  author: 'INSCALE',
  title: 'Quality Assurance Engineer',
  link: 'https://landing.jobs/at/inscale/quality-assurance-engineer-in-lisbon-2026?utm_campaign=landing+rss&utm_source=rss',
  id: 'https://landing.jobs/at/inscale/quality-assurance-engineer-in-lisbon-2026',
  isoDate: '2026-09-03T14:29:18.000Z',
  content:
    '\n      <img class="logo" src="https://s3.example/logo" /><div class="offer-info">At INSCALE (Permanent), in Lisbon, Portugal<br />Salary: €39.200 - €47.600<br />Expires at: 2027-03-02<br />Remote policy: Partial remote</div><div><p>We are looking for a <strong>QA Engineer</strong> &amp; more.</p></div>',
};

describe('mapLandingJobsItem', () => {
  it('maps an entry: path id, the feed\'s place words, hints from its own fields, the posting as text', () => {
    const job = mapLandingJobsItem(lisbon, 9);
    assert.equal(job?.externalId, 'inscale/quality-assurance-engineer-in-lisbon-2026');
    assert.equal(job?.title, 'Quality Assurance Engineer');
    assert.equal(job?.url, lisbon.link);
    assert.equal(job?.location, 'Partial remote · Lisbon, Portugal');
    assert.deepEqual(job?.locationHints, { countries: ['PT'], workplace: 'HYBRID' });
    assert.equal(job?.postedAt.toISOString(), '2026-09-03T14:29:18.000Z');
    assert.equal(
      job?.description,
      'Category: QA / Testing.\n\nAt INSCALE (Permanent), in Lisbon, Portugal\nSalary: €39.200 - €47.600\nExpires at: 2027-03-02\nRemote policy: Partial remote\n\nWe are looking for a QA Engineer & more.',
    );
  });

  it('reads a country-wide remote posting, a foreign one, and an unknown policy', () => {
    const brazil = mapLandingJobsItem(
      { ...lisbon, 'lj:remote_policy': 'Full remote', 'lj:location': { 'lj:city': [''], 'lj:country': ['Brazil'] }, 'lj:category': '' },
      9,
    );
    assert.equal(brazil?.location, 'Full remote · Brazil');
    assert.deepEqual(brazil?.locationHints, { countries: ['BR'], workplace: 'REMOTE' });
    assert.match(brazil?.description ?? '', /^At INSCALE/);
    const wide = mapLandingJobsItem({ ...lisbon, 'lj:location': { 'lj:city': ['Portugal'], 'lj:country': ['Portugal'] } }, 9);
    assert.equal(wide?.location, 'Partial remote · Portugal');
    const office = mapLandingJobsItem({ ...lisbon, 'lj:remote_policy': 'On-site', 'lj:location': { 'lj:city': ['Munich'], 'lj:country': ['Germany'] } }, 9);
    assert.equal(office?.location, 'On-site · Munich, Germany');
    assert.deepEqual(office?.locationHints, { countries: ['DE'] });
  });

  it('falls back to the link for the id and skips an entry with neither', () => {
    const noId = mapLandingJobsItem({ ...lisbon, id: undefined }, 9);
    assert.equal(noId?.externalId, 'inscale/quality-assurance-engineer-in-lisbon-2026');
    assert.equal(mapLandingJobsItem({ title: '', link: '', id: '' }, 9), null);
  });
});
