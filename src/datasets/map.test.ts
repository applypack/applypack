import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCKED_POSTING_HOSTS } from '../jobs/blocked-hosts';
import { findRows, type Row } from './rows';
import {
  MAPPING_FIELDS,
  MappingSchema,
  columnsOf,
  detectMapping,
  emptyMapping,
  mapRow,
  mapRows,
  mappingFits,
  readDate,
  readSourceConfig,
  sampleValue,
  usableMapping,
  type Mapping,
} from './map';

const NOW = new Date('2026-10-05T12:00:00Z');

function fixture(name: string): Row[] {
  const found = findRows(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
  if (!found.ok) throw new Error(found.error);
  return found.rows;
}

/** A detected mapping without its nulls, so an expectation lists only what was found. */
function found(rows: Row[]): Partial<Mapping> {
  const { mapping } = detectMapping(rows, NOW);
  return Object.fromEntries(Object.entries(mapping).filter(([, column]) => column !== null));
}

function jobsOf(name: string) {
  const rows = fixture(name);
  return mapRows(rows, detectMapping(rows, NOW).mapping, 7, NOW);
}

const mapping = (fields: Partial<Mapping>): Mapping => ({ ...emptyMapping(), ...fields });

describe('columnsOf', () => {
  it('lists top-level keys and the plain fields one level inside an object', () => {
    const columns = columnsOf(fixture('shape-nested-pay.json'));
    assert.ok(columns.includes('location'));
    assert.ok(columns.includes('location.countryCode'));
    assert.ok(columns.includes('salary.salaryMin'));
  });

  it('never offers a column about a person', () => {
    for (const name of ['shape-flat-two-links.json', 'shape-flat-work-type.json', 'shape-nested-pay.json', 'hostile.json']) {
      const people = columnsOf(fixture(name)).filter((c) => /poster|recruiter|contact|email|phone|author/i.test(c));
      assert.deepEqual(people, [], name);
    }
  });

  it('leaves out a list of objects and does not open a map of opaque keys', () => {
    const columns = columnsOf(fixture('shape-nested-everything.json'));
    assert.ok(columns.includes('attributes'));
    assert.equal(columns.some((c) => c.startsWith('attributes.')), false);
    assert.deepEqual(columnsOf([{ title: 'a', offices: [{ city: 'x' }], tags: ['a', 'b'] }]), ['title', 'tags']);
  });

  it('reads the keys of every sampled row, in first-seen order', () => {
    assert.deepEqual(columnsOf([{ a: 1 }, { b: 2, a: 3 }]), ['a', 'b']);
  });
});

describe('detectMapping: names', () => {
  it('flat rows with a listing link and an apply link', () => {
    assert.deepEqual(found(fixture('shape-flat-two-links.json')), {
      title: 'title',
      url: 'link',
      applyUrl: 'applyUrl',
      employer: 'companyName',
      description: 'descriptionHtml',
      location: 'location',
      postedAt: 'postedAt',
      id: 'id',
      salary: 'salary',
    });
  });

  it('flat rows that name the arrangement', () => {
    assert.deepEqual(found(fixture('shape-flat-work-type.json')), {
      title: 'title',
      url: 'url',
      applyUrl: 'applyUrl',
      employer: 'companyName',
      description: 'descriptionHtml',
      location: 'location',
      postedAt: 'postedDate',
      id: 'id',
      workplace: 'workType',
      salary: 'salary',
    });
  });

  it('rows with a nested place and nested pay', () => {
    assert.deepEqual(found(fixture('shape-nested-pay.json')), {
      title: 'title',
      url: 'jobUrl',
      applyUrl: 'applyUrl',
      employer: 'companyName',
      description: 'descriptionHtml',
      location: 'location',
      postedAt: 'datePublished',
      id: 'jobKey',
      country: 'location.countryCode',
      workplace: 'isRemote',
      salary: 'salary',
      salaryMin: 'salary.salaryMin',
      salaryMax: 'salary.salaryMax',
      salaryCurrency: 'salary.salaryCurrency',
      salaryPeriod: 'salary.salaryType',
      closed: 'expired',
    });
  });

  it('rows where the employer, the text, the place and the pay are all objects', () => {
    assert.deepEqual(found(fixture('shape-nested-everything.json')), {
      title: 'title',
      url: 'url',
      employer: 'employer',
      description: 'description.html',
      location: 'location',
      postedAt: 'datePublished',
      id: 'key',
      country: 'location.countryCode',
      salary: 'baseSalary',
      salaryMin: 'baseSalary.min',
      salaryMax: 'baseSalary.max',
      salaryCurrency: 'baseSalary.currencyCode',
      salaryPeriod: 'baseSalary.unitOfWork',
      closed: 'expired',
    });
  });

  it('a spreadsheet with the user’s own headers, however they are spaced or cased', () => {
    const rows = fixture('user-columns.csv');
    const detected = detectMapping(rows, NOW);
    assert.deepEqual(found(rows), {
      title: 'Position',
      url: 'Job link',
      employer: 'Organisation',
      description: 'About the role',
      location: 'Where',
      postedAt: 'Posted',
      salary: 'Pay',
    });
    assert.deepEqual(detected.guessed, ['description']);
    assert.equal(found([{ 'JOB_TITLE': 'a', 'Company Name': 'b', 'Apply-URL': 'https://rows.example/a' }]).title, 'JOB_TITLE');
  });

  it('passes over a named column whose cells are not that field', () => {
    const rows = [
      { title: 'a', url: 'n/a', link: 'https://rows.example/a', date: 'soon', posted: '2026-10-01' },
      { title: 'b', url: '', link: 'https://rows.example/b', date: 'later', posted: '2026-10-02' },
    ];
    assert.equal(found(rows).url, 'link');
    assert.equal(found(rows).postedAt, 'posted');
  });

  it('gives one column to one field', () => {
    const columns = Object.values(found(fixture('shape-nested-pay.json')));
    assert.equal(new Set(columns).size, columns.length);
  });
});

describe('detectMapping: values', () => {
  const text = 'x'.repeat(260);
  const rows: Row[] = Array.from({ length: 6 }, (_, i) => ({
    Field1: `Role number ${i}`,
    Field2: i % 2 === 0 ? 'Fennel Works' : 'Juniper Court',
    Field3: `https://rows.example/jobs/${i}`,
    Field4: 'https://rows.example/about',
    Field5: `2026-09-${10 + i}`,
    Field6: `${text} ${i}`,
    Field7: String(i * 3),
  }));

  it('reads unnamed columns off what they hold, and says it guessed', () => {
    const detected = detectMapping(rows, NOW);
    assert.deepEqual(found(rows), { url: 'Field3', employer: 'Field2', description: 'Field6', postedAt: 'Field5' });
    assert.deepEqual(detected.guessed, ['url', 'description', 'postedAt', 'employer']);
  });

  it('never guesses the title, so such a mapping is not usable until the user picks one', () => {
    const { mapping: detected } = detectMapping(rows, NOW);
    assert.equal(detected.title, null);
    assert.equal(usableMapping(detected), false);
    assert.equal(usableMapping({ ...detected, title: 'Field1' }), true);
  });

  it('does not take a repeated short column for the employer on a handful of rows', () => {
    assert.equal(found(rows.slice(0, 3)).employer, undefined);
  });
});

describe('mapRows: the four shapes', () => {
  it('flat rows: the apply link is the job’s link, markup is stripped once, a snippet says so', () => {
    const { jobs, thin, dropped } = jobsOf('shape-flat-two-links.json');
    assert.equal(jobs.length, 3);
    assert.deepEqual(dropped, { closed: 0, 'no-title': 0, 'no-identity': 0 });
    const [first, second, third] = jobs;
    assert.equal(first!.companyId, 7);
    assert.equal(first!.externalId, '4100000001');
    assert.equal(first!.url, 'https://careers.northwind.example/apply/be-17');
    assert.equal(first!.employer, 'Northwind Labs');
    assert.equal(first!.location, 'Berlin, Germany (Remote)');
    assert.equal(first!.postedAt.toISOString(), '2026-09-28T00:00:00.000Z');
    assert.match(first!.description, /^Salary: EUR 85,000 - 105,000 a year\.\n\nNorthwind Labs builds billing tools/);
    assert.match(first!.description, /\n• Five years of backend work\n• PostgreSQL and Redis in production/);
    assert.doesNotMatch(first!.description, /<|Sample Poster/);
    assert.equal(first!.locationHints, undefined);

    assert.equal(second!.url, 'https://listings.example/jobs/view/4100000002');
    assert.equal(second!.employer, 'Harbor & Pine GmbH');
    assert.match(second!.description, /^Harbor & Pine runs a booking site/);

    assert.equal(thin, 1);
    assert.match(third!.description, /^Test the invoicing service end to end\.\n\nOnly this much came with the row/);
    // "2 days ago" is not a date: the row takes the time of the read.
    assert.equal(third!.postedAt, NOW);
  });

  it('flat rows: a numeric id, the arrangement as a hint, pay written as the row gives it', () => {
    const { jobs } = jobsOf('shape-flat-work-type.json');
    assert.deepEqual(jobs.map((j) => j.externalId), ['7200000011', '7200000012', '7200000013']);
    assert.deepEqual(jobs.map((j) => j.locationHints), [{ workplace: 'HYBRID' }, { workplace: 'ONSITE' }, { workplace: 'REMOTE' }]);
    assert.match(jobs[0]!.description, /^Salary: PLN 22,000 - 28,000 per month\.\n\nAbout the role\n\nQuiet River Systems hosts/);
    assert.match(jobs[1]!.description, /^Lantern Freight moves refrigerated goods/);
  });

  it('nested place and pay: the country as a hint and in the text, the range with its currency and period, a closed row left out', () => {
    const { jobs, dropped } = jobsOf('shape-nested-pay.json');
    assert.equal(dropped.closed, 1);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0]!.externalId, 'a1b2c3d4e5f60001');
    assert.equal(jobs[0]!.location, 'Austin, TX, United States');
    assert.deepEqual(jobs[0]!.locationHints, { countries: ['US'], workplace: 'REMOTE' });
    assert.match(jobs[0]!.description, /^Salary: 110000-135000 USD \(year\)\.\n\nCopper Kettle Software writes/);
    // `isRemote: false` says nothing about the arrangement.
    assert.deepEqual(jobs[1]!.locationHints, { countries: ['US'] });
    assert.match(jobs[1]!.description, /^Salary: 52\.5-60 USD \(hour\)\./);
    assert.equal(jobs[1]!.url, 'https://board.example/viewjob?jk=a1b2c3d4e5f60002');
  });

  it('everything nested: the employer’s name, the HTML text, an epoch date, a place built from its parts', () => {
    const { jobs, thin } = jobsOf('shape-nested-everything.json');
    assert.equal(jobs.length, 3);
    assert.equal(jobs[0]!.employer, 'Blue Heron Energy');
    assert.equal(jobs[0]!.url, 'https://board.example/rc/clk?jk=f00d000000000001');
    assert.equal(jobs[0]!.location, 'Aarhus, Denmark');
    assert.deepEqual(jobs[0]!.locationHints, { countries: ['DK'] });
    assert.equal(jobs[0]!.postedAt.getTime(), 1759132800000);
    assert.match(jobs[0]!.description, /^Salary: 620000-700000 DKK \(year\)\.\n\nBlue Heron Energy runs forty small wind farms/);
    assert.match(jobs[1]!.description, /its customers' projects/);
    assert.equal(jobs[1]!.employer, 'Maple & Thread');
    // An empty HTML field is no text; the row keeps what its mapped column holds and says it is thin.
    assert.equal(thin, 1);
    assert.match(jobs[2]!.description, /^Salary: 55000 DKK \(month\)\.\n\nNo description came with this row/);
  });

  it('the user’s spreadsheet: quoted cells, a row with no date, a row with no title', () => {
    const { jobs, dropped, thin } = jobsOf('user-columns.csv');
    assert.equal(dropped['no-title'], 1);
    assert.deepEqual(jobs.map((j) => j.title), ['Backend Developer, Payments', 'Mobile Developer', 'Office Manager']);
    assert.equal(jobs[0]!.employer, 'Fennel Works');
    assert.equal(jobs[0]!.location, 'Lisbon, Portugal');
    assert.match(jobs[0]!.description, /^Salary: EUR 60000-75000 a year\.\n\nFennel Works settles card payments/);
    assert.match(jobs[0]!.description, /"close enough" is a bug here\./);
    assert.equal(jobs[0]!.postedAt.toISOString(), '2026-09-25T00:00:00.000Z');
    assert.equal(jobs[2]!.postedAt, NOW);
    assert.equal(thin, 1);
    // No id column: the link is the identity, and the same link is the same row.
    assert.equal(jobs[0]!.externalId.length, 16);
    assert.notEqual(jobs[0]!.externalId, jobs[1]!.externalId);
  });
});

