import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { devItJobsHost, mapDevItJobsItem, parseDevItJobsTitle } from './devitjobs';

// From the live feeds of 2026-09-03.
const CONTENT = `<p><b>Salary: 25.000 - 35.000 € per year</b></p>
    <b>Requirements:</b>
    <ul><li>Werkstudierende</li><li>Teilzeit</li><li>Hybrid</li></ul>
    <b>Responsibilities:</b>
    <ul><li>Unterstützung bei Gerätebereitstellungen</li></ul>
    <b>Technologies:</b>
    <ul><li>Hardware</li></ul>
    <p><b>More:</b></p>
    <p>Bei Arethia vereinen wir langjährige Erfahrung mit kontinuierlichem Fortschritt.</p>`;

describe('parseDevItJobsTitle', () => {
  it('splits role, company and the salary bracket, keeping dashes and ampersands where they are', () => {
    assert.deepEqual(parseDevItJobsTitle('Werkstudent IT (m/w/d) @ Arethia Services Germany GmbH & Co. KG [25.000 - 35.000 €]'), {
      role: 'Werkstudent IT (m/w/d)',
      company: 'Arethia Services Germany GmbH & Co. KG',
      salary: '25.000 - 35.000 €',
    });
    assert.deepEqual(parseDevItJobsTitle('Software Developer / Software Engineer - C++ @ Additional Resources [£17,500 - 35,000]'), {
      role: 'Software Developer / Software Engineer - C++',
      company: 'Additional Resources',
      salary: '£17,500 - 35,000',
    });
    assert.deepEqual(parseDevItJobsTitle('Data Engineer @ Decathlon'), { role: 'Data Engineer', company: 'Decathlon', salary: null });
    assert.deepEqual(parseDevItJobsTitle('Just a title'), { role: 'Just a title', company: null, salary: null });
  });
});

describe('mapDevItJobsItem', () => {
  const item = {
    title: 'Werkstudent IT (m/w/d) @ Arethia Services Germany GmbH &amp; Co. KG [25.000 - 35.000 €]',
    link: 'https://germantechjobs.de/jobs/Arethia-Services-Germany-GmbH--Co-KG-Werkstudent-IT-mwd?utm_source=our_rss_feed&amp;utm_medium=our_rss_feed',
    guid: 'https://germantechjobs.de/jobs/Arethia-Services-Germany-GmbH--Co-KG-Werkstudent-IT-mwd?utm_source=our_rss_feed&amp;utm_medium=our_rss_feed',
    pubDate: 'Thu, 03 Sep 2026 16:01:53 GMT',
    'content:encoded': CONTENT,
  };

  const now = new Date('2026-09-04T00:00:00Z');

  it('maps an item: slug id, role as title, company in the header, the site as the country', () => {
    const job = mapDevItJobsItem(item, 5, 'germantechjobs.de', now);
    assert.equal(job?.externalId, 'Arethia-Services-Germany-GmbH--Co-KG-Werkstudent-IT-mwd');
    assert.equal(job?.title, 'Werkstudent IT (m/w/d)');
    assert.equal(job?.url, 'https://germantechjobs.de/jobs/Arethia-Services-Germany-GmbH--Co-KG-Werkstudent-IT-mwd?utm_source=our_rss_feed&utm_medium=our_rss_feed');
    assert.equal(job?.location, 'Germany');
    assert.deepEqual(job?.locationHints, { countries: ['DE'] });
    assert.equal(job?.postedAt.toISOString(), '2026-09-03T16:01:53.000Z');
    assert.match(job?.description ?? '', /^Hiring company: Arethia Services Germany GmbH & Co\. KG\.\n\nSalary: 25\.000 - 35\.000 € per year\n/);
    assert.match(job?.description ?? '', /Requirements:\n\n• Werkstudierende\n• Teilzeit\n• Hybrid\n/);
  });

  it('names the other sites, refuses a foreign host, and skips items older than 90 days', () => {
    assert.equal(mapDevItJobsItem(item, 5, 'devitjobs.uk', now)?.location, 'United Kingdom');
    assert.deepEqual(mapDevItJobsItem(item, 5, 'devitjobs.uk', now)?.locationHints, { countries: ['GB'] });
    assert.equal(mapDevItJobsItem(item, 5, 'devitjobs.nl', now)?.location, 'Netherlands');
    assert.equal(mapDevItJobsItem(item, 5, 'swissdevjobs.ch', now), null);
    assert.equal(mapDevItJobsItem({ ...item, link: '', title: '' }, 5, 'devitjobs.nl', now), null);
    assert.equal(mapDevItJobsItem({ ...item, pubDate: 'Sun, 09 May 2021 22:00:00 GMT' }, 5, 'devitjobs.nl', now), null);
    assert.equal(mapDevItJobsItem({ ...item, pubDate: 'Tue, 07 Jul 2026 00:00:00 GMT' }, 5, 'devitjobs.nl', now)?.postedAt.toISOString(), '2026-07-07T00:00:00.000Z');
  });
});

describe('devItJobsHost', () => {
  it('accepts the three hosts in any spelling and refuses the rest', () => {
    assert.equal(devItJobsHost('germantechjobs.de'), 'germantechjobs.de');
    assert.equal(devItJobsHost(' https://www.DevITjobs.uk/rss '), 'devitjobs.uk');
    assert.throws(() => devItJobsHost('swissdevjobs.ch'), /unknown site/);
    assert.throws(() => devItJobsHost('evil.example/devitjobs.nl'), /unknown site/);
  });
});
