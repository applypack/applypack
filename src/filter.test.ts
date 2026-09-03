import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { passesAnyBaseFilter, passesBaseFilter, placesOverlap, type FilterableJob, type FilterProfile } from './filter';
import { parseLocation } from './location';

/** A job as the filter sees it: the string plus its parsed columns. */
const job = (title: string, location: string): FilterableJob => ({ title, location, ...parseLocation(location) });

const phpProfile: FilterProfile = {
  stackRequired: ['php', 'laravel', 'symfony'],
  roleTypes: ['full-stack', 'backend'],
  stackExclude: ['junior', 'intern', 'wordpress'],
  countries: ['US'],
  regions: ['WORLDWIDE'],
  workplace: ['REMOTE'],
  onsiteCities: [],
};

const austinHybridProfile: FilterProfile = {
  stackRequired: ['java', 'spring'],
  roleTypes: [],
  stackExclude: ['junior'],
  countries: ['US'],
  regions: [],
  workplace: ['REMOTE', 'HYBRID'],
  onsiteCities: ['Austin, TX'],
};

const euProfile: FilterProfile = {
  stackRequired: ['php'],
  roleTypes: [],
  stackExclude: [],
  countries: ['PL', 'DE'],
  regions: ['EU'],
  workplace: ['REMOTE', 'HYBRID'],
  onsiteCities: ['Warsaw'],
};

describe('passesBaseFilter — required stack', () => {
  it('accepts a job whose title contains a required keyword', () => {
    assert.equal(passesBaseFilter(job('Senior Laravel Engineer', 'Remote, US'), phpProfile), true);
  });

  it('rejects a job whose title has none of the required keywords', () => {
    assert.equal(passesBaseFilter(job('Senior Rust Engineer', 'Remote, US'), phpProfile), false);
  });

  it('is case-insensitive', () => {
    assert.equal(passesBaseFilter(job('Senior LARAVEL Developer', 'Remote, US'), phpProfile), true);
  });

  it('matches "full-stack" via roleTypes (Claude decides actual tech)', () => {
    assert.equal(passesBaseFilter(job('Senior Full-Stack Engineer', 'Remote'), phpProfile), true);
  });

  it('accepts everything when both stackRequired and roleTypes are empty', () => {
    const open = { ...phpProfile, stackRequired: [], roleTypes: [] };
    assert.equal(passesBaseFilter(job('Senior Rust Engineer', 'Remote'), open), true);
  });
});

describe('passesBaseFilter — exclude stack', () => {
  it('rejects "Junior PHP Developer"', () => {
    assert.equal(passesBaseFilter(job('Junior PHP Developer', 'Remote, US'), phpProfile), false);
  });

  it('rejects intern titles', () => {
    assert.equal(passesBaseFilter(job('PHP Intern', 'Remote'), phpProfile), false);
  });

  it('rejects wordpress-only titles', () => {
    assert.equal(passesBaseFilter(job('Senior WordPress Developer', 'Remote, US'), phpProfile), false);
  });
});

describe('passesBaseFilter — location: remote-only profile', () => {
  it('accepts remote + a listed country', () => {
    assert.equal(passesBaseFilter(job('Senior PHP Engineer', 'Remote, United States'), phpProfile), true);
  });

  it('accepts a worldwide posting', () => {
    assert.equal(passesBaseFilter(job('Senior PHP Engineer', 'Remote (Worldwide)'), phpProfile), true);
  });

  it('accepts plain "Remote" with no place named (Claude decides)', () => {
    assert.equal(passesBaseFilter(job('Senior PHP Engineer', 'Remote'), phpProfile), true);
  });

  it('rejects on-site and hybrid roles when only remote is accepted', () => {
    assert.equal(passesBaseFilter(job('Senior PHP Engineer', 'On-site, NYC'), phpProfile), false);
    assert.equal(passesBaseFilter(job('Senior PHP Engineer', 'Berlin (Hybrid)'), phpProfile), false);
  });

  it('lets an empty location and an office-only string through (Claude decides)', () => {
    assert.equal(passesBaseFilter(job('Senior PHP Engineer', ''), phpProfile), true);
    assert.equal(passesBaseFilter(job('Senior PHP Engineer', 'Berlin, Germany'), phpProfile), true);
  });

  it('rejects a remote posting locked to a country the search does not list', () => {
    const usOnly = { ...phpProfile, regions: [] };
    assert.equal(passesBaseFilter(job('Senior PHP Engineer', 'Remote Poland'), usOnly), false);
    assert.equal(passesBaseFilter(job('Senior PHP Engineer', 'Remote · EU only'), usOnly), false);
    // WORLDWIDE on the search side admits every place.
    assert.equal(passesBaseFilter(job('Senior PHP Engineer', 'Remote Poland'), phpProfile), true);
  });
});

