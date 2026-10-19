import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLabel } from './source-names';
import { atsChoices } from './pages/companies';

describe('sourceLabel', () => {
  it('maps enum values to display names', () => {
    assert.equal(sourceLabel('LARAJOBS_RSS'), 'Laravel Jobs');
    assert.equal(sourceLabel('WEWORKREMOTELY'), 'We Work Remotely');
    assert.equal(sourceLabel('HN_HIRING'), 'HN Who is hiring');
    assert.equal(sourceLabel('GREENHOUSE'), 'Greenhouse');
  });

  it('passes unknown values through unchanged', () => {
    assert.equal(sourceLabel('NEW_BOARD'), 'NEW_BOARD');
  });
});

describe('atsChoices', () => {
  it('names each ATS on Add one company as the tables do, the value its code (#606)', () => {
    const choices = atsChoices([]);
    assert.deepEqual(choices[0], { value: 'GREENHOUSE', label: 'Greenhouse', worded: false });
    assert.equal(choices.find((c) => c.value === 'SMARTRECRUITERS')?.label, 'SmartRecruiters');
    // A kind that is no vendor reads in the reader's language; a vendor's name is a name.
    assert.deepEqual(choices.find((c) => c.value === 'FEED'), { value: 'FEED', label: 'RSS/Atom feed', worded: true });
  });

  it('offers a keyed source only once its key is saved', () => {
    assert.equal(atsChoices([]).some((c) => c.value === 'ADZUNA'), false);
    assert.equal(atsChoices(['ADZUNA']).some((c) => c.value === 'ADZUNA'), true);
  });
});