describe('mapRows: hostile rows', () => {
  const rows = fixture('hostile.json');
  const detected = detectMapping(rows, NOW).mapping;

  it('drops a title that is not text, a row of people only, and a row nothing identifies', () => {
    const { jobs, dropped } = mapRows(rows, detected, 1, NOW);
    assert.deepEqual(dropped, { closed: 0, 'no-title': 2, 'no-identity': 1 });
    assert.deepEqual(jobs.map((j) => j.externalId), ['h2', 'h3']);
  });

  it('keeps no link that is not http(s)', () => {
    const { jobs } = mapRows(rows, detected, 1, NOW);
    assert.equal(jobs[0]!.url, '');
    assert.doesNotMatch(JSON.stringify(jobs), /javascript:|data:text/);
  });

  it('takes the time of the read for a date in words', () => {
    assert.equal(mapRows(rows, detected, 1, NOW).jobs[1]!.postedAt, NOW);
  });

  it('keeps nothing of a person even when their columns sit beside a real posting', () => {
    const row = { ...rows[3]!, id: 'p1', title: 'A real title', url: 'https://rows.example/p1' };
    const mapped = mapRow(row, detectMapping([row], NOW).mapping, 1, NOW);
    assert.ok('job' in mapped);
    assert.doesNotMatch(JSON.stringify(mapped), /Only A Person|person@rows\.example|555 0101|people\/1/);
  });

  it('caps a 2 MB text, a title that runs on and an id no index should hold', () => {
    const huge = { id: 'i'.repeat(500), title: `Title ${'t'.repeat(1000)}`, url: 'https://rows.example/big', description: 'word '.repeat(400_000) };
    const mapped = mapRow(huge, detectMapping([huge], NOW).mapping, 1, NOW);
    assert.ok('job' in mapped);
    assert.equal(mapped.job.title.length, 200);
    assert.equal(mapped.job.externalId.length, 16);
    assert.ok(mapped.job.description.length <= 60_000);
    assert.ok(mapped.job.description.length > 59_000);
  });

  it('does not read a field through the prototype', () => {
    const mapped = mapRow({ title: 'a', url: 'https://rows.example/a' }, mapping({ title: 'title', url: 'url', employer: 'constructor.name', id: '__proto__' }), 1, NOW);
    assert.ok('job' in mapped);
    assert.equal(mapped.job.employer, null);
    assert.equal(mapped.job.externalId.length, 16);
  });
});

