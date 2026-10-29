import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { placeLine, preferredPlaces } from './place-line';
import { techLabel, techLabels } from './tech-label';

describe('preferredPlaces', () => {
  it('is where the running searches hunt and where the user lives, each once', () => {
    assert.deepEqual(
      preferredPlaces([
        { countries: ['US', 'CA'], residence: 'UA' },
        { countries: ['US'], residence: null },
      ]),
      ['US', 'CA', 'UA'],
    );
    assert.deepEqual(preferredPlaces([]), []);
  });
});

describe('placeLine', () => {
  it('names the arrangement, the first two places and how many more', () => {
    const line = placeLine({ workplace: 'REMOTE', countries: ['US', 'CA', 'AR', 'MX', 'PE'], regions: [], location: 'Remote · USA, Canada, Argentina, Mexico, Peru' });
    assert.equal(line.text, 'Remote · USA, Canada +3');
    assert.equal(line.title, 'Remote · USA, Canada, Argentina, Mexico, Peru');
  });

  it('names the places a search hunts in before the rest', () => {
    const job = { workplace: 'REMOTE' as const, countries: ['AL', 'AT', 'AR', 'US', 'UY'], regions: [], location: '' };
    assert.equal(placeLine(job).text, 'Remote · Albania, Austria +3');
    assert.equal(placeLine(job, ['US']).text, 'Remote · USA, Albania +3');
  });

  it('falls back to the regions, then to the posting’s own words', () => {
    assert.equal(placeLine({ workplace: 'REMOTE', countries: [], regions: ['WORLDWIDE'], location: 'Remote · Anywhere in the World' }).text, 'Remote · Worldwide');
    assert.equal(placeLine({ workplace: 'REMOTE', countries: [], regions: [], location: 'Remote (EMEA hours)' }).text, 'Remote (EMEA hours)');
    assert.equal(placeLine({ workplace: 'UNKNOWN', countries: [], regions: [], location: '  ' }).text, 'Remote');
    assert.equal(placeLine({ workplace: 'HYBRID', countries: [], regions: [], location: '' }).text, 'Hybrid');
  });

  it('an unknown arrangement is left unsaid', () => {
    assert.equal(placeLine({ workplace: 'UNKNOWN', countries: ['DE'], regions: [], location: 'Berlin' }).text, 'Germany');
    assert.equal(placeLine({ workplace: 'ONSITE', countries: ['GB'], regions: [], location: 'London' }).text, 'On-site · UK');
  });
});

describe('techLabel', () => {
  it('writes a tag the way people write the technology', () => {
    assert.equal(techLabel('typescript'), 'TypeScript');
    assert.equal(techLabel('node'), 'Node.js');
    assert.equal(techLabel('aws'), 'AWS');
    assert.equal(techLabel('postgresql'), 'PostgreSQL');
    assert.equal(techLabel('next.js'), 'Next.js');
  });

  it('capitalises what it has never heard of and keeps what already has a capital', () => {
    assert.equal(techLabel('htmx'), 'Htmx');
    assert.equal(techLabel('full-stack'), 'Full-stack');
    assert.equal(techLabel('HTMX'), 'HTMX');
    assert.equal(techLabel(' react '), 'React');
  });

  it('knows the names a stored tag carries, spaced or hyphenated (#642)', () => {
    assert.equal(techLabel('rds'), 'RDS');
    assert.equal(techLabel('github-actions'), 'GitHub Actions');
    assert.equal(techLabel('github actions'), 'GitHub Actions');
    assert.equal(techLabel('json'), 'JSON');
    // A known name, then the rest of the product: each word takes its capital.
    assert.equal(techLabel('aws-lambda'), 'AWS Lambda');
    assert.equal(techLabel('docker-compose'), 'Docker Compose');
    // A name the table spells otherwise ("node" is Node.js) does not open one.
    assert.equal(techLabel('node-red'), 'Node-red');
  });

  it('lists a posting\'s tags once each after labelling them (#572)', () => {
    assert.deepEqual(techLabels(['go', 'golang', 'docker', 'Go']), ['Go', 'Docker']);
    assert.deepEqual(techLabels(['node', 'nodejs', 'node.js', '']), ['Node.js']);
  });
});
