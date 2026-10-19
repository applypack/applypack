import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  anyBaseFilterReason,
  baseFilterReason,
  filterChanged,
  passesAnyBaseFilter,
  passesBaseFilter,
  placesOverlap,
  titleHasKeyword,
  type FilterableJob,
  type FilterProfile,
} from './filter';
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

  it('does not let an exclude fire inside a longer word', () => {
    // "intern" must not read "International"; measured: excluding "java"
    // dropped 7 of 13 matching titles, all of them JavaScript roles.
    const p = { ...phpProfile, stackRequired: ['php', 'javascript'] };
    assert.equal(passesBaseFilter(job('International PHP Lead', 'Remote, US'), p), true);
    assert.equal(
      passesBaseFilter(job('Senior JavaScript Engineer', 'Remote, US'), { ...p, stackExclude: ['java'] }),
      true,
    );
  });
});

describe('titleHasKeyword — word boundaries', () => {
  const yes = (title: string, keyword: string) =>
    assert.equal(titleHasKeyword(title.toLowerCase(), keyword), true, `${keyword} in ${title}`);
  const no = (title: string, keyword: string) =>
    assert.equal(titleHasKeyword(title.toLowerCase(), keyword), false, `${keyword} in ${title}`);

  it('does not match inside a longer word', () => {
    no('Senior JavaScript Engineer', 'java');
    no('Staff Engineer, Google Cloud', 'go');
    no('Territory Account Executive, Chicago', 'go');
    no('Director of Government Affairs', 'go');
    no('Principal Consultant, Reactive Services', 'react');
    no('Engineer, maintain the platform', 'ai');
  });

  it('matches the word itself', () => {
    yes('Senior Java Engineer', 'java');
    yes('Go Backend Engineer', 'go');
    yes('Software Engineer (Go)', 'go');
    yes('Senior React Developer', 'react');
  });

  it('keeps punctuation-edged keywords matchable', () => {
    yes('C++ Developer', 'c++');
    yes('Senior C# Engineer', 'c#');
    yes('.NET Backend Developer', '.net');
    yes('ASP.NET Core Engineer', '.net');
    yes('Node.js Engineer', 'node.js');
    no('Kubernetes Engineer', '.net');
  });

  it('allows the measured suffixes and nothing else', () => {
    yes('Senior Golang Developer', 'go');
    yes('CQA Team Leader', 'team lead');
    yes('Django + VueJS Developer', 'vue');
    yes('Sales Engineer', 'sale');
    yes('Engineering Manager, Platform', 'engineer');
    no('Gooseworks Founding Engineer', 'go');
    no('Senior Internship Programme', 'intern');
    no('PHP8 Backend Developer', 'php');
  });

  it('ignores an empty keyword', () => {
    no('Senior PHP Developer', '');
  });

  it('reads a hyphen, a space, a dot or nothing between the parts as one spelling (#528)', () => {
    // The titles the setup's suggestions turned away on 2026-10-18.
    yes('Senior back-end engineer', 'backend');
    yes('Senior Software Engineer – Full Stack', 'full-stack');
    yes('Senior Fullstack Developer', 'full-stack');
    yes('Backend Engineer', 'back-end');
    yes('Senior NodeJS Developer', 'node.js');
    yes('Senior Node JS Developer', 'node.js');
    yes('Senior Node.js Developer', 'nodejs');
    yes('Senior Back End Engineers', 'backend');
    // The boundaries are still the title's own.
    no('Fullstackish Developer', 'full-stack');
    no('Senior Back-Endless Engineer', 'backend');
    yes('ASP.NET Core Engineer', '.net');
  });

  it('applies the spelling rule to every list, the exclude list too', () => {
    const p = { ...phpProfile, stackRequired: ['php'], stackExclude: ['front-end'] };
    assert.equal(passesBaseFilter(job('Senior Frontend PHP Engineer', 'Remote, US'), p), false);
    assert.equal(passesBaseFilter(job('Senior Back End PHP Engineer', 'Remote, US'), { ...p, stackRequired: [], roleTypes: ['backend'] }), true);
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

describe('baseFilterReason — which gate turned the posting away', () => {
  it('names each gate in turn, and nothing for a posting that passes', () => {
    assert.equal(baseFilterReason(job('Senior Ruby Engineer', 'Remote'), phpProfile), 'title');
    assert.equal(baseFilterReason(job('Junior PHP Developer', 'Remote'), phpProfile), 'excluded');
    assert.equal(baseFilterReason(job('PHP Developer', 'Berlin, Germany (on-site)'), phpProfile), 'workplace');
    assert.equal(baseFilterReason(job('PHP Developer', 'Remote, Brazil'), euProfile), 'place');
    assert.equal(baseFilterReason(job('Senior PHP Developer', 'Remote'), phpProfile), null);
  });

  it('agrees with passesBaseFilter on every case', () => {
    for (const j of [job('Senior Ruby Engineer', 'Remote'), job('PHP Developer', 'Remote, Brazil'), job('Laravel Backend Engineer', 'Remote')]) {
      for (const p of [phpProfile, euProfile, austinHybridProfile]) {
        assert.equal(passesBaseFilter(j, p), baseFilterReason(j, p) === null, `${j.title} / ${j.location}`);
      }
    }
  });
});

describe('anyBaseFilterReason — the union', () => {
  it('is null when any search admits the posting', () => {
    assert.equal(anyBaseFilterReason(job('Java Engineer', 'Remote'), [phpProfile, austinHybridProfile]), null);
  });

  it('keeps the gate of the search that got the posting furthest', () => {
    // The PHP search fails it on its title; the EU search matches the title and fails it on the place.
    assert.equal(anyBaseFilterReason(job('PHP Developer', 'Remote, Brazil'), [austinHybridProfile, euProfile]), 'place');
  });

  it('with no search at all, the first gate is the reason', () => {
    assert.equal(anyBaseFilterReason(job('PHP Developer', 'Remote'), []), 'title');
  });
});

describe('filterChanged (#448)', () => {
  const search: FilterProfile = { stackRequired: ['backend'], roleTypes: ['developer'], stackExclude: ['junior'], countries: ['DE'], regions: ['EU'], workplace: ['REMOTE'], onsiteCities: ['Berlin'] };

  it('is false for the same search, whatever the order or the case of its lists', () => {
    assert.equal(filterChanged(search, { ...search }), false);
    assert.equal(filterChanged({ ...search, stackRequired: ['backend', 'data'] }, { ...search, stackRequired: ['Data', ' backend '] }), false);
    // What the filter never reads may differ.
    assert.equal(filterChanged(search, { ...search, notes: 'x', minFitScore: 90 } as FilterProfile), false);
  });

  it('is true when any field the filter reads admits or turns away something else', () => {
    assert.equal(filterChanged(search, { ...search, stackRequired: ['backend', 'data'] }), true);
    assert.equal(filterChanged(search, { ...search, roleTypes: [] }), true);
    assert.equal(filterChanged(search, { ...search, stackExclude: [] }), true);
    assert.equal(filterChanged(search, { ...search, countries: ['DE', 'PL'] }), true);
    assert.equal(filterChanged(search, { ...search, regions: [] }), true);
    assert.equal(filterChanged(search, { ...search, workplace: ['REMOTE', 'HYBRID'] }), true);
    assert.equal(filterChanged(search, { ...search, onsiteCities: ['Munich'] }), true);
  });
});