describe('mapRow: which link is the job’s', () => {
  const only = mapping({ title: 'title', url: 'url', applyUrl: 'applyUrl' });
  const link = (row: Row): string => {
    const mapped = mapRow({ title: 'a', ...row }, only, 1, NOW);
    if (!('job' in mapped)) throw new Error(mapped.dropped);
    return mapped.job.url;
  };
  const blocked = `https://www.${BLOCKED_POSTING_HOSTS[0]}/apply/1`;

  it('the apply link, when the row has one on a host of its own', () => {
    assert.equal(link({ url: 'https://rows.example/1', applyUrl: 'https://apply.example/1' }), 'https://apply.example/1');
  });

  it('the listing link, when the apply link leads back into a host that is never read', () => {
    assert.equal(link({ url: 'https://rows.example/1', applyUrl: blocked }), 'https://rows.example/1');
  });

  it('whichever exists, when only one does', () => {
    assert.equal(link({ url: 'https://rows.example/1' }), 'https://rows.example/1');
    assert.equal(link({ applyUrl: blocked }), blocked);
  });

  it('identifies the row by its listing link, tracking parameters aside', () => {
    const id = (row: Row): string => {
      const mapped = mapRow({ title: 'a', ...row }, only, 1, NOW);
      if (!('job' in mapped)) throw new Error(mapped.dropped);
      return mapped.job.externalId;
    };
    assert.equal(id({ url: 'https://rows.example/1?utm_source=x', applyUrl: 'https://apply.example/1' }), id({ url: 'https://rows.example/1' }));
  });
});

