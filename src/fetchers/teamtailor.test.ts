import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapTeamtailorItem, teamtailorFeedUrl, teamtailorHost } from './teamtailor';

// rss-parser's view of a live tibber item (2026-09-03), trimmed.
const principal = {
  title: 'Principal Engineer',
  link: 'https://jobs.tibber.com/jobs/8265036-principal-engineer',
  guid: '9d565a5c-3b50-4368-a59b-4f8282a556b4',
  pubDate: 'Tue, 25 Aug 2026 10:52:07 +0200',
  isoDate: '2026-08-25T08:52:07.000Z',
  content: '<p><span>We&#8217;re at a pivotal moment for both Tibber &amp; the planet.</span></p><ul><li>Own the platform</li></ul>',
  remoteStatus: 'hybrid',
  'tt:locations': {
    'tt:location': [
      { 'tt:name': ['Berlin'], 'tt:address': ['Strelitzer Straße'], 'tt:zip': ['10115'], 'tt:city': ['Berlin'], 'tt:country': ['Germany'] },
      { 'tt:name': ['Stockholm'], 'tt:city': ['Stockholm'], 'tt:country': ['Sweden'] },
    ],
  },
  'tt:department': 'House of Product & Engineering',
  'tt:role': 'Principal Engineer',
};

describe('mapTeamtailorItem', () => {
  it('maps an item: numeric id from the link, places as words, codes and arrangement as hints, head lines', () => {
    const job = mapTeamtailorItem(principal, 4, 'Tibber');
    assert.equal(job?.externalId, '8265036');
    assert.equal(job?.title, 'Principal Engineer');
    assert.equal(job?.url, 'https://jobs.tibber.com/jobs/8265036-principal-engineer');
    assert.equal(job?.location, 'Hybrid · Berlin, Germany / Stockholm, Sweden');
    assert.deepEqual(job?.locationHints, { countries: ['DE', 'SE'], workplace: 'HYBRID' });
    assert.equal(job?.postedAt.toISOString(), '2026-08-25T08:52:07.000Z');
    assert.equal(
      job?.description,
      'Hiring company: Tibber. Department: House of Product & Engineering. Role: Principal Engineer.\n\nWe’re at a pivotal moment for both Tibber & the planet.\n\n• Own the platform',
    );
  });

  it('reads a fully remote posting without places, an on-site one, and an unknown status', () => {
    const remote = mapTeamtailorItem({ ...principal, remoteStatus: 'fully', 'tt:locations': undefined }, 4);
    assert.equal(remote?.location, 'Remote');
    assert.deepEqual(remote?.locationHints, { workplace: 'REMOTE' });
    assert.doesNotMatch(remote?.description ?? '', /^Hiring company/);
    assert.match(remote?.description ?? '', /^Department: House of Product & Engineering\. Role: Principal Engineer\.\n\nWe’re at a pivotal/);
    const office = mapTeamtailorItem(
      { ...principal, remoteStatus: 'none', 'tt:locations': { 'tt:location': { 'tt:name': ['HQ'], 'tt:city': [''], 'tt:country': ['Netherlands'] } } },
      4,
    );
    assert.equal(office?.location, 'On-site · HQ, Netherlands');
    assert.deepEqual(office?.locationHints, { countries: ['NL'], workplace: 'ONSITE' });
    const temporary = mapTeamtailorItem({ ...principal, remoteStatus: 'temporary' }, 4);
    assert.equal(temporary?.location, 'Berlin, Germany / Stockholm, Sweden');
    assert.deepEqual(temporary?.locationHints, { countries: ['DE', 'SE'] });
  });

  it('falls back to the guid for the id and skips an item with neither', () => {
    assert.equal(mapTeamtailorItem({ ...principal, link: 'https://jobs.tibber.com/jobs' }, 4)?.externalId, '9d565a5c-3b50-4368-a59b-4f8282a556b4');
    assert.equal(mapTeamtailorItem({ title: '', link: '', guid: '' }, 4), null);
  });
});

describe('teamtailorHost / teamtailorFeedUrl', () => {
  it('turns a slug into the vendor host, keeps a public host, refuses the rest', () => {
    assert.equal(teamtailorHost('tibber'), 'tibber.teamtailor.com');
    assert.equal(teamtailorHost(' https://Jobs.Tibber.com/jobs/1 '), 'jobs.tibber.com');
    assert.equal(teamtailorHost('tibber.teamtailor.com'), 'tibber.teamtailor.com');
    assert.throws(() => teamtailorHost('intranet.local'), /not a public host/);
    assert.throws(() => teamtailorHost('10.0.0.5'), /not a public host/);
    assert.throws(() => teamtailorHost('ev il'), /neither a slug/);
    assert.equal(teamtailorHost('evil/../x'), 'evil.teamtailor.com');
    assert.equal(teamtailorFeedUrl('tibber.teamtailor.com'), 'https://tibber.teamtailor.com/jobs.rss');
  });
});
