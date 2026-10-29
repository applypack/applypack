import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bambooRows, bambooText, toNormalized, type BambooText } from './bamboohr';

const COMPANY_ID = 17;
const SLUG = 'canopy';

// Recorded on 2026-10-29: fly.io's list and two of its details, one of
// wirex's; the details' text trimmed.
const BOARD = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'bamboohr-board.json'), 'utf8')) as Record<
  'flyio' | 'wirex',
  { list: unknown; details: Record<string, unknown> }
>;

/** A recorded board's jobs, each with its recorded detail. */
function board(name: 'flyio' | 'wirex') {
  const { list, details } = BOARD[name];
  return bambooRows(list).map((row) => toNormalized(row, bambooText(details[row.id])!, COMPANY_ID, name));
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: '42',
  jobOpeningName: 'Senior Backend Engineer',
  departmentLabel: 'Engineering',
  employmentStatusLabel: 'Full-Time',
  employmentType: null,
  location: { city: 'Salt Lake City', state: 'Utah' },
  atsLocation: { country: null, state: null, province: null, city: null },
  isRemote: null,
  locationType: '0',
  ...overrides,
});

const text = (overrides: Partial<BambooText> = {}): BambooText => ({
  body: 'Build the platform.',
  postedAt: new Date('2026-09-01T00:00:00Z'),
  pay: null,
  location: null,
  atsLocation: null,
  locationType: null,
  ...overrides,
});

describe('BambooHR — the recorded postings, whole (#658)', () => {
  it('keeps the text, the date and the pay the detail gives, and the arrangement the list gives', () => {
    const [devrel, assistant] = board('flyio');
    assert.equal(devrel?.title, 'Developer Relations Engineer');
    assert.equal(devrel?.location, 'Remote');
    assert.deepEqual(devrel?.locationHints, { workplace: 'REMOTE' });
    assert.equal(devrel?.postedAt.toISOString(), '2024-03-01T00:00:00.000Z');
    assert.match(devrel?.description ?? '', /building a new public cloud/);

    assert.equal(assistant?.title, 'Executive Assistant to the CEO');
    assert.equal(assistant?.location, 'Hybrid · chicago, Illinois, United States');
    assert.deepEqual(assistant?.locationHints, { workplace: 'HYBRID', countries: ['US'] });
    assert.equal(assistant?.postedAt.toISOString(), '2024-05-23T00:00:00.000Z');
    assert.match(assistant?.description ?? '', /^Department: G&A\. Type: US Employee\. Salary: \$134k yearly\./);
    assert.match(assistant?.description ?? '', /This role will be a good fit for you if:/);
    assert.match(assistant?.description ?? '', /solid startup Executive Assistant experience/);
  });

  it('reads where a remote posting may be worked from as the place and its country', () => {
    const [analyst] = board('wirex');
    assert.equal(analyst?.location, 'Remote · Kuala Lumpur, Malaysia');
    assert.deepEqual(analyst?.locationHints, { workplace: 'REMOTE', countries: ['MY'] });
    assert.match(analyst?.description ?? '', /Experience & Skills Required/);
    assert.match(analyst?.description ?? '', /Minimum 2 years’ experience in an AML\/CFT/);
  });
});

describe('bambooRows', () => {
  it('returns [] for an empty board or a non-conforming payload (marketing-page HTML case)', () => {
    assert.deepEqual(bambooRows({ meta: { totalCount: 0 }, result: [] }), []);
    assert.deepEqual(bambooRows('<!doctype html>'), []);
    assert.deepEqual(bambooRows(null), []);
  });

  it('skips a malformed row, keeps the valid ones', () => {
    const rows = bambooRows({ result: [{ id: 1 }, row(), null] });
    assert.deepEqual(rows.map((r) => r.id), ['42']);
  });
});

describe('bambooText', () => {
  it('is null for an answer that is not a detail', () => {
    assert.equal(bambooText({ result: [] }), null);
    assert.equal(bambooText('<!doctype html>'), null);
  });
});

describe('toNormalized (bamboohr)', () => {
  it('builds the careers URL and the head lines over the text', () => {
    const [r] = bambooRows({ result: [row()] });
    const job = toNormalized(r!, text(), COMPANY_ID, SLUG);
    assert.equal(job.externalId, '42');
    assert.equal(job.url, 'https://canopy.bamboohr.com/careers/42');
    assert.equal(job.location, 'Salt Lake City, Utah');
    assert.equal(job.description, 'Department: Engineering. Type: Full-Time.\n\nBuild the platform.');
    assert.deepEqual(job.locationHints, { workplace: 'UNKNOWN' });
  });

  it('trims the title and still reads the old isRemote flag', () => {
    const [r] = bambooRows({ result: [row({ jobOpeningName: 'Solutions Architect ', isRemote: true, locationType: null, location: null })] });
    const job = toNormalized(r!, text(), COMPANY_ID, SLUG);
    assert.equal(job.title, 'Solutions Architect');
    assert.equal(job.location, 'Remote');
  });
});