describe('mapRows: repeats', () => {
  it('keeps the first row of an id and counts the rest', () => {
    const rows = [
      { id: 1, title: 'a' },
      { id: 1, title: 'a again' },
      { id: 2, title: 'b' },
    ];
    const { jobs, repeated } = mapRows(rows, mapping({ title: 'title', id: 'id' }), 1, NOW);
    assert.deepEqual(jobs.map((j) => j.title), ['a', 'b']);
    assert.equal(repeated, 1);
  });
});

describe('mapRow: the place', () => {
  const place = mapping({ title: 'title', id: 'id', location: 'city', country: 'country', workplace: 'remote' });
  const job = (row: Row) => {
    const mapped = mapRow({ id: 1, title: 'a', ...row }, place, 1, NOW);
    if (!('job' in mapped)) throw new Error(mapped.dropped);
    return mapped.job;
  };

  it('adds a country from its own column to the text, once', () => {
    assert.equal(job({ city: 'Berlin', country: 'DE' }).location, 'Berlin, Germany');
    assert.equal(job({ city: 'Berlin, Germany', country: 'Germany' }).location, 'Berlin, Germany');
    assert.equal(job({ country: 'Poland' }).location, 'Poland');
    assert.deepEqual(job({ city: 'Berlin', country: 'DE' }).locationHints, { countries: ['DE'] });
  });

  it('leaves a country it does not know out of the hints', () => {
    assert.equal(job({ city: 'Springfield', country: 'Elsewhere' }).locationHints, undefined);
  });

  it('reads the arrangement from a yes, a word or a sentence, and nothing from a no', () => {
    assert.equal(job({ remote: 'yes' }).locationHints?.workplace, 'REMOTE');
    assert.equal(job({ remote: 'Fully remote' }).locationHints?.workplace, 'REMOTE');
    assert.equal(job({ remote: 'hybrid, two days' }).locationHints?.workplace, 'HYBRID');
    assert.equal(job({ remote: 'no' }).locationHints, undefined);
    assert.equal(job({ remote: 'Full-time' }).locationHints, undefined);
  });
});

