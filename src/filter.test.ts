import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { passesBaseFilter } from './filter';

const phpProfile = {
  stackRequired: ['php', 'laravel', 'symfony', 'backend', 'full-stack'],
  stackExclude: ['junior', 'intern', 'wordpress'],
  remoteOk: true,
  remoteRegions: ['US', 'Worldwide'],
  onsiteCities: [],
  hybridOk: false,
};

const austinHybridProfile = {
  stackRequired: ['java', 'spring'],
  stackExclude: ['junior'],
  remoteOk: true,
  remoteRegions: ['US'],
  onsiteCities: ['Austin, TX'],
  hybridOk: true,
};

describe('passesBaseFilter — required stack', () => {
  it('accepts a job whose title contains a required keyword', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior Laravel Engineer', location: 'Remote, US' },
        phpProfile,
      ),
      true,
    );
  });

  it('rejects a job whose title has none of the required keywords', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior Rust Engineer', location: 'Remote, US' },
        phpProfile,
      ),
      false,
    );
  });

  it('is case-insensitive', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior LARAVEL Developer', location: 'Remote, US' },
        phpProfile,
      ),
      true,
    );
  });

  it('matches "full-stack" with various spellings', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior Full-Stack Engineer', location: 'Remote' },
        phpProfile,
      ),
      true,
    );
  });

  it('accepts everything when stackRequired is empty', () => {
    const open = { ...phpProfile, stackRequired: [] };
    assert.equal(
      passesBaseFilter(
        { title: 'Senior Rust Engineer', location: 'Remote' },
        open,
      ),
      true,
    );
  });
});

describe('passesBaseFilter — exclude stack', () => {
  it('rejects "Junior PHP Developer"', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Junior PHP Developer', location: 'Remote, US' },
        phpProfile,
      ),
      false,
    );
  });

  it('rejects intern roles', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'PHP Intern', location: 'Remote' },
        phpProfile,
      ),
      false,
    );
  });

  it('rejects wordpress-only titles', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior WordPress Developer', location: 'Remote, US' },
        phpProfile,
      ),
      false,
    );
  });
});

describe('passesBaseFilter — location: remote-only profile', () => {
  it('accepts remote + US-eligible region', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior PHP Engineer', location: 'Remote, United States' },
        phpProfile,
      ),
      true,
    );
  });

  it('accepts remote + Worldwide marker', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior PHP Engineer', location: 'Worldwide remote' },
        phpProfile,
      ),
      true,
    );
  });

  it('accepts plain "Remote" with no region info (Claude decides)', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior PHP Engineer', location: 'Remote' },
        phpProfile,
      ),
      true,
    );
  });

  it('rejects on-site role when only remote is OK', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior PHP Engineer', location: 'On-site, NYC' },
        phpProfile,
      ),
      false,
    );
  });

  it('lets empty location through (Claude decides)', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior PHP Engineer', location: '' },
        phpProfile,
      ),
      true,
    );
  });
});

describe('passesBaseFilter — location: on-site cities + hybrid', () => {
  it('accepts on-site role in a listed city', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior Java Engineer', location: 'On-site, Austin, TX' },
        austinHybridProfile,
      ),
      true,
    );
  });

  it('rejects on-site role in a different city', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior Java Engineer', location: 'On-site, Chicago, IL' },
        austinHybridProfile,
      ),
      false,
    );
  });

  it('accepts hybrid role in a listed city', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Senior Java Engineer', location: 'Hybrid, Austin, TX' },
        austinHybridProfile,
      ),
      true,
    );
  });

  it('accepts remote role with US region for the same profile', () => {
    assert.equal(
      passesBaseFilter(
        {
          title: 'Senior Java Engineer',
          location: 'Remote, United States',
        },
        austinHybridProfile,
      ),
      true,
    );
  });
});

describe('passesBaseFilter — strict (remote off, hybrid off)', () => {
  const officeOnly = {
    stackRequired: ['java'],
    stackExclude: [],
    remoteOk: false,
    remoteRegions: [],
    onsiteCities: ['Austin, TX'],
    hybridOk: false,
  };

  it('rejects remote even if region matches', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Java Engineer', location: 'Remote, US' },
        officeOnly,
      ),
      false,
    );
  });

  it('accepts on-site Austin role', () => {
    assert.equal(
      passesBaseFilter(
        { title: 'Java Engineer', location: 'Austin, TX' },
        officeOnly,
      ),
      true,
    );
  });
});