describe('passesBaseFilter — location: groups (ADR 0032)', () => {
  it('a country inside a listed group passes: PL ⊂ EU', () => {
    const eu = { ...euProfile, countries: [] };
    assert.equal(passesBaseFilter(job('PHP Engineer', 'Remote Poland'), eu), true);
    assert.equal(passesBaseFilter(job('PHP Engineer', 'Remote UK'), eu), false);
  });

  it('a region on the posting reaches a search whose countries sit inside it', () => {
    const pl = { ...euProfile, regions: [] };
    assert.equal(passesBaseFilter(job('PHP Engineer', 'Remote · EU only'), pl), true);
    assert.equal(passesBaseFilter(job('PHP Engineer', 'Remote · Europe'), pl), true);
    assert.equal(passesBaseFilter(job('PHP Engineer', 'Remote · LATAM'), pl), false);
  });

  it('"Europe" reaches an EU search — geography and law are settled by the classifier', () => {
    assert.equal(placesOverlap({ countries: [], regions: ['EUROPE'] }, { countries: [], regions: ['EU'] }), true);
    assert.equal(placesOverlap({ countries: ['GB'], regions: [] }, { countries: [], regions: ['EU'] }), false);
    assert.equal(placesOverlap({ countries: [], regions: ['WORLDWIDE'] }, { countries: ['UA'], regions: [] }), true);
  });

  it('an EU-only posting does not reach a US search', () => {
    assert.equal(passesBaseFilter(job('PHP Engineer', 'Remote · EU only'), { ...phpProfile, regions: [] }), false);
  });
});

describe('passesBaseFilter — location: on-site cities + hybrid', () => {
  it('accepts on-site role in a listed city', () => {
    assert.equal(passesBaseFilter(job('Senior Java Engineer', 'On-site, Austin, TX'), austinHybridProfile), true);
  });

  it('rejects on-site role in a different city', () => {
    assert.equal(passesBaseFilter(job('Senior Java Engineer', 'On-site, Chicago, IL'), austinHybridProfile), false);
  });

  it('accepts hybrid in a listed city and hybrid in a listed country', () => {
    assert.equal(passesBaseFilter(job('Senior Java Engineer', 'Hybrid, Austin, TX'), austinHybridProfile), true);
    assert.equal(passesBaseFilter(job('Senior Java Engineer', 'Hybrid · Denver, CO'), austinHybridProfile), true);
    assert.equal(passesBaseFilter(job('PHP Engineer', 'Hybrid · Berlin, Germany'), euProfile), true);
  });

  it('a listed city wins even for an arrangement the search does not accept', () => {
    const onsiteOnly = { ...austinHybridProfile, workplace: ['ONSITE' as const] };
    assert.equal(passesBaseFilter(job('Java Engineer', 'Remote, US'), onsiteOnly), false);
    assert.equal(passesBaseFilter(job('Java Engineer', 'Austin, TX'), onsiteOnly), true);
    assert.equal(passesBaseFilter(job('PHP Engineer', 'Remote · Warsaw'), { ...euProfile, workplace: ['ONSITE'] }), true);
  });

  it('an empty workplace list accepts any arrangement', () => {
    const any = { ...phpProfile, workplace: [] };
    assert.equal(passesBaseFilter(job('Senior PHP Engineer', 'On-site, NYC'), any), true);
  });
});

describe('passesAnyBaseFilter', () => {
  const goProfile: FilterProfile = {
    stackRequired: ['go', 'golang'],
    roleTypes: [],
    stackExclude: ['wordpress'],
    countries: ['US'],
    regions: [],
    workplace: ['REMOTE'],
    onsiteCities: [],
  };

  it('admits a job any running search admits', () => {
    assert.equal(passesAnyBaseFilter(job('Senior Go Platform Engineer', 'Remote, US'), [phpProfile, goProfile]), true);
    assert.equal(passesAnyBaseFilter(job('Senior Laravel Engineer', 'Remote, US'), [phpProfile, goProfile]), true);
  });

  it('rejects a job no search admits', () => {
    assert.equal(passesAnyBaseFilter(job('Senior Rust Compiler Engineer', 'Remote, US'), [phpProfile, goProfile]), false);
  });

  it('applies each search its own excludes', () => {
    assert.equal(passesAnyBaseFilter(job('Go Platform Engineer (WordPress infra)', 'Remote, US'), [phpProfile, goProfile]), false);
  });

  it('admits nothing when no search is running', () => {
    assert.equal(passesAnyBaseFilter(job('Senior Laravel Engineer', 'Remote, US'), []), false);
  });
});