describe('mapRow: the text', () => {
  const only = mapping({ title: 'title', id: 'id', description: 'text' });
  const text = (value: unknown): string => {
    const mapped = mapRow({ id: 1, title: 'a', text: value }, only, 1, NOW);
    if (!('job' in mapped)) throw new Error(mapped.dropped);
    return mapped.job.description;
  };
  const long = 'A plain sentence about the role that goes on. '.repeat(6).trim();

  it('leaves plain text as it is: a comparison sign is not markup', () => {
    assert.equal(text(`${long}\n\nSalary < 100k, team size > 5.`), `${long}\n\nSalary < 100k, team size > 5.`);
  });

  it('strips markup, written out or escaped, and decodes entities in plain text', () => {
    assert.equal(text(`<p>${long}</p><p>Second paragraph.</p>`), `${long}\n\nSecond paragraph.`);
    assert.equal(text(`&lt;p&gt;${long}&lt;/p&gt;&lt;p&gt;Second paragraph.&lt;/p&gt;`), `${long}\n\nSecond paragraph.`);
    assert.equal(text(`${long} R&amp;D`), `${long} R&D`);
  });
});

describe('readDate', () => {
  const iso = (value: unknown): string | null => readDate(value, NOW)?.toISOString() ?? null;

  it('reads ISO dates, month names with a year, and epochs in seconds or milliseconds', () => {
    assert.equal(iso('2026-09-28'), '2026-09-28T00:00:00.000Z');
    // A time with no zone is read as UTC, on every machine alike.
    assert.equal(iso('2026-09-28 14:30'), '2026-09-28T14:30:00.000Z');
    assert.equal(iso('2026-09-28T14:30:15'), '2026-09-28T14:30:15.000Z');
    assert.equal(iso('Sep 28, 2026'), '2026-09-28T00:00:00.000Z');
    assert.equal(iso('28 September 2026 14:30'), '2026-09-28T14:30:00.000Z');
    assert.equal(iso('2026-09-28T14:30:00+02:00'), '2026-09-28T12:30:00.000Z');
    assert.equal(iso('Mon, 28 Sep 2026 10:00:00 GMT'), '2026-09-28T10:00:00.000Z');
    assert.equal(iso(1759132800), '2025-09-29T08:00:00.000Z');
    assert.equal(iso(1759132800000), '2025-09-29T08:00:00.000Z');
    assert.equal(iso('1759132800000'), '2025-09-29T08:00:00.000Z');
  });

  it('refuses words, a month with no year, a day/month order it would have to guess, and dates out of range', () => {
    for (const value of ['2 days ago', 'yesterday', 'March 5', '05/06/2026', '5.6.2026', 'soon', '', null, 42, true, '1998-01-01', '2031-01-01', 'decade 2020', 'marching on in 2024', `2026-09-28 ${'x'.repeat(100)}`]) {
      assert.equal(iso(value), null, String(value));
    }
  });
});

