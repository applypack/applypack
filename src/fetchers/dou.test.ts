import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { douFeedUrl, mapDouItem, type DouItem } from './dou';

const COMPANY_ID = 3001;

// Recorded from `?category=PHP&remote` on 2026-09-03 (descriptions trimmed).
const betterme: DouItem = {
  title: 'Backend Engineer Core Team (Go + PHP) в BetterMe, Київ, за кордоном, віддалено',
  link: 'https://jobs.dou.ua/companies/betterme/vacancies/332846/?utm_source=jobsrss',
  guid: 'https://jobs.dou.ua/companies/betterme/vacancies/332846/?1788429748',
  pubDate: 'Thu, 03 Sep 2026 13:02:28 +0300',
  content: '<p><strong>About us:</strong></p><p><strong>BetterMe</strong>&nbsp;— an all-in-one well-being ecosystem.</p><ul><li>Go and PHP</li></ul>',
};

const starlight: DouItem = {
  title: 'Senior Full-Stack Developer (PHP / Go / Vue.js) в Starlight Media, $2000–2500, віддалено',
  link: 'https://jobs.dou.ua/companies/starlight-media/vacancies/371880/?utm_source=jobsrss',
  pubDate: 'Wed, 02 Sep 2026 10:00:00 +0300',
  content: '<p>Ми шукаємо розробника.</p>',
};

describe('douFeedUrl', () => {
  it('keeps the known keys, encodes values and writes remote bare', () => {
    assert.equal(douFeedUrl('category=PHP&remote'), 'https://jobs.dou.ua/vacancies/feeds/?category=PHP&remote');
    assert.equal(douFeedUrl('?category=Front End&city=Київ'), 'https://jobs.dou.ua/vacancies/feeds/?category=Front%20End&city=%D0%9A%D0%B8%D1%97%D0%B2');
    assert.equal(douFeedUrl('search=laravel&exp=5plus&page=2'), 'https://jobs.dou.ua/vacancies/feeds/?search=laravel&exp=5plus&page=2');
  });

  it('drops unknown keys and an empty token is the newest fifty', () => {
    assert.equal(douFeedUrl('category=PHP&utm_source=x'), 'https://jobs.dou.ua/vacancies/feeds/?category=PHP');
    assert.equal(douFeedUrl(''), 'https://jobs.dou.ua/vacancies/feeds/');
  });
});

describe('mapDouItem', () => {
  it('maps the title grammar into title, employer, location and hints', () => {
    const job = mapDouItem(betterme, COMPANY_ID);
    assert.ok(job);
    assert.equal(job.externalId, '332846');
    assert.equal(job.title, 'Backend Engineer Core Team (Go + PHP)');
    assert.equal(job.url, betterme.link);
    assert.equal(job.location, 'Київ, за кордоном, віддалено');
    assert.match(job.description, /^Hiring company: BetterMe\.\n\nAbout us:/);
    assert.match(job.description, /BetterMe — an all-in-one well-being ecosystem\./);
    assert.match(job.description, /• Go and PHP/);
    assert.equal(job.postedAt.toISOString(), '2026-09-03T10:02:28.000Z');
    assert.deepEqual(job.locationHints, { workplace: 'REMOTE', countries: ['UA'] });
  });

  it('folds the salary into the description and reads a foreign city through its country', () => {
    const job = mapDouItem(starlight, COMPANY_ID);
    assert.ok(job);
    assert.match(job.description, /^Hiring company: Starlight Media\. Salary: \$2000–2500\.\n\nМи шукаємо розробника\./);
    assert.equal(job.location, 'віддалено');
    const lisbon = mapDouItem({ ...starlight, title: 'PHP Developer в meetFrankie, Лісабон (Португалія)' }, COMPANY_ID);
    assert.equal(lisbon?.location, 'Лісабон (Португалія)');
    assert.deepEqual(lisbon?.locationHints, { workplace: 'UNKNOWN', countries: ['PT'] });
  });

  it('falls back to the feed key when the link has no vacancy id, and skips an item with nothing', () => {
    const odd = mapDouItem({ ...starlight, link: 'https://jobs.dou.ua/x' }, COMPANY_ID);
    assert.ok(odd && odd.externalId.length > 0);
    assert.equal(mapDouItem({ title: '' }, COMPANY_ID), null);
  });
});
