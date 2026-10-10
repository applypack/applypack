import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  FILE_NOTES,
  MAX_FILES_PER_LOOK,
  MAX_FILE_BYTES,
  SETTLE_MS,
  guessHolds,
  includeMatcher,
  kindsFor,
  maxBytesOf,
  pageResources,
  postingFileKind,
  tooLargeNote,
  judgeFile,
  newestIsMisfit,
  planScan,
  rowFileKind,
  unreadChange,
  type FileRead,
  type LedgerEntry,
  type ListedFile,
} from './folder-scan';
import { emptyMapping, type Mapping } from './map';

const NOW = Date.UTC(2026, 9, 5, 12);
const MINUTE = 60_000;
const file = (relPath: string, ageMs = 10 * MINUTE, size = 1_000): ListedFile => ({ relPath, size, mtimeMs: NOW - ageMs });
const seen = (f: ListedFile, status: LedgerEntry['status'] = 'done'): LedgerEntry => ({ ...f, sha256: 'a'.repeat(64), status, rowsRead: 0, jobCount: 0 });
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
    assert.deepEqual(planScan([settled], [seen(settled)], NOW), { read: [], waiting: [], later: [], tooLarge: [], unchanged: 1, other: 0 });
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

  it('reads a bounded number of files a look and leaves the rest for the next', () => {
    const many = Array.from({ length: MAX_FILES_PER_LOOK + 3 }, (_, i) => file(`run-${String(i).padStart(2, '0')}.json`, (100 - i) * MINUTE));
    const plan = planScan(many, [], NOW);
    assert.equal(plan.read.length, MAX_FILES_PER_LOOK);
    assert.deepEqual(names(plan.later), ['run-20.json', 'run-21.json', 'run-22.json']);
    assert.equal(plan.read[0]!.relPath, 'run-00.json');
  });

  it('reads new and changed files before the ones it looks at again, so a heap of those cannot starve them', () => {
    const retried = Array.from({ length: MAX_FILES_PER_LOOK }, (_, i) => file(`stuck-${String(i).padStart(2, '0')}.json`, (500 - i) * MINUTE));
    const fresh = file('new.json', MINUTE);
    const plan = planScan([...retried, fresh], retried.map((f) => seen(f, 'waiting')), NOW);
    assert.equal(plan.read[0]!.relPath, 'new.json');
    assert.equal(plan.read.length, MAX_FILES_PER_LOOK);
    assert.deepEqual(names(plan.later), ['stuck-19.json']);
  });

  it('reads a file dated in the future instead of waiting for it forever', () => {
    assert.deepEqual(names(planScan([file('ahead.json', -10 * MINUTE)], [], NOW).read), ['ahead.json']);
  });

  it('is not troubled by a file that disappeared: the ledger keeps its row and the plan says nothing', () => {
    const gone = file('gone.json');
    assert.deepEqual(planScan([], [seen(gone)], NOW), { read: [], waiting: [], later: [], tooLarge: [], unchanged: 0, other: 0 });
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
  const judge = (got: FileRead, readAs: ReadonlyMap<string, string> = new Map()) => judgeFile(listed, got, mapping, 9, readAs);

  it('hands over the rows of a file that fits, and records it as read with its hash', () => {
    const got = bytesOf(rows);
    const verdict = judge(got);
    assert.equal(verdict.rows, 'fit');
    assert.deepEqual(verdict.jobs.map((j) => [j.companyId, j.title, j.employer]), [
      [9, 'Backend Developer', 'Fennel Works'],
      [9, 'Mobile Developer', 'Fennel Works'],
    ]);
    assert.deepEqual(verdict.change, { relPath: 'run-1.json', kind: 'json', status: 'done', detail: null, jobCount: 2, rowsRead: 2, size: got.ok ? got.size : 0, mtimeMs: listed.mtimeMs, sha256: got.ok ? got.sha256 : '' });
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

  describe('a file longer than one look takes', () => {
    const role = (i: number) => ({ title: `Role ${i}`, url: `https://rows.example/${i}` });
    const lines = (from: number, to: number): string => Array.from({ length: to - from }, (_, i) => `${JSON.stringify(role(from + i))}\n`).join('');
    /** The ledger's row after a look, as the next look is handed it. */
    const kept = (verdict: ReturnType<typeof judgeFile>): LedgerEntry => {
      const { relPath, size, mtimeMs, sha256, status, rowsRead, jobCount } = verdict.change!;
      return { relPath, size, mtimeMs, sha256, status, rowsRead, jobCount };
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
    assert.deepEqual(judge({ ok: false, why: 'gone' }), { change: null, jobs: [], rows: 'none', taken: 0 });
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
    assert.deepEqual(unreadChange(file('a.csv'), 'fresh'), { ...file('a.csv'), kind: 'csv', sha256: null, status: 'waiting', detail: FILE_NOTES.fresh, jobCount: 0, rowsRead: 0 });
    assert.equal(unreadChange(file('a.csv'), 'tooLarge').status, 'skipped');
  });
});

describe('saved postings in a folder', () => {
  it('knows a saved posting by its extension, and keeps the kinds of a folder apart', () => {
    assert.deepEqual(['a.html', 'a.HTM', 'b.txt', 'c.md', 'c.markdown', 'd.pdf', 'e.docx'].map(postingFileKind), ['html', 'html', 'txt', 'md', 'md', 'pdf', 'docx']);
    for (const name of ['a.json', 'a.doc', 'a.png', 'a.eml', '.html']) assert.equal(postingFileKind(name), null, name);
    assert.equal(kindsFor('postings')('a.json'), null);
    assert.equal(kindsFor('rows')('a.html'), null);
  });

  it('reads each kind up to its own size, and says so in the list', () => {
    assert.equal(maxBytesOf('json'), MAX_FILE_BYTES);
    assert.ok(maxBytesOf('html') < maxBytesOf('pdf'));
    assert.match(tooLargeNote('pdf'), /5 MB, which is more than a document/);
    const page = file('big.html', 10 * MINUTE, maxBytesOf('html') + 1);
    const plan = planScan([page, file('ok.pdf', 10 * MINUTE, maxBytesOf('html') + 1)], [], NOW, undefined, postingFileKind);
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
});
