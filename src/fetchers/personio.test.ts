import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPersonioFeed, mapPersonioPosition, parsePersonioXml, personioFeedUrl, personioSlug } from './personio';

// Trimmed from the live feeds of 2026-09-03 (holidu, personio, everphone).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
  <position>
    <id>1834171</id>
    <subcompany>Personio SE &amp; Co. KG</subcompany>
    <office>Munich</office>
    <additionalOffices>
      <office>Berlin</office>
      <office>Munich</office>
    </additionalOffices>
    <department>Product and Tech</department>
    <recruitingCategory>Engineering</recruitingCategory>
    <name>Staff Software Engineer, Data Platform</name>
    <jobDescriptions>
      <jobDescription>
        <name>The Role: How you&#39;ll make an impact</name>
        <value><![CDATA[<strong>This position is hybrid</strong><br><br>At Personio, your work transforms &amp; more.<ul><li>Own the platform</li></ul>]]></value>
      </jobDescription>
      <jobDescription>
        <name>CONTACT_PERSON</name>
        <value><![CDATA[<p>Jane Recruiter, jane@example.com</p>]]></value>
      </jobDescription>
      <jobDescription>
        <name></name>
        <value><![CDATA[<p>Trailing note.</p>]]></value>
      </jobDescription>
    </jobDescriptions>
    <employmentType>permanent</employmentType>
    <seniority>experienced</seniority>
    <schedule>full-or-part-time</schedule>
    <yearsOfExperience>2-5</yearsOfExperience>
    <salaryInformation>
      <min>60000</min>
      <max>80000</max>
      <currencySymbol>€</currencySymbol>
      <currencyCode>EUR</currencyCode>
      <type>per_year</type>
    </salaryInformation>
    <occupation>software_and_web_development</occupation>
    <createdAt>2024-11-13T14:10:41+00:00</createdAt>
  </position>
  <position>
    <id>2777239</id>
    <subcompany>Holidu Hosts Italy S.r.l.</subcompany>
    <office>Remote Italy</office>
    <department>Hosts - Sales &amp; Account Management</department>
    <name><![CDATA[Talent Pool Bolzano – Sales & Account Management (all genders)]]></name>
    <jobDescriptions></jobDescriptions>
    <employmentType>intern</employmentType>
    <seniority>student</seniority>
    <schedule>full-time</schedule>
    <createdAt>2026-09-01T18:43:02+00:00</createdAt>
  </position>
  <position>
    <id>1</id>
    <office>Nowhere</office>
  </position>
</workzag-jobs>`;

describe('parsePersonioXml', () => {
  it('reads the positions with their offices, sections and salary, skipping a block without a name', () => {
    const positions = parsePersonioXml(XML);
    assert.deepEqual(positions.map((p) => p.id), ['1834171', '2777239']);
    const [staff, pool] = positions;
    assert.equal(staff?.name, 'Staff Software Engineer, Data Platform');
    assert.equal(staff?.subcompany, 'Personio SE & Co. KG');
    assert.deepEqual(staff?.offices, ['Munich', 'Berlin']);
    assert.equal(staff?.salary, '€ 60000-80000 (per year)');
    assert.deepEqual(staff?.sections.map((s) => s.name), ["The Role: How you'll make an impact", 'CONTACT_PERSON', '']);
    assert.match(staff?.sections[0]?.html ?? '', /^<strong>This position is hybrid<\/strong>/);
    assert.equal(pool?.name, 'Talent Pool Bolzano – Sales & Account Management (all genders)');
    assert.deepEqual(pool?.offices, ['Remote Italy']);
    assert.deepEqual(pool?.sections, []);
    assert.equal(pool?.salary, null);
    assert.equal(pool?.createdAt, '2026-09-01T18:43:02+00:00');
  });

  it('answers nothing for a page that is not a feed', () => {
    assert.deepEqual(parsePersonioXml('<!DOCTYPE html><html><body>Career Site</body></html>'), []);
    assert.equal(isPersonioFeed(XML), true);
    assert.equal(isPersonioFeed('<html><body>Career Site</body></html>'), false);
  });
});

describe('fetchPersonio mapping', () => {
  it('builds the job from a position: url from the id, offices joined, head lines and sections as text', () => {
    const [staff, pool] = parsePersonioXml(XML);
    const job = mapPersonioPosition(staff!, 7, 'personio');
    assert.equal(job.externalId, '1834171');
    assert.equal(job.url, 'https://personio.jobs.personio.de/job/1834171?language=en');
    assert.equal(job.location, 'Munich / Berlin');
    assert.equal(job.postedAt.toISOString(), '2024-11-13T14:10:41.000Z');
    assert.equal(
      job.description,
      "Hiring company: Personio SE & Co. KG. Department: Product and Tech. Employment: permanent, full or part time. Seniority: experienced. Experience: 2-5 years. Salary: € 60000-80000 (per year).\n\nThe Role: How you'll make an impact\n\nThis position is hybrid\n\nAt Personio, your work transforms & more.\n\n• Own the platform\n\nTrailing note.",
    );
    assert.equal(job.locationHints, undefined);
    const second = mapPersonioPosition(pool!, 7, 'holidu');
    assert.equal(second.location, 'Remote Italy');
    assert.equal(second.description, 'Hiring company: Holidu Hosts Italy S.r.l.. Department: Hosts - Sales & Account Management. Employment: intern, full time. Seniority: student.');
  });
});

describe('personioSlug / personioFeedUrl', () => {
  it('accepts a slug or the feed host and refuses the rest', () => {
    assert.equal(personioSlug('holidu'), 'holidu');
    assert.equal(personioSlug(' https://Holidu.jobs.personio.de/job/1?language=en '), 'holidu');
    assert.equal(personioSlug('ottonova.jobs.personio.com'), 'ottonova');
    assert.throws(() => personioSlug('holidu.example.com'), /neither a slug/);
    assert.throws(() => personioSlug('evil/../x'), /neither a slug/);
    assert.equal(personioFeedUrl('holidu'), 'https://holidu.jobs.personio.de/xml?language=en');
  });
});
