import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CLOCK_SLACK_MS,
  FILE_NOTES,
  MAX_FILES_PER_LOOK,
  MAX_FILE_BYTES,
  MAX_ROW_BYTES_PER_LOOK,
  MAX_ROW_FILES_PER_LOOK,
  OPEN_ROW_SETTLE_MS,
  SETTLE_MS,
  UNJUDGED,
  guessHolds,
  includeMatcher,
  judgedAgain,
  kindsFor,
  maxBytesOf,
  pageResources,
  postingFileKind,
  tooLargeNote,
  judgeFile,
  newestIsMisfit,
  planScan,
  rowFileKind,
  rulesKey,
  unreachedChanges,
  unreadChange,
  type FileRead,
  type LedgerEntry,
  type ListedFile,
} from './folder-scan';
import { emptyMapping, type Mapping } from './map';

const NOW = Date.UTC(2026, 9, 5, 12);
const MINUTE = 60_000;
const file = (relPath: string, ageMs = 10 * MINUTE, size = 1_000): ListedFile => ({ relPath, size, mtimeMs: NOW - ageMs });
const seen = (f: ListedFile, status: LedgerEntry['status'] = 'done'): LedgerEntry => ({ ...f, sha256: 'a'.repeat(64), status, rowsRead: 0, jobCount: 0, ...UNJUDGED });
const names = (files: readonly ListedFile[]): string[] => files.map((f) => f.relPath);

describe('rowFileKind', () => {
  it('knows a file of rows by its extension, whatever its case and its folder', () => {
    assert.equal(rowFileKind('jobs.json'), 'json');
    assert.equal(rowFileKind('2026/10/run.JSONL'), 'jsonl');
    assert.equal(rowFileKind('run.ndjson'), 'jsonl');
    assert.equal(rowFileKind('Export Final.CSV'), 'csv');
    assert.equal(rowFileKind('a.b.tsv'), 'tsv');
  });

  it('answers null for everything else', () => {
    for (const name of ['posting.html', 'resume.pdf', 'notes.txt', 'json', '.json', 'folder.json/readme', 'archive.json.zip', '']) {
      assert.equal(rowFileKind(name), null, name);
    }
  });
});

describe('includeMatcher', () => {
  it('takes every file when there is no pattern', () => {
    assert.equal(includeMatcher(null)('anything.json'), true);
    assert.equal(includeMatcher('  ')('anything.json'), true);
  });

  it('matches the file name, not its folder, with * and ?', () => {
    const jobs = includeMatcher('jobs-*.json');
    assert.equal(jobs('jobs-2026-10-05.json'), true);
    assert.equal(jobs('2026/JOBS-1.JSON'), true);
    assert.equal(jobs('other-jobs-1.json'), false);
    assert.equal(jobs('jobs-1.csv'), false);
    assert.equal(includeMatcher('run-?.csv')('run-7.csv'), true);
    assert.equal(includeMatcher('run-?.csv')('run-17.csv'), false);
  });

  it('takes several patterns and reads their punctuation literally', () => {
    const either = includeMatcher('jobs-*.json, export (final).csv');
    assert.equal(either('export (final).csv'), true);
    assert.equal(either('export final.csv'), false);
    assert.equal(includeMatcher('a.json')('axjson'), false);
    assert.equal(includeMatcher('[a-z]+.json')('abc.json'), false);
  });

  it('matches a run of stars, a star at either end, and a pattern longer than the name', () => {
    assert.equal(includeMatcher('**.json')('a.json'), true);
    assert.equal(includeMatcher('*')('anything.csv'), true);
    assert.equal(includeMatcher('*-final.csv')('run-final.csv'), true);
    assert.equal(includeMatcher('jobs*')('jobs.json'), true);
    assert.equal(includeMatcher('jobs-*-x.json')('jobs-.json'), false);
    assert.equal(includeMatcher('a*b*c.json')('a-b-b-c.json'), true);
  });

  it('stays quick on a pattern built to make a regular expression backtrack', () => {
    const hostile = includeMatcher(`${'*a'.repeat(30)}*b`);
    const started = performance.now();
    assert.equal(hostile(`${'a'.repeat(5_000)}.json`), false);
    assert.ok(performance.now() - started < 1_000);
  });
});

