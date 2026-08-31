import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRipplingList,
  toNormalized,
  type RipplingDetail,
} from './rippling';

const COMPANY_ID = 23;

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

describe('toNormalized (rippling)', () => {
  it('merges the detail into the job', () => {
    const job = toNormalized(
      parseRipplingList([listRow()])[0]!,
      detail,
      COMPANY_ID,
    );
    assert.equal(job.externalId, '2f0674e6-f01f-4ecd-b459-e947241c211f');
    assert.equal(job.title, 'Software Engineer - Platform');
    assert.equal(job.location, 'New York, NY / Remote (US)');
    assert.equal(
      job.postedAt.toISOString(),
      '2023-10-31T17:40:35.194Z',
    );
    assert.match(job.description, /^Department: Engineering\./);
    assert.match(job.description, /Type: Salaried, full-time\./);
    assert.match(job.description, /Build the ATS & platform\./);
    assert.match(job.description, /About Rippling\./);
  });

  it('falls back to list-only data past the detail cap', () => {
    const before = Date.now();
    const job = toNormalized(
      parseRipplingList([listRow()])[0]!,
      null,
      COMPANY_ID,
    );
    assert.equal(job.location, 'New York, NY');
    assert.equal(job.description, 'Department: Engineering.');
    assert.ok(job.postedAt.getTime() >= before - 1000);
  });

  it('accepts a plain-string description', () => {
    const job = toNormalized(
      parseRipplingList([listRow()])[0]!,
      { ...detail, description: '<p>One block.</p>' },
      COMPANY_ID,
    );
    assert.match(job.description, /One block\./);
  });
});