describe('a stored mapping', () => {
  it('reads an empty select as "not in this source" and fills a field the form left out', () => {
    const parsed = MappingSchema.parse({ title: 'Position', url: 'Job link', employer: '', location: '   ' });
    assert.equal(parsed.title, 'Position');
    assert.equal(parsed.employer, null);
    assert.equal(parsed.location, null);
    // A key is the column's name exactly as the file writes it, blanks included.
    assert.equal(MappingSchema.parse({ title: ' Title ' }).title, ' Title ');
    assert.equal(parsed.closed, null);
    assert.deepEqual(Object.keys(parsed).sort(), [...MAPPING_FIELDS].sort());
  });

  it('comes back from the row as it was stored, and as null when it is not one', () => {
    const stored = { mapping: mapping({ title: 'title', url: 'url' }), include: 'jobs-*.json' };
    assert.deepEqual(readSourceConfig(JSON.parse(JSON.stringify(stored))), stored);
    // An imported file's source has no name filter; one stored before the filter existed reads the same.
    assert.deepEqual(readSourceConfig({ mapping: stored.mapping }), { mapping: stored.mapping, include: null });
    assert.equal(readSourceConfig(null), null);
    assert.equal(readSourceConfig({ mapping: { title: 5 } }), null);
    assert.equal(readSourceConfig('mapping'), null);
  });

  it('fits a file only when every column it names is there, a person’s column never is', () => {
    const columns = columnsOf([{ title: 'a', url: 'https://rows.example/a', recruiterName: 'x' }]);
    assert.equal(mappingFits(mapping({ title: 'title', url: 'url' }), columns), true);
    assert.equal(mappingFits(mapping({ title: 'title', url: 'url', employer: 'company' }), columns), false);
    assert.equal(mappingFits(mapping({ title: 'title', url: 'url', employer: 'recruiterName' }), columns), false);
    assert.equal(mappingFits(mapping({ title: 'title' }), columns), false);
  });
});

describe('columns about people, beyond the obvious names', () => {
  it('leaves out who made, owns or is named in a row, and how to reach them', () => {
    const row = Object.fromEntries(
      ['title', 'url', 'owner', 'created_by', 'submittedBy', 'Full Name', 'First name', 'profileUrl', 'picture', 'image', 'Tel', 'Telefon', 'Mobile', 'mobile number', 'Hiring Manager', 'gender', 'date of birth'].map((name) => [name, 'x']),
    );
    assert.deepEqual(columnsOf([row]), ['title', 'url']);
  });

  it('keeps the columns of a job that only sound close', () => {
    const row = Object.fromEntries(['Position', 'postedAt', 'Job Profile', 'description', 'telework', 'employer', 'Experience'].map((name) => [name, 'x']));
    assert.deepEqual(columnsOf([row]), Object.keys(row));
  });

  it('leaves out a column that holds e-mail addresses or phone numbers, whatever it is called', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      Field1: `Role ${i}`,
      Field2: `person${i}@rows.example`,
      Field3: `+380 67 123 45 6${i}`,
      Field4: `720000001${i}`,
      Field5: `2026-09-1${i}`,
    }));
    assert.deepEqual(columnsOf(rows), ['Field1', 'Field4', 'Field5']);
    assert.doesNotMatch(JSON.stringify(detectMapping(rows, NOW).mapping), /Field2|Field3/);
  });
});