describe('planScan', () => {
  it('reads a row file the ledger has never seen, oldest change first', () => {
    const plan = planScan([file('b.json', 5 * MINUTE), file('a.csv', 20 * MINUTE), file('c.jsonl', 10 * MINUTE)], [], NOW);
    assert.deepEqual(names(plan.read), ['a.csv', 'c.jsonl', 'b.json']);
    assert.equal(plan.unchanged, 0);
  });

  it('leaves a file the ledger settled alone, and reads it again once it changed', () => {
    const settled = file('a.json');
    assert.deepEqual(planScan([settled], [seen(settled)], NOW), { read: [], rejudged: new Set(), waiting: [], later: [], tooLarge: [], unchanged: 1, other: 0 });
    assert.deepEqual(names(planScan([{ ...settled, size: 1_001 }], [seen(settled)], NOW).read), ['a.json']);
    assert.deepEqual(names(planScan([{ ...settled, mtimeMs: settled.mtimeMs + 60_000 }], [seen(settled)], NOW).read), ['a.json']);
    // "Not rows" is settled too: the same bytes will not become rows by being read again.
    assert.equal(planScan([settled], [seen(settled, 'skipped')], NOW).unchanged, 1);
  });

  it('looks again at a file that waited or that the system would not open, though nothing about it changed', () => {
    const f = file('a.json');
    assert.deepEqual(names(planScan([f], [seen(f, 'waiting')], NOW).read), ['a.json']);
    assert.deepEqual(names(planScan([f], [{ ...seen(f, 'failed'), sha256: null }], NOW).read), ['a.json']);
  });

  it('does not read a file that misfit the mapping again until it changes: the same bytes give the same answer', () => {
    const f = file('a.json');
    assert.equal(planScan([f], [seen(f, 'failed')], NOW).unchanged, 1);
    assert.deepEqual(names(planScan([{ ...f, size: f.size + 1 }], [seen(f, 'failed')], NOW).read), ['a.json']);
  });

  it('makes a file changed seconds ago wait', () => {
    const plan = planScan([file('fresh.json', SETTLE_MS - 1), file('settled.json', SETTLE_MS)], [], NOW);
    assert.deepEqual(names(plan.waiting), ['fresh.json']);
    assert.deepEqual(names(plan.read), ['settled.json']);
  });

  it('never reads a file larger than a file of rows may be', () => {
    const big = file('big.json', 10 * MINUTE, MAX_FILE_BYTES + 1);
    const plan = planScan([big, file('edge.json', 10 * MINUTE, MAX_FILE_BYTES)], [], NOW);
    assert.deepEqual(names(plan.tooLarge), ['big.json']);
    assert.deepEqual(names(plan.read), ['edge.json']);
    // Said once: the ledger then answers for it until it changes.
    assert.equal(planScan([big], [seen(big, 'skipped')], NOW).unchanged, 1);
  });

  it('counts what is not a row file and what the name filter leaves out, and plans neither', () => {
    const plan = planScan([file('a.json'), file('posting.html'), file('notes.txt'), file('other.json')], [], NOW, includeMatcher('a*.json'));
    assert.deepEqual(names(plan.read), ['a.json']);
    assert.equal(plan.other, 3);
  });

  // Oldest first, as the plan orders them: run-000 is the oldest.
  const runs = (n: number, ext: string, size = 1_000): ListedFile[] =>
    Array.from({ length: n }, (_, i) => file(`run-${String(i).padStart(3, '0')}.${ext}`, (10_000 - i) * MINUTE, size));

  it('reads a bounded number of saved postings a look and leaves the rest for the next', () => {
    // A posting can be a model call: twenty a look is its spending limit, and stays (#432).
    const plan = planScan(runs(MAX_FILES_PER_LOOK + 3, 'html'), [], NOW, undefined, 'postings');
    assert.equal(plan.read.length, MAX_FILES_PER_LOOK);
    assert.deepEqual(names(plan.later), ['run-020.html', 'run-021.html', 'run-022.html']);
    assert.equal(plan.read[0]!.relPath, 'run-000.html');
  });

  it('reads files of rows by what they cost: twenty-five small ones in one look, a few hundred at most (#432)', () => {
    // The live case: 25 one-row files took two looks, and a 1,000-file run two days.
    assert.equal(planScan(runs(25, 'json'), [], NOW).read.length, 25);
    const plan = planScan(runs(MAX_ROW_FILES_PER_LOOK + 3, 'json'), [], NOW);
    assert.equal(plan.read.length, MAX_ROW_FILES_PER_LOOK);
    assert.deepEqual(names(plan.later), ['run-400.json', 'run-401.json', 'run-402.json']);
  });

  it('stops a look of rows at its bytes, in order: nothing is read out of turn', () => {
    const big = Math.floor(MAX_ROW_BYTES_PER_LOOK / 5);
    // Five files of that size fill a look; the small one after them waits its turn behind the sixth.
    const files = [...runs(6, 'csv', big), file('small.csv', MINUTE, 10)];
    const plan = planScan(files, [], NOW);
    assert.equal(plan.read.length, 5);
    assert.deepEqual(names(plan.later), ['run-005.csv', 'small.csv']);
    // One file larger than what is left never blocks a look that has read nothing.
    assert.equal(planScan([file('one.csv', 10 * MINUTE, big)], [], NOW).read.length, 1);
  });

  it('reads new and changed files before the ones it looks at again, so a heap of those cannot starve them', () => {
    const retried = Array.from({ length: MAX_ROW_FILES_PER_LOOK }, (_, i) => file(`stuck-${String(i).padStart(3, '0')}.json`, (5_000 - i) * MINUTE));
    const fresh = file('new.json', MINUTE);
    const plan = planScan([...retried, fresh], retried.map((f) => seen(f, 'waiting')), NOW);
    assert.equal(plan.read[0]!.relPath, 'new.json');
    assert.equal(plan.read.length, MAX_ROW_FILES_PER_LOOK);
    assert.deepEqual(names(plan.later), ['stuck-399.json']);
  });

  it('notes a file a look did not reach as waiting, once, and only one the ledger has never heard of', () => {
    const [a, b, c] = runs(3, 'json');
    const changes = unreachedChanges([a!, b!, c!], [seen(b!, 'failed')]);
    // b keeps the row that says why it could not be opened.
    assert.deepEqual(changes.map((ch) => ch.relPath), ['run-000.json', 'run-002.json']);
    assert.deepEqual(changes[0], { ...a!, kind: 'json', sha256: null, status: 'waiting', detail: 'Not reached yet: a check reads only so much at a time. The next check reads it.', jobCount: 0, rowsRead: 0, ...UNJUDGED });
    // Noted, it is in the ledger: the next look that still does not reach it writes nothing.
    assert.deepEqual(unreachedChanges([a!], [{ ...changes[0]!, sha256: null }]), []);
    assert.equal(unreachedChanges([file('page.html')], [], 'postings')[0]?.kind, 'html');
  });

  it('reads a file dated far in the future instead of waiting for it forever', () => {
    assert.deepEqual(names(planScan([file('ahead.json', -10 * MINUTE)], [], NOW).read), ['ahead.json']);
    assert.deepEqual(names(planScan([file('edge.json', -CLOCK_SLACK_MS)], [], NOW).read), ['edge.json']);
  });

  // #396: against a walk's clock, a file written minutes into the walk was dated ahead and read half-written.
  it('lets a file dated a little ahead of the clock wait, like one just written', () => {
    const plan = planScan([file('ahead.json', -3 * MINUTE), file('skew.json', -1_000), file('old.json')], [], NOW);
    assert.deepEqual(names(plan.waiting), ['ahead.json', 'skew.json']);
    assert.deepEqual(names(plan.read), ['old.json']);
    // Once the clock has passed it by the settle time, it is read.
    assert.deepEqual(names(planScan([file('ahead.json', -3 * MINUTE)], [], NOW + 3 * MINUTE + SETTLE_MS).read), ['ahead.json']);
  });

  it('is not troubled by a file that disappeared: the ledger keeps its row and the plan says nothing', () => {
    const gone = file('gone.json');
    assert.deepEqual(planScan([], [seen(gone)], NOW), { read: [], rejudged: new Set(), waiting: [], later: [], tooLarge: [], unchanged: 0, other: 0 });
  });
});

