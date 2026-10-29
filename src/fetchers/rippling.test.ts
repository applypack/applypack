import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRipplingList,
  ripplingPostings,
  ripplingText,
  toNormalized,
  type RipplingDetail,
} from './rippling';

const COMPANY_ID = 23;

// Recorded from Rippling's own board on 2026-10-29: one posting, a second
// listed once per place, and the first one's detail, the text trimmed.
const BOARD = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'rippling-board.json'), 'utf8')) as {
  list: unknown[];
  detail: RipplingDetail;
};

const listRow = (overrides: Record<string, unknown> = {}) => ({
  uuid: '2f0674e6-f01f-4ecd-b459-e947241c211f',
  name: 'Software Engineer - Platform',
  department: { id: 'Engineering', label: 'Engineering' },
  url: 'https://ats.rippling.com/rippling/jobs/2f0674e6-f01f-4ecd-b459-e947241c211f',
  workLocation: { label: 'New York, NY', id: 'New York, NY' },
  ...overrides,
});

const detail: RipplingDetail = {
  uuid: '2f0674e6-f01f-4ecd-b459-e947241c211f',
  description: {
    company: '<p>About Rippling.</p>',
    role: '<p>Build the ATS &amp; platform.</p>',
  },
  createdOn: '2023-10-31T10:40:35.194000-07:00',
  workLocations: ['New York, NY', 'Remote (US)'],
  employmentType: { label: 'SALARIED_FT', id: 'Salaried, full-time' },
};

describe('parseRipplingList', () => {
  it('parses rows and skips malformed ones', () => {
    const rows = parseRipplingList([listRow(), { uuid: 1 }, 'junk']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.uuid, '2f0674e6-f01f-4ecd-b459-e947241c211f');
  });

  it('returns [] for an empty board or a non-array payload', () => {
    assert.deepEqual(parseRipplingList([]), []);
    assert.deepEqual(parseRipplingList({ error: 'Not Found!' }), []);
    assert.deepEqual(parseRipplingList(null), []);
  });
});

describe('ripplingPostings — one posting per uuid (#658)', () => {
  it('folds the rows of a posting listed once per place, and trims the title (#662)', () => {
    const postings = ripplingPostings(parseRipplingList(BOARD.list));
    assert.deepEqual(postings.map((p) => p.uuid), ['32503612-d702-4274-bab0-127c2196f683', '1584be38-83a9-41a8-94e8-f733332ace4e']);
    assert.equal(postings[0]!.title, 'Engineering Leader - Agentic Talent Products');
    assert.deepEqual(postings[1]!.places, ['Sunnyvale, CA', 'Milpitas, CA', 'Santa Clara, CA']);
    assert.equal(postings[1]!.department, 'Sales');
  });
});

describe('toNormalized (rippling)', () => {
  it('keeps the whole recorded posting: both blocks, what it asks for, the date and the pay', () => {
    const [posting] = ripplingPostings(parseRipplingList(BOARD.list));
    const job = toNormalized(posting!, ripplingText(BOARD.detail), COMPANY_ID);
    assert.equal(job.title, 'Engineering Leader - Agentic Talent Products');
    assert.equal(job.location, 'San Francisco, CA');
    assert.equal(job.postedAt.toISOString(), '2026-08-04T16:05:14.440Z');
    assert.match(job.description, /^Department: Engineering\. Type: Salaried, full-time\. Salary: 207000-345000 USD \(year, US San Francisco Bay Area\)\./);
    assert.match(job.description, /What you will need/);
    assert.match(job.description, /Experience leading high-performing engineering teams/);
    assert.match(job.description, /Proven success building and scaling engineering organizations/);
    assert.match(job.description, /About Rippling/);
    // The role comes before the company blurb.
    assert.ok(job.description.indexOf('About the role') < job.description.indexOf('About Rippling'));
  });

  it('merges the detail into the job', () => {
    const job = toNormalized(ripplingPostings(parseRipplingList([listRow()]))[0]!, ripplingText(detail), COMPANY_ID);
    assert.equal(job.externalId, '2f0674e6-f01f-4ecd-b459-e947241c211f');
    assert.equal(job.title, 'Software Engineer - Platform');
    assert.equal(job.location, 'New York, NY / Remote (US)');
    assert.equal(job.postedAt.toISOString(), '2023-10-31T17:40:35.194Z');
    assert.match(job.description, /^Department: Engineering\./);
    assert.match(job.description, /Type: Salaried, full-time\./);
    assert.match(job.description, /Build the ATS & platform\./);
    assert.match(job.description, /About Rippling\./);
  });

  it('takes the folded places when the detail names none', () => {
    const postings = ripplingPostings(parseRipplingList(BOARD.list));
    const job = toNormalized(postings[1]!, ripplingText({ ...detail, uuid: postings[1]!.uuid, workLocations: [] }), COMPANY_ID);
    assert.equal(job.location, 'Sunnyvale, CA / Milpitas, CA / Santa Clara, CA');
  });

  it('accepts a plain-string description', () => {
    const job = toNormalized(
      ripplingPostings(parseRipplingList([listRow()]))[0]!,
      ripplingText({ ...detail, description: '<p>One block.</p>' }),
      COMPANY_ID,
    );
    assert.match(job.description, /One block\./);
  });
});