describe('mapRow: text a database can hold', () => {
  const only = mapping({ title: 'title', id: 'id', employer: 'company', location: 'place', description: 'text' });
  const job = (row: Row) => {
    const mapped = mapRow(row, only, 1, NOW);
    if (!('job' in mapped)) throw new Error(mapped.dropped);
    return mapped.job;
  };

  it('drops a NUL and other control characters wherever a row carries them', () => {
    const got = job({ id: 'a\u0000b', title: 'Dev\u0000eloper\u0007', company: 'Ac\u0000me', place: 'Ber\u0000lin', text: `line one\u0000\n\tline two ${'x'.repeat(200)}` });
    assert.equal(got.externalId, 'ab');
    assert.equal(got.title, 'Developer');
    assert.equal(got.employer, 'Acme');
    assert.equal(got.location, 'Berlin');
    assert.match(got.description, /^line one\n\tline two x/);
    assert.doesNotMatch(JSON.stringify(got), /\\u0000|\\u0007/);
  });

  it('drops a NUL written as an entity, in markup and in plain text', () => {
    assert.doesNotMatch(job({ id: 1, title: 'a', text: `<p>one&#0;two</p>${'<p>x</p>'.repeat(60)}` }).description, /\u0000/);
    assert.doesNotMatch(job({ id: 1, title: 'a', text: `one&#x0;two ${'x'.repeat(250)}` }).description, /\u0000/);
  });

  it('keeps no half of a character: a lone surrogate goes, and a cap does not cut a pair in two', () => {
    assert.equal(job({ id: 1, title: 'Dev \uD83D oper' }).title, 'Dev oper');
    const capped = job({ id: 1, title: `${'t'.repeat(199)}\u{1F600} and more` }).title;
    assert.equal(capped, 't'.repeat(199));
    assert.equal(job({ id: 1, title: `${'t'.repeat(198)}\u{1F600} and more` }).title, `${'t'.repeat(198)}\u{1F600}`);
  });
});

describe('mapRow: pay as numbers', () => {
  const pay = mapping({ title: 'title', id: 'id', salaryMin: 'min', salaryMax: 'max', salaryCurrency: 'cur', salaryPeriod: 'per' });
  const line = (row: Row): string => {
    const mapped = mapRow({ id: 1, title: 'a', ...row }, pay, 1, NOW);
    if (!('job' in mapped)) throw new Error(mapped.dropped);
    return mapped.job.description.split('\n')[0]!;
  };

  it('reads amounts the way they are written on both sides of the decimal comma', () => {
    assert.equal(line({ min: '65.000', max: '80.000', cur: 'eur', per: 'Jahr / year' }), 'Salary: 65000-80000 EUR (year).');
    assert.equal(line({ min: '65,000', max: '80,000' }), 'Salary: 65000-80000.');
    assert.equal(line({ min: '90 000,00', max: '1.234.567,89' }), 'Salary: 90000-1234567.89.');
    assert.equal(line({ min: '4500,50', max: '4500.75' }), 'Salary: 4500.5-4500.75.');
    assert.equal(line({ min: "120'000" }), 'Salary: 120000.');
    assert.equal(line({ min: '52.5', max: '60', per: 'hourly' }), 'Salary: 52.5-60 (hour).');
  });

  it('takes a number as the number it is, and nothing from a cell that is not one', () => {
    assert.equal(line({ min: 65.125, max: 80000 }), 'Salary: 65.13-80000.');
    assert.equal(line({ min: '$50k', max: 'DOE' }), 'No description came with this row — the full posting is behind the link.');
    assert.equal(line({ min: 0, max: '-5' }), 'No description came with this row — the full posting is behind the link.');
  });
});

describe('mapRow: a link is measured as it is stored', () => {
  it('drops a link that grows past the cap once it is written out', () => {
    const only = mapping({ title: 'title', id: 'id', url: 'url' });
    const mapped = mapRow({ id: 1, title: 'a', url: `https://rows.example/${'ї'.repeat(1900)}` }, only, 1, NOW);
    assert.ok('job' in mapped);
    assert.equal(mapped.job.url, '');
  });
});

describe('sampleValue', () => {
  it('shows the first value a column holds, on one line and short', () => {
    const rows = [{ a: '' }, { a: '  first\nvalue  ', b: { city: 'x', contactEmail: 'y' }, c: 'z'.repeat(200) }];
    assert.equal(sampleValue(rows, 'a'), 'first value');
    assert.equal(sampleValue(rows, 'b'), '{ city }');
    assert.equal(sampleValue(rows, 'c').length, 90);
    assert.equal(sampleValue(rows, 'missing'), '');
  });
});