describe('rulesKey (#448)', () => {
  const search = { stackRequired: ['backend'], roleTypes: ['engineer'], stackExclude: ['intern'], countries: ['PL'], regions: [], workplace: ['REMOTE' as const], onsiteCities: [] };
  const other = { ...search, stackRequired: ['data'], countries: ['DE'] };
  const key = rulesKey([search, other], ['acme', 'globex'], 90);

  it('is the same for the same rules, whatever their order, case or company', () => {
    assert.equal(rulesKey([other, search], ['globex', 'acme'], 90), key);
    assert.equal(rulesKey([{ ...search, stackRequired: [' Backend '] }, other], ['acme', 'globex'], 90), key);
    // Two searches with the same filter turn away what one does.
    assert.equal(rulesKey([search, search], [], null), rulesKey([search], [], null));
    // A search's notes or thresholds are not what its filter reads.
    assert.equal(rulesKey([{ ...search, notes: 'x', minFitScore: 90 } as typeof search, other], ['acme', 'globex'], 90), key);
  });

  it('moves with a filter field, a mute, an unmute or the re-apply window', () => {
    assert.notEqual(rulesKey([{ ...search, stackRequired: ['backend', 'go'] }, other], ['acme', 'globex'], 90), key);
    assert.notEqual(rulesKey([search], ['acme', 'globex'], 90), key);
    assert.notEqual(rulesKey([search, other], ['acme'], 90), key);
    assert.notEqual(rulesKey([search, other], ['acme', 'globex', 'initech'], 90), key);
    assert.notEqual(rulesKey([search, other], ['acme', 'globex'], null), key);
    assert.notEqual(rulesKey([search, other], ['acme', 'globex'], 30), key);
  });
});

describe('judgedAgain and planScan with the rules (#448)', () => {
  const RULES = 'k2';
  const read = (f: ListedFile, judged: Partial<LedgerEntry>): LedgerEntry => ({ ...seen(f), rulesKey: 'k1', ...judged });

  it('reads a file again when rows were turned away under other rules', () => {
    const f = file('a.json');
    assert.equal(judgedAgain(read(f, { turnedAway: 2 }), RULES, NOW), true);
    assert.equal(judgedAgain(read(f, { windowTurnedAway: 1, windowEndsAt: NOW + MINUTE }), RULES, NOW), true);
    // Read before rows were counted: some may have been.
    assert.equal(judgedAgain(read(f, { turnedAway: null }), RULES, NOW), true);
  });

  it('leaves it alone when nothing was turned away, the rules are the same, or it carries no key yet', () => {
    const f = file('a.json');
    assert.equal(judgedAgain(read(f, { turnedAway: 0 }), RULES, NOW), false);
    assert.equal(judgedAgain(read(f, { turnedAway: 2, rulesKey: RULES }), RULES, NOW), false);
    // Read before keys existed: the upgrade stamps it, and reads nothing again.
    assert.equal(judgedAgain(read(f, { turnedAway: null, rulesKey: null }), RULES, NOW), false);
    // A file that waits is read on anyway; one set aside or misfit has no rows that were judged.
    assert.equal(judgedAgain({ ...read(f, { turnedAway: 2 }), status: 'waiting' }, RULES, NOW), false);
    assert.equal(judgedAgain({ ...read(f, { turnedAway: 2 }), status: 'failed' }, RULES, NOW), false);
  });

  it('reads it again once a re-apply window that turned rows away has closed, under the same rules', () => {
    const f = file('a.json');
    const waited = read(f, { rulesKey: RULES, windowTurnedAway: 1, windowEndsAt: NOW + MINUTE });
    assert.equal(judgedAgain(waited, RULES, NOW), false);
    assert.equal(judgedAgain(waited, RULES, NOW + 2 * MINUTE), true);
  });

  it('plans such a file behind new and retried ones, from its first row, within the look’s ceilings', () => {
    const [old, again, fresh] = [file('old.json', 60 * MINUTE), file('again.json', 30 * MINUTE), file('fresh.json', 20 * MINUTE)];
    const plan = planScan([old!, again!, fresh!], [read(old!, { turnedAway: 3 }), seen(again!, 'waiting')], NOW, undefined, 'rows', RULES);
    assert.deepEqual(names(plan.read), ['fresh.json', 'again.json', 'old.json']);
    assert.deepEqual([...plan.rejudged], ['old.json']);
    assert.equal(plan.unchanged, 0);
    // Without the rules — the Check page — the same file is unchanged.
    assert.equal(planScan([old!], [read(old!, { turnedAway: 3 })], NOW).unchanged, 1);
    // Past the ceiling it waits in `later` like any file, and is not marked to be read whole.
    const many = Array.from({ length: MAX_ROW_FILES_PER_LOOK + 1 }, (_, i) => file(`run-${String(i).padStart(3, '0')}.json`, (1_000 - i) * MINUTE));
    const full = planScan(many, many.map((f) => read(f, { turnedAway: 1 })), NOW, undefined, 'rows', RULES);
    assert.equal(full.read.length, MAX_ROW_FILES_PER_LOOK);
    assert.equal(full.later.length, 1);
    assert.equal(full.rejudged.size, MAX_ROW_FILES_PER_LOOK);
    assert.equal(full.rejudged.has(full.later[0]!.relPath), false);
  });
});

