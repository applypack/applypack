import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationsCsv, applicationsMarkdown, dayIn, type ApplicationExportRow } from './applications-export';

const row = (over: Partial<ApplicationExportRow> = {}): ApplicationExportRow => ({
  stageKey: 'interview',
  stage: 'Interview',
  company: 'Acme',
  source: '',
  title: 'Senior Backend Engineer',
  appliedAt: new Date('2026-09-01T22:30:00Z'),
  stageSince: new Date('2026-09-10T08:00:00Z'),
  fitScore: 87,
  resume: 'Senior Backend v3',
  recruiterContact: 'jane@acme.example',
  notes: 'First call went well.\nSend the portfolio.',
  url: 'https://jobs.acme.example/1',
  ...over,
});

test('a date is the day it fell on in the reader\'s time zone', () => {
  const late = new Date('2026-09-01T22:30:00Z');
  assert.equal(dayIn(late, 'UTC'), '2026-09-01');
  assert.equal(dayIn(late, 'Europe/Kyiv'), '2026-09-02');
  assert.equal(dayIn(null, 'UTC'), '');
});

test('the CSV has one line per application and keeps the notes in their cell', () => {
  const csv = applicationsCsv([row(), row({ title: '=cmd|calc', fitScore: null, notes: null })], 'UTC');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'Stage,Company,Source,Title,Applied on,In this stage since,Fit,Applied with,Recruiter contact,Notes,Posting');
  assert.equal(
    lines[1],
    'Interview,Acme,,Senior Backend Engineer,2026-09-01,2026-09-10,87,Senior Backend v3,jane@acme.example,"First call went well.\nSend the portfolio.",https://jobs.acme.example/1',
  );
  assert.ok(lines[2]?.includes(",'=cmd|calc,"), 'a title that opens like a formula is text');
});

test('the Markdown walks the columns in board order and skips the empty ones', () => {
  const md = applicationsMarkdown(
    [row(), row({ stageKey: 'applied', stage: 'Applied', title: 'C++ *Lead*', recruiterContact: null, notes: null, url: 'javascript:alert(1)' })],
    [
      { key: 'applied', label: 'Applied' },
      { key: 'screen', label: 'Screen' },
      { key: 'interview', label: 'Interview' },
    ],
    'UTC',
    new Date('2026-09-28T12:00:00Z'),
  );
  assert.equal(
    md,
    [
      '# Applications — 2026-09-28',
      '',
      '2 applications.',
      '',
      '## Applied (1)',
      '',
      // Markdown in a title is text, and a link that is not http(s) is left out.
      '- **C++ \\*Lead\\*** — Acme · applied 2026-09-01 · here since 2026-09-10 · fit 87 · with Senior Backend v3',
      '',
      '## Interview (1)',
      '',
      '- **Senior Backend Engineer** — Acme · applied 2026-09-01 · here since 2026-09-10 · fit 87 · with Senior Backend v3 · [posting](<https://jobs.acme.example/1>)',
      '  - Recruiter: jane@acme.example',
      '  - Notes: First call went well.',
      '    Send the portfolio.',
      '',
    ].join('\n'),
  );
});

test('who hires and where the row came from are two columns, never one (#444)', () => {
  // An aggregator's row that names its employer, one that names nobody, and an employer's own board.
  const rows = [
    row({ company: 'Fennel Works', source: 'RemoteOK Feed', title: 'Backend Engineer' }),
    row({ company: '', source: 'September export', title: 'Platform Engineer' }),
    row({ company: 'Acme', source: '', title: 'Data Engineer' }),
  ];
  const lines = applicationsCsv(rows, 'UTC').replace(/^\uFEFF/, '').split('\r\n');
  assert.match(lines[1]!, /^Interview,Fennel Works,RemoteOK Feed,Backend Engineer,/);
  // No company named: the Company cell is empty, and a filter on it no longer finds a source's name.
  assert.match(lines[2]!, /^Interview,,September export,Platform Engineer,/);
  assert.match(lines[3]!, /^Interview,Acme,,Data Engineer,/);

  const md = applicationsMarkdown(rows, [{ key: 'interview', label: 'Interview' }], 'UTC', new Date('2026-10-12T00:00:00Z'));
  assert.match(md, /\*\*Backend Engineer\*\* — Fennel Works · via RemoteOK Feed · applied/);
  assert.match(md, /\*\*Platform Engineer\*\* — via September export · applied/);
  assert.match(md, /\*\*Data Engineer\*\* — Acme · applied/);
});
