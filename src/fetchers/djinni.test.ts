import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { djinniFeedUrl, djinniPlace, mapDjinniItem, type DjinniItem } from './djinni';

const COMPANY_ID = 3002;
const TOKEN = 'primary_keyword=PHP&employment=remote&region=UKR';

// Recorded from `?primary_keyword=PHP&employment=remote&region=UKR` on 2026-09-03 (description trimmed).
const teamLead: DjinniItem = {
  title: 'Backend Team Lead (PHP)',
  link: 'https://djinni.co/jobs/846307-backend-team-lead-php/',
  guid: 'https://djinni.co/jobs/846307-backend-team-lead-php/',
  pubDate: 'Wed, 02 Sep 2026 18:14:24 +0300',
  categories: ['PHP', ''],
  content: '<p>We are looking for an experienced <strong>Backend Team Lead</strong> with a strong PHP background.</p><p>&nbsp;</p><ul><li>High-load SMS AdTech</li></ul>',
};

describe('djinniFeedUrl', () => {
  it('keeps the known keys, encodes values, drops the rest', () => {
    assert.equal(djinniFeedUrl(TOKEN), 'https://djinni.co/jobs/rss/?primary_keyword=PHP&employment=remote&region=UKR');
    assert.equal(djinniFeedUrl('?primary_keyword=Node.js&location=kyiv&utm=x'), 'https://djinni.co/jobs/rss/?primary_keyword=Node.js&location=kyiv');
    assert.equal(djinniFeedUrl(''), 'https://djinni.co/jobs/rss/');
  });
});

describe('djinniPlace — the location a filter implies', () => {
  it('reads employment and region into the string and the hints', () => {
    assert.deepEqual(djinniPlace(TOKEN), { location: 'Remote · Ukraine', hints: { countries: ['UA'], workplace: 'REMOTE' } });
    assert.deepEqual(djinniPlace('primary_keyword=PHP&region=eu'), { location: 'EU', hints: { regions: ['EU'] } });
    assert.deepEqual(djinniPlace('employment=office&location=kyiv&region=UKR'), {
      location: 'Office · Kyiv, Ukraine',
      hints: { countries: ['UA'], workplace: 'ONSITE' },
    });
  });

  it('a filter without a place says nothing', () => {
    assert.deepEqual(djinniPlace('primary_keyword=PHP'), { location: '', hints: {} });
    assert.deepEqual(djinniPlace('primary_keyword=PHP&region=other'), { location: 'outside Ukraine', hints: {} });
    assert.deepEqual(djinniPlace('primary_keyword=PHP&country=pol'), { location: 'POL', hints: {} });
  });
});

describe('mapDjinniItem', () => {
  const place = djinniPlace(TOKEN);

  it('maps an item with the filter as its location', () => {
    const job = mapDjinniItem(teamLead, COMPANY_ID, place, 'PHP');
    assert.ok(job);
    assert.equal(job.externalId, '846307');
    assert.equal(job.title, 'Backend Team Lead (PHP)');
    assert.equal(job.location, 'Remote · Ukraine');
    assert.match(job.description, /^We are looking for an experienced Backend Team Lead with a strong PHP background\./);
    assert.match(job.description, /• High-load SMS AdTech/);
    assert.equal(job.postedAt.toISOString(), '2026-09-02T15:14:24.000Z');
    assert.deepEqual(job.locationHints, { countries: ['UA'], workplace: 'REMOTE' });
  });

  it('drops a row whose category is not the requested keyword (the bare-feed fallback)', () => {
    assert.equal(mapDjinniItem({ ...teamLead, categories: ['Python', ''] }, COMPANY_ID, place, 'PHP'), null);
    assert.ok(mapDjinniItem({ ...teamLead, categories: ['php'] }, COMPANY_ID, place, 'PHP'));
    assert.ok(mapDjinniItem({ ...teamLead, categories: ['Python'] }, COMPANY_ID, place, null));
  });

  it('falls back to the feed key without a vacancy id, and skips an item with nothing', () => {
    const odd = mapDjinniItem({ ...teamLead, link: 'https://djinni.co/x' }, COMPANY_ID, place, 'PHP');
    assert.ok(odd && odd.externalId.length > 0);
    assert.equal(mapDjinniItem({ title: '' }, COMPANY_ID, place, null), null);
  });
});