describe('judgeFile', () => {
  const mapping: Mapping = { ...emptyMapping(), title: 'title', url: 'url', employer: 'company', postedAt: 'posted' };
  const listed = file('run-1.json');
  const bytesOf = (value: unknown): FileRead => {
    const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    return { ok: true, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mtimeMs: listed.mtimeMs };
  };
  const rows = [
    { title: 'Backend Developer', url: 'https://rows.example/1', company: 'Fennel Works', posted: '2026-09-25' },
    { title: 'Mobile Developer', url: 'https://rows.example/2', company: 'Fennel Works' },
  ];
  const judge = (got: FileRead, readAs: ReadonlyMap<string, string> = new Map()) => judgeFile(listed, got, mapping, 9, readAs, undefined, undefined, NOW);

  it('hands over the rows of a file that fits, and records it as read with its hash', () => {
    const got = bytesOf(rows);
    const verdict = judge(got);
    assert.equal(verdict.rows, 'fit');
    assert.deepEqual(verdict.jobs.map((j) => [j.companyId, j.title, j.employer]), [
      [9, 'Backend Developer', 'Fennel Works'],
      [9, 'Mobile Developer', 'Fennel Works'],
    ]);
    assert.deepEqual(verdict.change, {
      relPath: 'run-1.json',
      kind: 'json',
      status: 'done',
      detail: null,
      jobCount: 2,
      rowsRead: 2,
      size: got.ok ? got.size : 0,
      mtimeMs: listed.mtimeMs,
      sha256: got.ok ? got.sha256 : '',
      ...UNJUDGED,
    });
    assert.equal(verdict.taken, 2);
  });

  it('gives a row that names no date the file’s own time', () => {
    const [dated, undated] = judge(bytesOf(rows)).jobs;
    assert.equal(dated!.postedAt.toISOString(), '2026-09-25T00:00:00.000Z');
    assert.equal(undated!.postedAt.getTime(), listed.mtimeMs);
  });

  it('skips a copy or a rename of a file already read, and names the one it repeats', () => {
    const got = bytesOf(rows);
    const verdict = judge(got, new Map([[got.ok ? got.sha256 : '', 'older/run-0.json']]));
    assert.equal(verdict.change?.status, 'skipped');
    assert.match(verdict.change?.detail ?? '', /same content as older\/run-0\.json/);
    assert.deepEqual(verdict.jobs, []);
    // The same file read again (touched, or retried) is not its own copy.
    assert.equal(judge(got, new Map([[got.ok ? got.sha256 : '', 'run-1.json']])).rows, 'fit');
  });

  it('sets aside a file with no rows in it, and says so', () => {
    const verdict = judge(bytesOf('just some notes\nabout nothing'));
    assert.deepEqual([verdict.change?.status, verdict.change?.detail, verdict.rows], ['skipped', FILE_NOTES.notRows, 'none']);
    assert.notEqual(verdict.change?.sha256, null);
  });

  it('hands over nothing from a file whose columns stopped fitting the mapping', () => {
    const renamed = [{ position: 'Backend Developer', link: 'https://rows.example/1' }, { position: 'Mobile Developer', link: 'https://rows.example/2' }, { title: 'QA', url: 'https://rows.example/3' }];
    const verdict = judge(bytesOf(renamed));
    assert.equal(verdict.rows, 'misfit');
    assert.equal(verdict.change?.status, 'failed');
    assert.match(verdict.change?.detail ?? '', /1 of 3 rows read as a job/);
    assert.deepEqual(verdict.jobs, []);
  });

  it('does not count closed rows or repeats against the mapping', () => {
    const withClosed = judgeFile(listed, bytesOf([{ ...rows[0], closed: true }, { ...rows[1], closed: true }, { title: 'QA', url: 'https://rows.example/3' }]), { ...mapping, closed: 'closed' }, 9, new Map());
    assert.equal(withClosed.rows, 'fit');
    assert.equal(withClosed.change?.jobCount, 1);
  });

  describe('a file that holds one JSON object (#395)', () => {
    const one = (value: unknown) => judge(bytesOf(value));

    it('reads a posting saved as JSON, its list of places inside, as one job', () => {
      const posting = { title: 'Backend Developer', url: 'https://rows.example/1', company: 'Fennel Works', jobLocation: [{ '@type': 'Place', address: { addressLocality: 'Lisbon' } }, { '@type': 'Place', address: { addressLocality: 'Porto' } }] };
      const verdict = one(posting);
      assert.deepEqual([verdict.rows, verdict.jobs.map((j) => j.title), verdict.change?.status, verdict.change?.jobCount], ['fit', ['Backend Developer'], 'done', 1]);
    });

    it('sets aside a stats file instead of calling it a misfit', () => {
      const verdict = one({ startedAt: '2026-10-06T10:00:00Z', finishedAt: '2026-10-06T10:02:11Z', pages: 14, rowsWritten: 2, errors: 0 });
      assert.deepEqual([verdict.rows, verdict.change?.status, verdict.change?.detail], ['none', 'skipped', FILE_NOTES.notAPosting]);
      // Settled with its hash like any file set aside: read again only when it changes.
      assert.notEqual(verdict.change?.sha256, null);
    });

    it('still calls one posting under other column names a misfit: the tool changed what it writes', () => {
      const verdict = one({ position: 'Backend Developer', link: 'https://rows.example/1', organisation: 'Fennel Works' });
      assert.deepEqual([verdict.rows, verdict.change?.status], ['misfit', 'failed']);
    });

    it('and a list of things that are no postings is a misfit as before, not one object', () => {
      assert.equal(one([{ startedAt: 'x' }, { startedAt: 'y' }]).rows, 'misfit');
    });

    it('does not let a stats file newer than the rows fail the look that reads nothing', () => {
      const data = file('run-1.json', 30 * MINUTE);
      const stats = file('stats.json', 20 * MINUTE);
      const ledger: LedgerEntry[] = [seen(data), { ...seen(stats, 'skipped') }];
      assert.equal(newestIsMisfit([data, stats], ledger, () => true), false);
      // What it was before: the stats file judged a misfit, and newer than the data.
      assert.equal(newestIsMisfit([data, stats], [seen(data), seen(stats, 'failed')], () => true), true);
    });
  });

  describe('a table still being written (#396)', () => {
    const columns: Mapping = { ...emptyMapping(), id: 'id', title: 'title', url: 'url' };
    const at = (ageMs: number): ListedFile => file('slow.csv', ageMs);
    const read = (listedAs: ListedFile, body: string): Extract<FileRead, { ok: true }> => {
      const bytes = Buffer.from(body);
      return { ok: true, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mtimeMs: listedAs.mtimeMs };
    };
    const look = (listedAs: ListedFile, body: string, known?: LedgerEntry) => judgeFile(listedAs, read(listedAs, body), columns, 9, new Map(), known, undefined, NOW);
    const kept = (verdict: ReturnType<typeof judgeFile>): LedgerEntry => {
      const { kind, detail, ...entry } = verdict.change!;
      return entry;
    };
    const head = 'id,title,url\n1,One,https://rows.example/1\n2,Two,https://rows.example/2\n3,Thr';
    const rest = 'ee,https://rows.example/3\n4,Four,https://rows.example/4\n';

    it('leaves a last row with no line end for a later look while the file is young', () => {
      const young = at(30_000);
      const verdict = look(young, head);
      assert.deepEqual(verdict.jobs.map((j) => j.title), ['One', 'Two']);
      assert.deepEqual([verdict.change?.status, verdict.change?.detail, verdict.change?.rowsRead, verdict.taken], ['waiting', FILE_NOTES.openRow, 2, 2]);
      assert.match(FILE_NOTES.openRow, /still for 2 minutes\.$/);
    });

    it('reads the row whole once the tool has ended it, and every later row once', () => {
      const first = look(at(30_000), head);
      const second = look(at(20 * MINUTE), head + rest, kept(first));
      assert.deepEqual(second.jobs.map((j) => [j.title, j.url]), [['Three', 'https://rows.example/3'], ['Four', 'https://rows.example/4']]);
      assert.deepEqual([second.change?.status, second.change?.rowsRead, second.change?.jobCount], ['done', 4, 4]);
    });

    it('reads a whole file that simply ends without a line break, one look later', () => {
      const whole = 'id,title,url\n1,One,https://rows.example/1\n2,Two,https://rows.example/2';
      const first = look(at(30_000), whole);
      assert.deepEqual([first.jobs.map((j) => j.title), first.change?.status], [['One'], 'waiting']);
      // The same bytes, still for long enough: its last row is a row.
      const second = look(at(OPEN_ROW_SETTLE_MS), whole, kept(first));
      assert.deepEqual([second.jobs.map((j) => j.title), second.change?.status, second.change?.detail, second.change?.rowsRead], [['Two'], 'done', null, 2]);
      // And a file found already still is read in one look.
      assert.deepEqual(look(at(10 * MINUTE), whole).jobs.map((j) => j.title), ['One', 'Two']);
    });

    it('holds nothing back from a file that ends its last row, or from one whose rows are JSON', () => {
      assert.equal(look(at(30_000), `${head}\n`).change?.status, 'done');
      const lines = judgeFile(file('run.jsonl', 30_000), read(file('run.jsonl', 30_000), '{"id":"1","title":"One","url":"https://rows.example/1"}\n{"id":"2","title":"Two","url":"https://rows.example/2"}'), columns, 9, new Map(), undefined, undefined, NOW);
      assert.deepEqual([lines.jobs.length, lines.change?.status], [2, 'done']);
    });

    it('waits with a young file of one row rather than calling it a misfit', () => {
      const verdict = look(at(30_000), 'id,title,url\n1,One');
      assert.deepEqual([verdict.rows, verdict.jobs.length, verdict.change?.status], ['fit', 0, 'waiting']);
    });
  });

  describe('the date a row takes (#396)', () => {
    const rowsOf = [
      { title: 'Backend Developer', url: 'https://rows.example/1', company: 'Fennel Works', posted: '2026-09-25' },
      { title: 'Mobile Developer', url: 'https://rows.example/2', company: 'Fennel Works' },
    ];
    const dated = (mtimeMs: number) => {
      const bytes = Buffer.from(JSON.stringify(rowsOf));
      const listedAs = { relPath: 'run-1.json', size: bytes.length, mtimeMs };
      const got: FileRead = { ok: true, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mtimeMs };
      return judgeFile(listedAs, got, mapping, 9, new Map(), undefined, undefined, NOW).jobs.map((j) => j.postedAt.toISOString());
    };

    it('holds a stated date against the clock, not against the file: a file stamped 1980 keeps its rows’ dates', () => {
      // The file's time was the "now" a date could not be after, so 2026-09-25 was "in the future" and became 1980.
      assert.deepEqual(dated(Date.UTC(1980, 0, 1, 12)), ['2026-09-25T00:00:00.000Z', new Date(NOW).toISOString()]);
    });

    it('dates an undated row now when the file’s time is ahead of the clock', () => {
      assert.deepEqual(dated(NOW + 2 * 24 * 60 * MINUTE), ['2026-09-25T00:00:00.000Z', new Date(NOW).toISOString()]);
    });

    it('still gives an undated row the time of a file written in the past', () => {
      assert.deepEqual(dated(NOW - 40 * 24 * 60 * MINUTE)[1], new Date(NOW - 40 * 24 * 60 * MINUTE).toISOString());
    });
  });

  describe('a file that cannot be read whole (#394)', () => {
    const csv = file('export.csv');
    const columns: Mapping = { ...emptyMapping(), id: 'id', title: 'title', url: 'url' };
    const read = (body: string | Uint8Array): Extract<FileRead, { ok: true }> => {
      const bytes = Buffer.from(body);
      return { ok: true, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mtimeMs: csv.mtimeMs };
    };
    const look = (body: string | Uint8Array, known?: LedgerEntry, maxRows?: number) => judgeFile(csv, read(body), columns, 9, new Map(), known, maxRows, NOW);
    const kept = (verdict: ReturnType<typeof judgeFile>): LedgerEntry => {
      const { kind, detail, ...entry } = verdict.change!;
      return entry;
    };
    const cut = ['id,title,url', '1,One,https://rows.example/1', '2,Two,https://rows.example/2', '3,"Three,https://rows.example/3', '4,Four,https://rows.example/4', ''].join('\n');

    it('hands over the rows above a quote that never closes, and the ledger says what was lost', () => {
      const verdict = look(cut);
      assert.deepEqual([verdict.rows, verdict.jobs.map((j) => j.title), verdict.taken], ['fit', ['One', 'Two'], 2]);
      assert.deepEqual([verdict.change?.status, verdict.change?.rowsRead, verdict.change?.jobCount], ['done', 2, 2]);
      assert.match(verdict.change?.detail ?? '', /^A quote opened on line 4 is never closed, so nothing from that line on could be read\./);
      assert.deepEqual(verdict.notes, [verdict.change!.detail]);
    });

    it('reads a file that was cut while being written on from the rows it had, once it is whole', () => {
      const head = 'id,title,url\n1,One,https://rows.example/1\n2,"Two, the';
      const first = look(head);
      assert.deepEqual([first.jobs.map((j) => j.title), first.change?.status, first.change?.rowsRead], [['One'], 'done', 1]);
      const second = look(`${head} second",https://rows.example/2\n3,Three,https://rows.example/3\n`, kept(first));
      assert.deepEqual(second.jobs.map((j) => j.title), ['Two, the second', 'Three']);
      assert.deepEqual([second.change?.status, second.change?.detail, second.change?.rowsRead, second.notes], ['done', null, 3, []]);
    });

    it('lets a long cut file wait like any long file, and says the cut when its last sound row is read', () => {
      const first = look(cut, undefined, 1);
      assert.equal(first.change?.status, 'waiting');
      assert.match(first.change?.detail ?? '', /^1 of 2 rows read so far/);
      const second = look(cut, kept(first), 1);
      assert.deepEqual([second.jobs.map((j) => j.title), second.change?.status, second.change?.rowsRead], [['Two'], 'done', 2]);
      assert.match(second.change?.detail ?? '', /line 4/);
    });

    it('sets aside JSON that stops short in its own words, and a table with no sound row in its own', () => {
      const json = judgeFile(listed, bytesOf('[{"title":"a","url":"u1"},\n{"title":"b","ur'), mapping, 9, new Map());
      assert.deepEqual([json.change?.status, json.change?.detail, json.rows, json.notes], ['skipped', FILE_NOTES.brokenJson, 'none', [FILE_NOTES.brokenJson]]);
      const table = look('id,title,url\n1,"One');
      assert.equal(table.change?.status, 'skipped');
      assert.match(table.change?.detail ?? '', /^A quote opened on line 2 is never closed, and there is no row above/);
      // A file that simply holds no rows has nothing the Check page needs to say.
      assert.deepEqual(look('just some notes\nabout nothing').notes, []);
    });

    it('reads a file that is not UTF-8, and notes the encoding it took without calling anything lost', () => {
      const verdict = look(Buffer.from('id,title,url\n1,Entwickler Z\u00fcrich,https://rows.example/1\n', 'latin1'));
      assert.equal(verdict.jobs[0]!.title, 'Entwickler Zürich');
      assert.deepEqual([verdict.change?.status, verdict.change?.detail], ['done', null]);
      assert.equal(verdict.notes.length, 1);
      assert.match(verdict.notes[0]!, /read as Windows-1252/);
    });

    it('counts characters that could not be read as a part of the file lost', () => {
      const bytes = Buffer.from('id,title,url\n1,Розробник,https://rows.example/1\n2,Тестувальник,https://rows.example/2\n', 'utf8');
      bytes[bytes.indexOf(0xd0) + 1] = 0x20;
      const verdict = look(bytes);
      assert.deepEqual([verdict.jobs.length, verdict.change?.status], [2, 'done']);
      assert.match(verdict.change?.detail ?? '', /^1 character could not be read and shows as \uFFFD\./);
    });
  });

  describe('a file longer than one look takes', () => {
    const role = (i: number) => ({ title: `Role ${i}`, url: `https://rows.example/${i}` });
    const lines = (from: number, to: number): string => Array.from({ length: to - from }, (_, i) => `${JSON.stringify(role(from + i))}\n`).join('');
    /** The ledger's row after a look, as the next look is handed it. */
    const kept = (verdict: ReturnType<typeof judgeFile>): LedgerEntry => {
      const { kind, detail, ...entry } = verdict.change!;
      return entry;
    };
    const look = (got: FileRead, known?: LedgerEntry, maxRows = 3) => judgeFile(listed, got, mapping, 9, new Map(), known, maxRows);
    const titles = (verdict: ReturnType<typeof judgeFile>): string[] => verdict.jobs.map((j) => j.title);

    it('is read a look’s worth at a time, every row once, and waits until its end', () => {
      const got = bytesOf(lines(0, 8));
      const first = look(got);
      assert.deepEqual(titles(first), ['Role 0', 'Role 1', 'Role 2']);
      assert.deepEqual([first.change?.status, first.change?.rowsRead, first.change?.jobCount, first.taken], ['waiting', 3, 3, 3]);
      assert.equal(first.change?.detail, '3 of 8 rows read so far. The next check reads on from there.');
      assert.notEqual(first.change?.sha256, null);

      const second = look(got, kept(first));
      assert.deepEqual(titles(second), ['Role 3', 'Role 4', 'Role 5']);
      assert.deepEqual([second.change?.status, second.change?.rowsRead, second.change?.jobCount], ['waiting', 6, 6]);

      const third = look(got, kept(second));
      assert.deepEqual(titles(third), ['Role 6', 'Role 7']);
      assert.deepEqual([third.change?.status, third.change?.detail, third.change?.rowsRead, third.change?.jobCount, third.taken], ['done', null, 8, 8, 2]);
    });

    // #448: a file finished under other rules than the ones that turned its first rows away is read again whole.
    it('carries what was turned away of its first rows, and the rules that did it, to its end', () => {
      const got = bytesOf(lines(0, 5));
      const first = kept(look(got));
      const away = look(got, { ...first, turnedAway: 2, windowTurnedAway: 1, windowEndsAt: NOW, rulesKey: 'k1' });
      assert.deepEqual([away.change?.status, away.change?.turnedAway, away.change?.windowTurnedAway, away.change?.windowEndsAt, away.change?.rulesKey], ['done', 2, 1, NOW, 'k1']);
      // Nothing turned away yet: the rules of the look that finishes it are the ones it was judged under.
      assert.equal(look(got, { ...first, rulesKey: 'k1' }).change?.rulesKey, null);
      // Read from its first row, it starts with nothing turned away.
      assert.deepEqual(look(got, undefined, 100).change?.turnedAway, 0);
    });

    it('reads past the 2,000th row: one file may take the whole look', () => {
      const verdict = judge(bytesOf(lines(0, 2_100)));
      assert.deepEqual([verdict.change?.status, verdict.change?.rowsRead, verdict.jobs.length], ['done', 2_100, 2_100]);
    });

    it('reads a file that only grew from its old end', () => {
      const before = look(bytesOf(lines(0, 5)), undefined, 100);
      assert.equal(before.change?.status, 'done');
      const grown = look(bytesOf(lines(0, 7)), kept(before), 100);
      assert.deepEqual(titles(grown), ['Role 5', 'Role 6']);
      assert.deepEqual([grown.change?.status, grown.change?.rowsRead, grown.change?.jobCount], ['done', 7, 7]);
    });

    it('reads on from where it stopped when the file grew before its end was reached', () => {
      const first = look(bytesOf(lines(0, 5)));
      const grown = look(bytesOf(lines(0, 7)), kept(first));
      assert.deepEqual(titles(grown), ['Role 3', 'Role 4', 'Role 5']);
      assert.deepEqual([grown.change?.status, grown.change?.rowsRead], ['waiting', 6]);
    });

    it('reads a file written anew from its start', () => {
      const before = look(bytesOf(lines(0, 5)), undefined, 100);
      // Newest first: longer, and no longer opening with the bytes read then.
      const rewritten = look(bytesOf(lines(5, 7) + lines(0, 5)), kept(before), 100);
      assert.deepEqual(titles(rewritten).slice(0, 3), ['Role 5', 'Role 6', 'Role 0']);
      assert.deepEqual([rewritten.change?.rowsRead, rewritten.change?.jobCount], [7, 7]);
    });

    it('hands over nothing from a file touched but not changed', () => {
      const got = bytesOf(lines(0, 5));
      const before = look(got, undefined, 100);
      const again = look(got, kept(before), 100);
      assert.deepEqual([again.jobs.length, again.taken, again.change?.status, again.change?.rowsRead, again.change?.jobCount], [0, 0, 'done', 5, 5]);
    });

    it('starts over when the file holds fewer rows than were read, whatever its first bytes say', () => {
      const array = `[\n${[0, 1, 2].map((i) => JSON.stringify(role(i))).join(',\n')}\n]`;
      const before = look(bytesOf(array), undefined, 100);
      assert.equal(before.change?.rowsRead, 3);
      // A second array after the first is no longer one JSON value: line by line, only the last row of the first reads as one.
      const appended = look(bytesOf(`${array}\n[${JSON.stringify(role(3))}]`), kept(before), 100);
      assert.deepEqual([titles(appended), appended.change?.rowsRead], [['Role 2'], 1]);
    });

    it('keeps what was read when later rows stop fitting the mapping', () => {
      const first = look(bytesOf(lines(0, 3) + '{"position":"QA"}\n{"position":"Ops"}\n'));
      const misfit = look(bytesOf(lines(0, 3) + '{"position":"QA"}\n{"position":"Ops"}\n'), kept(first));
      assert.deepEqual([misfit.rows, misfit.change?.status, misfit.change?.rowsRead, misfit.change?.jobCount, misfit.jobs.length], ['misfit', 'failed', 3, 3, 0]);
    });

    it('starts over after a look that could not read the file', () => {
      const first = look(bytesOf(lines(0, 8)));
      const unread = judgeFile(listed, { ok: false, why: 'changing' }, mapping, 9, new Map(), kept(first), 3);
      assert.deepEqual([unread.change?.sha256, unread.change?.rowsRead], [null, 0]);
      assert.deepEqual(titles(look(bytesOf(lines(0, 8)), kept(unread))), ['Role 0', 'Role 1', 'Role 2']);
    });
  });

  it('turns each way a read can fail into what the ledger should say', () => {
    assert.deepEqual(judge({ ok: false, why: 'gone' }), { change: null, jobs: [], rows: 'none', taken: 0, notes: [] });
    assert.deepEqual([judge({ ok: false, why: 'changing' }).change?.status, judge({ ok: false, why: 'changing' }).change?.detail], ['waiting', FILE_NOTES.changing]);
    assert.deepEqual([judge({ ok: false, why: 'refused' }).change?.status, judge({ ok: false, why: 'refused' }).change?.detail], ['failed', FILE_NOTES.refused]);
    assert.equal(judge({ ok: false, why: 'too-large' }).change?.detail, tooLargeNote('json'));
    assert.equal(judge({ ok: false, why: 'outside' }).change?.detail, FILE_NOTES.outside);
    assert.equal(judge({ ok: false, why: 'outside' }).change?.status, 'skipped');
    const odd = judge({ ok: false, why: 'unreadable', code: 'EIO' }).change;
    assert.equal(odd?.status, 'failed');
    assert.match(odd?.detail ?? '', /\(EIO\)/);
    // No hash: tried again at the next look, as a refused one is.
    assert.equal(odd?.sha256, null);
  });
});

