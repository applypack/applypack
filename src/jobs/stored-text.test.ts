import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { repairStoredText, type StoredText } from './stored-text';

const row = (over: Partial<StoredText>): StoredText => ({
  atsType: 'GREENHOUSE',
  title: 'Backend Engineer',
  description: 'Build APIs.',
  location: 'Berlin',
  employer: null,
  ...over,
});

describe('repairStoredText', () => {
  it('changes nothing in a row the fetchers would write the same today', () => {
    assert.deepEqual(repairStoredText(row({})), {});
    assert.deepEqual(repairStoredText(row({ atsType: 'FOURDAYWEEK', description: 'Hiring company: Acme.\n\n**Role**\n\n  - nested item\n\n\n- Postgres' })), {});
  });

  it('decodes the entities stripHtml left in a description, a line at a time (#659)', () => {
    const fixed = repairStoredText(row({ description: 'Learning &amp; Development&nbsp;budget\n\n• Pay in &euro;, caf&eacute;\n  kept  as it was' }));
    assert.equal(fixed.description, 'Learning & Development budget\n\n• Pay in €, café\n  kept  as it was');
  });

  it('reads one layer of stored text, so a tag the text spells stays text', () => {
    assert.equal(repairStoredText(row({ description: 'Experience with &lt;canvas&gt; and &amp;lt;' })).description, 'Experience with <canvas> and &lt;');
    // Text that now holds a "<b>" is never stripped again.
    assert.deepEqual(repairStoredText(row({ description: 'Wrap it in <b> and\nkeep the lines' })), {});
  });

  it('still strips a body that holds real markup, open and closed', () => {
    assert.equal(repairStoredText(row({ description: '<p>One</p><p>Two</p>' })).description, 'One\n\nTwo');
  });

  it('trims a title, closes its runs of spaces and decodes it (#659, #662)', () => {
    assert.deepEqual(repairStoredText(row({ title: 'Recruiter,  Sales (AMER)   ' })), { title: 'Recruiter, Sales (AMER)' });
    assert.deepEqual(repairStoredText(row({ atsType: 'DOU', title: 'Software Architect (Booking platform &amp; APIs)', location: 'віддалено' })), {
      title: 'Software Architect (Booking platform & APIs)',
    });
  });

  it("reads RemoteOK's Latin-1 spelling of UTF-8 back, and keys the employer it names (#662)", () => {
    const fixed = repairStoredText(row({ atsType: 'REMOTEOK', title: 'Lead â\u0080\u0094 Logistics', description: 'Weâ\u0080\u0099re hiring.', location: 'Remote · ZÃ¼rich', employer: 'CafÃ© Labs' }));
    assert.deepEqual(fixed, {
      title: 'Lead — Logistics',
      description: 'We’re hiring.',
      location: 'Remote · Zürich',
      employer: 'Café Labs',
      employerKey: 'cafe labs',
    });
  });

  it('takes out the half of a no-break space stripHtml already turned into a space', () => {
    const stored = row({ atsType: 'REMOTEOK', description: 'Job Summary\u00c2\nWe\u00e2\u0080\u0099re hiring, no harassment of any type\u00c2 on the basis\n\n\u00c2\n\nTravail \u00c3 distance' });
    assert.equal(repairStoredText(stored).description, 'Job Summary\nWe\u2019re hiring, no harassment of any type on the basis\n\nTravail \u00e0 distance');
  });

  it('leaves the Latin-1 letters of any other source alone', () => {
    assert.deepEqual(repairStoredText(row({ title: 'DÃ©veloppeur' })), {});
  });

  it('names who hires a Golangprojects row from its title (#662)', () => {
    const fixed = repairStoredText(row({ atsType: 'GOLANGPROJECTS', title: 'Senior Backend Engineer @ Rain', location: 'Remote · Europe' }));
    assert.deepEqual(fixed, { title: 'Senior Backend Engineer', employer: 'Rain', employerKey: 'rain' });
  });

  it('names each 4dayweek place once, and reads an HN place off the title again (#662)', () => {
    assert.equal(
      repairStoredText(row({ atsType: 'FOURDAYWEEK', location: 'Remote · United States / United States / Rahway, United States / United States' })).location,
      'Remote · United States / Rahway, United States',
    );
    assert.equal(repairStoredText(row({ atsType: 'HN_JOBS', title: '9 Mothers (YC P26) Is Hiring in Austin, TX', location: 'YC P26' })).location, 'Austin, TX');
  });

  it("moves DOU's pay out of the place and into the header line (#662)", () => {
    const stored = row({ atsType: 'DOU', title: 'Go Developer', location: 'до&nbsp;$5000, Львів, віддалено', description: 'Hiring company: Acme.\n\nМи шукаємо.' });
    assert.deepEqual(repairStoredText(stored), { location: 'Львів, віддалено', description: 'Hiring company: Acme. Salary: до $5000.\n\nМи шукаємо.' });
    assert.equal(repairStoredText({ ...stored, description: 'Ми шукаємо.' }).description, 'Salary: до $5000.\n\nМи шукаємо.');
  });
});