describe('newestIsMisfit', () => {
  const all = (): boolean => true;
  const misfit = (f: ListedFile): LedgerEntry => seen(f, 'failed');

  it('holds while the newest file judged did not fit, though it is not read again', () => {
    const older = file('old.json', 30 * MINUTE);
    const newer = file('new.json', 10 * MINUTE);
    assert.equal(newestIsMisfit([older, newer], [seen(older), misfit(newer)], all), true);
  });

  it('lets go once a newer file fits, or the misfit is gone, changed, or left out by the name filter', () => {
    const bad = file('bad.json', 30 * MINUTE);
    const good = file('good.json', 10 * MINUTE);
    assert.equal(newestIsMisfit([bad, good], [misfit(bad), seen(good)], all), false);
    assert.equal(newestIsMisfit([], [misfit(bad)], all), false);
    assert.equal(newestIsMisfit([{ ...bad, size: bad.size + 1 }], [misfit(bad)], all), false);
    assert.equal(newestIsMisfit([bad], [misfit(bad)], includeMatcher('good*')), false);
  });

  it('is not a misfit when the system refused a file: that one has no hash and is tried again', () => {
    const f = file('a.json');
    assert.equal(newestIsMisfit([f], [{ ...misfit(f), sha256: null }], all), false);
  });
});

describe('unreadChange', () => {
  it('records a file the plan did not read: one that waits, one too large', () => {
    assert.deepEqual(unreadChange(file('a.csv'), 'fresh'), { ...file('a.csv'), kind: 'csv', sha256: null, status: 'waiting', detail: FILE_NOTES.fresh, jobCount: 0, rowsRead: 0, ...UNJUDGED });
    assert.equal(unreadChange(file('a.csv'), 'tooLarge').status, 'skipped');
  });
});

describe('saved postings in a folder', () => {
  it('knows a saved posting by its extension, and keeps the kinds of a folder apart', () => {
    assert.deepEqual(['a.html', 'a.HTM', 'b.txt', 'c.md', 'c.markdown', 'd.pdf', 'e.docx'].map(postingFileKind), ['html', 'html', 'txt', 'md', 'md', 'pdf', 'docx']);
    // #399: what a browser saves a page as in one file is a saved posting too, not "another file".
    assert.deepEqual(['Job.mhtml', 'Job.MHT', 'Job.webarchive'].map(postingFileKind), ['mhtml', 'mhtml', 'webarchive']);
    assert.equal(kindsFor('rows')('Job.mhtml'), null);
    for (const name of ['a.json', 'a.doc', 'a.png', 'a.eml', '.html']) assert.equal(postingFileKind(name), null, name);
    assert.equal(kindsFor('postings')('a.json'), null);
    assert.equal(kindsFor('rows')('a.html'), null);
  });

  it('reads each kind up to its own size, and says so in the list', () => {
    assert.equal(maxBytesOf('json'), MAX_FILE_BYTES);
    assert.ok(maxBytesOf('html') < maxBytesOf('pdf'));
    assert.match(tooLargeNote('pdf'), /5 MB, which is more than a document/);
    // A page saved as one file carries its images inside it.
    assert.ok(maxBytesOf('mhtml') > maxBytesOf('pdf'));
    assert.match(tooLargeNote('mhtml'), /10 MB, which is more than a saved posting/);
    assert.match(tooLargeNote('csv'), /a file of rows/);
    const page = file('big.html', 10 * MINUTE, maxBytesOf('html') + 1);
    const plan = planScan([page, file('ok.pdf', 10 * MINUTE, maxBytesOf('html') + 1)], [], NOW, undefined, 'postings');
    assert.deepEqual([names(plan.tooLarge), names(plan.read)], [['big.html'], ['ok.pdf']]);
    assert.equal(unreadChange(page, 'tooLarge', postingFileKind).detail, tooLargeNote('html'));
  });

  it('guesses what a folder holds from its files, an empty one being for saved postings', () => {
    assert.equal(guessHolds([file('a.json'), file('b.csv'), file('c.html')]), 'rows');
    assert.equal(guessHolds([file('a.json'), file('c.html'), file('d.pdf')]), 'postings');
    assert.equal(guessHolds([]), 'postings');
    assert.equal(guessHolds([file('a.json'), file('c.html'), file('d.pdf')], includeMatcher('*.json')), 'rows');
  });
});

describe('pageResources', () => {
  it('passes over what a browser saves beside a page, localized names too, and nothing else', () => {
    const listing = [file('Job at Acme.html'), file('Job at Acme_files/frame.html'), file('Job at Acme_files/deep/x.html'), file('sub/Role.htm'), file('sub/Role-Dateien/a.html'), file('old_files/real.html'), file('Job at Acme Two.html')];
    const isResource = pageResources(listing);
    assert.deepEqual(listing.map((f) => f.relPath).filter(isResource), ['Job at Acme_files/frame.html', 'Job at Acme_files/deep/x.html', 'sub/Role-Dateien/a.html']);
  });

  // #399: any folder that started like a page's name was taken for that page's files, and the postings in it were never listed.
  it('leaves a folder of the user’s own alone, however it is named after a page', () => {
    const listing = [file('Acme.html'), file('Acme interviews/backend-posting.txt'), file('Acme-2026/role.pdf'), file('Acme_notes/a.html'), file('Acme.old/b.html'), file('Acme_FILES/frame.html'), file('Acme_fichiers/x.html'), file('Acme.files/y.html')];
    const isResource = pageResources(listing);
    assert.deepEqual(listing.map((f) => f.relPath).filter(isResource), ['Acme_FILES/frame.html', 'Acme_fichiers/x.html', 'Acme.files/y.html']);
  });
});
