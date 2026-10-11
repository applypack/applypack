import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_COLUMNS, MAX_ROWS, NOT_ROWS, decodeBody, findRows, type FoundRows } from './rows';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

function rowsOf(body: string, maxRows?: number): FoundRows {
  const found = findRows(body, maxRows);
  if (!found.ok) throw new Error(found.error);
  return found;
}

describe('findRows: JSON', () => {
  it('takes an array of objects as it is', () => {
    const found = rowsOf(fixture('shape-flat-two-links.json'));
    assert.equal(found.format, 'json');
    assert.equal(found.rows.length, 3);
    assert.equal(found.rows[0]!.title, 'Senior Backend Engineer (PHP)');
  });

  it('counts what is not a row in the array and leaves it out', () => {
    const found = rowsOf('[{"title":"a"}, 7, "text", null, ["x"], {"title":"b"}]');
    assert.equal(found.rows.length, 2);
    assert.equal(found.notRows, 4);
  });

  it('finds the list under a known key, in the order data, items, results, records, jobs', () => {
    assert.equal(rowsOf(fixture('shape-nested-everything.json')).rows.length, 3);
    const found = rowsOf('{"jobs":[{"title":"from jobs"}],"data":[{"title":"from data"}]}');
    assert.equal(found.rows[0]!.title, 'from data');
  });

  it('takes the only list of objects when no key is a known one', () => {
    const found = rowsOf('{"count":2,"tags":["a","b"],"vacancies":[{"title":"a"},{"title":"b"}]}');
    assert.equal(found.rows.length, 2);
  });

  it('follows a wrapper a few levels down', () => {
    const found = rowsOf('{"result":{"capturedLists":{"Open roles":[{"Position":"a"},{"Position":"b"}]}}}');
    assert.deepEqual(found.rows.map((r) => r.Position), ['a', 'b']);
    assert.equal(rowsOf('{"data":{"items":[{"title":"a"}]}}').rows.length, 1);
  });

  it('reads an object with no list inside as one row', () => {
    const found = rowsOf('{"title":"One posting a file","url":"https://rows.example/1","tags":["a","b"]}');
    assert.equal(found.rows.length, 1);
    assert.equal(found.rows[0]!.title, 'One posting a file');
  });

  it('does not guess between two lists of objects', () => {
    const found = rowsOf('{"open":[{"title":"a"}],"closed":[{"title":"b"}]}');
    assert.equal(found.rows.length, 1);
    assert.deepEqual(Object.keys(found.rows[0]!), ['open', 'closed']);
  });

  it('unwraps a record around its fields and keeps the record id unless the fields bring one', () => {
    const body = JSON.stringify({
      records: [
        { id: 'rec1', createdTime: '2026-09-01T00:00:00.000Z', fields: { Position: 'a', Link: 'https://rows.example/a' } },
        { id: 'rec2', createdTime: '2026-09-01T00:00:00.000Z', fields: { id: 'own-id', Position: 'b' } },
        { id: 'rec3', title: 'not a record: it has fields of its own', fields: { x: 1 } },
      ],
    });
    const { rows } = rowsOf(body);
    assert.deepEqual(rows[0], { id: 'rec1', Position: 'a', Link: 'https://rows.example/a' });
    assert.deepEqual(rows[1], { id: 'own-id', Position: 'b' });
    assert.equal(rows[2]!.title, 'not a record: it has fields of its own');
  });

  it('refuses a JSON value that holds no object', () => {
    assert.deepEqual(findRows('[1, 2, 3]'), { ok: false, error: NOT_ROWS });
    assert.deepEqual(findRows('[]'), { ok: false, error: NOT_ROWS });
  });
});

describe('findRows: JSON Lines', () => {
  it('reads one object a line and counts the lines that are not one', () => {
    const found = rowsOf('{"title":"a"}\n\n{"title":"b"}\r\n{"title": broken\n"just a string"\n{"title":"c"}\n');
    assert.equal(found.format, 'jsonl');
    assert.deepEqual(found.rows.map((r) => r.title), ['a', 'b', 'c']);
    assert.equal(found.notRows, 2);
  });

  it('refuses text that only starts like JSON', () => {
    assert.deepEqual(findRows('{ this is not json at all'), { ok: false, error: NOT_ROWS });
  });
});

describe('findRows: CSV and TSV', () => {
  it('reads the header as the keys, quoted cells and CRLF included', () => {
    const found = rowsOf(fixture('user-columns.csv'));
    assert.equal(found.format, 'csv');
    assert.equal(found.rows.length, 4);
    assert.deepEqual(Object.keys(found.rows[0]!), ['Position', 'Organisation', 'Job link', 'Where', 'Posted', 'About the role', 'Pay']);
    assert.equal(found.rows[0]!.Position, 'Backend Developer, Payments');
    assert.match(String(found.rows[0]!['About the role']), /"close enough" is a bug here\.\r\nThree years/);
    assert.equal(found.rows[2]!.Posted, '');
  });

  it('reads tabs as TSV and a semicolon file as CSV', () => {
    assert.equal(rowsOf('title\turl\nA\thttps://rows.example/a').format, 'tsv');
    const semi = rowsOf('title;pay\nA;1,5');
    assert.equal(semi.format, 'csv');
    assert.equal(semi.rows[0]!.pay, '1,5');
  });

  it('numbers an empty header and tells repeated ones apart, whatever they are called', () => {
    const { rows } = rowsOf('title,,title,__proto__\nA,B,C,D\n');
    assert.deepEqual(Object.keys(rows[0]!), ['title', 'Column 2', 'title (2)', '__proto__']);
    assert.equal(rows[0]!['__proto__'], 'D');
    assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype);
    assert.deepEqual(Object.keys(rowsOf('a,a,a (2),a\n1,2,3,4').rows[0]!), ['a', 'a (2)', 'a (2) (2)', 'a (3)']);
  });

  it('keeps the cells a row has: a short row is not padded, a long one is cut at the header', () => {
    const { rows } = rowsOf('title,url,place\nA\nB,https://rows.example/b,Lisbon,extra,cells\n');
    assert.deepEqual(rows[0], { title: 'A' });
    assert.deepEqual(rows[1], { title: 'B', url: 'https://rows.example/b', place: 'Lisbon' });
  });

  it('refuses a header wider than a table of jobs is, before a row is built from it', () => {
    const wide = `${Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `c${i}`).join(',')}\n${'x\n'.repeat(2000)}`;
    const found = findRows(wide);
    assert.equal(found.ok, false);
    assert.match(found.ok ? '' : found.error, /201 columns, and ApplyPack reads up to 200/);
    assert.equal(rowsOf(`${Array.from({ length: MAX_COLUMNS }, (_, i) => `c${i}`).join(',')}\nx,y`).rows.length, 1);
  });

  it('takes the delimiter a spreadsheet names on a line of its own', () => {
    const found = rowsOf('sep=;\r\ntitle;note\r\nA;"one, two"\r\n');
    assert.deepEqual(found.rows, [{ title: 'A', note: 'one, two' }]);
  });

  it('reads a table whose first cell opens with a bracket', () => {
    assert.deepEqual(rowsOf('[ref],title\n[1],A').rows, [{ '[ref]': '[1]', title: 'A' }]);
  });

  it('refuses prose, a header with no rows, an empty file and a binary one', () => {
    assert.deepEqual(findRows('one line of text\nand another'), { ok: false, error: NOT_ROWS });
    assert.deepEqual(findRows('title,url\n'), { ok: false, error: NOT_ROWS });
    assert.deepEqual(findRows('  \n'), { ok: false, error: 'This file is empty.' });
    assert.deepEqual(findRows('PK\u0003\u0004\u0000\u0000binary'), { ok: false, error: NOT_ROWS });
  });
});

describe('findRows: damaged and odd files (#394)', () => {
  const cut = ['id,title,url', '1,One,https://rows.example/1', '2,Two,https://rows.example/2', '3,"Three,https://rows.example/3', '4,Four,https://rows.example/4', '5,Five,https://rows.example/5', ''].join('\n');

  it('says where a table stops being readable, instead of counting the rest of the file as one row', () => {
    const found = rowsOf(cut);
    assert.deepEqual([found.rows.length, found.total, found.over, found.cutAt], [2, 2, 0, 4]);
    assert.deepEqual(found.rows.map((r) => r.title), ['One', 'Two']);
    // A file read whole says so.
    assert.equal(rowsOf('id,title\n1,"closed"').cutAt, null);
    assert.equal(rowsOf('[{"title":"a"}]').cutAt, null);
    assert.equal(rowsOf('{"title":"a"}\n{"title":"b"}').cutAt, null);
  });

  it('names the line as an editor numbers it, under a mark, blank lines and a sep= line', () => {
    assert.equal(rowsOf('\uFEFF\n \nid,title\n1,One\n2,"open').cutAt, 5);
    assert.equal(rowsOf('sep=;\nid;title\n1;One\n2;"open').cutAt, 4);
  });

  it('still says where the file is cut when a later look reads on from a row', () => {
    const next = findRows(cut, 1, 1);
    assert.ok(next.ok);
    assert.deepEqual([next.rows.map((r) => r.title), next.over, next.total, next.cutAt], [['Two'], 0, 2, 4]);
  });

  it('refuses a table whose first row already opens a quote it never closes, and says which line', () => {
    assert.deepEqual(findRows('id,title\n1,"open\n2,Two'), {
      ok: false,
      error: 'A quote opened on line 2 is never closed, and there is no row above that line to read. Close the quote in the file.',
      why: 'unclosed-quote',
    });
    // The header's own line: nothing at all is above it.
    const header = findRows('"id,title\n1,One\n2,Two');
    assert.deepEqual([header.ok, header.ok ? null : header.why], [false, 'unclosed-quote']);
    assert.match(header.ok ? '' : header.error, /^A quote opened on line 1 is never closed/);
    // Prose is still prose, whatever quote it holds.
    assert.deepEqual(findRows('one line of text\n"and another'), { ok: false, error: NOT_ROWS });
  });

  it('says JSON that stops short is that, rather than reading it as a table', () => {
    const broken = { ok: false, error: 'This file starts as JSON, but it is cut off or not valid JSON, so nothing in it can be read. Export it again.', why: 'broken-json' };
    // One object a line inside an array, cut: read as CSV this gave columns named `[{"title":"a"`.
    assert.deepEqual(findRows('[{"title":"a","url":"u1"},\n{"title":"b","url":"u2"},\n{"title":"c","ur'), broken);
    assert.deepEqual(findRows('[\n  {\n    "title": "a",\n    "url": "htt'), broken);
    assert.deepEqual(findRows('{"title":"a","url":"htt'), broken);
    assert.deepEqual(findRows('[{"title":"a"},]'), broken);
    // JSON Lines with its last line cut is rows and one entry that is not: the lines before it are whole.
    const lines = rowsOf('{"title":"a"}\n{"title":"b"}\n{"tit');
    assert.deepEqual([lines.format, lines.rows.length, lines.notRows], ['jsonl', 2, 1]);
  });

  it('keeps an empty first header cell: an index column is a column', () => {
    // pandas `to_csv(sep="\t")` writes its index under an empty header; trimmed away, every column moved one to the left.
    const found = rowsOf('\ttitle\tcompany\n0\tBackend Developer\tAcme\n1\tData Engineer\tAcme\n');
    assert.equal(found.format, 'tsv');
    assert.deepEqual(found.rows, [
      { 'Column 1': '0', title: 'Backend Developer', company: 'Acme' },
      { 'Column 1': '1', title: 'Data Engineer', company: 'Acme' },
    ]);
    assert.deepEqual(rowsOf(',title\n7,Backend Developer').rows, [{ 'Column 1': '7', title: 'Backend Developer' }]);
    // Blank lines above the first row and blanks around a JSON value are still no part of the file.
    assert.equal(rowsOf('\n \n[{"title":"a"}]\n\n').rows.length, 1);
    assert.equal(rowsOf('  {"title":"a"}\n').rows.length, 1);
    assert.deepEqual(rowsOf('\r\n\r\ntitle,url\r\nA,u\r\n').rows, [{ title: 'A', url: 'u' }]);
  });

  it('reads an object that holds its rows by key, and still takes a posting made of parts as one row', () => {
    const keyed = rowsOf('{"a1":{"title":"Backend Developer","url":"https://rows.example/1"},"a2":{"title":"Data Engineer","url":"https://rows.example/2","remote":true}}');
    assert.deepEqual(keyed.rows.map((r) => r.title), ['Backend Developer', 'Data Engineer']);
    assert.equal(keyed.total, 2);
    const parts = rowsOf('{"job":{"title":"a","description":"b","url":"u","location":"x"},"company":{"name":"Acme","url":"c"}}');
    assert.deepEqual(Object.keys(parts.rows[0]!), ['job', 'company']);
    // One object under a key is not a list of rows, and neither are values that share nothing.
    assert.equal(rowsOf('{"only":{"title":"a","url":"u"}}').rows.length, 1);
    assert.equal(rowsOf('{"a":{"title":"x"},"b":{"count":3}}').rows.length, 1);
  });
});

describe('findRows: a table’s last row with no line end (#396)', () => {
  it('says when a table does not end its last row, and only then', () => {
    assert.equal(rowsOf('id,title\n1,One\n2,Tw').openRow, true);
    assert.equal(rowsOf('id\ttitle\n1\tOne').openRow, true);
    assert.equal(rowsOf('id,title\n1,One\n2,Two\n').openRow, false);
    assert.equal(rowsOf('id,title\r\n1,One\r\n').openRow, false);
    // Blanks after the last line break are no line of their own.
    assert.equal(rowsOf('id,title\n1,One\n  \t').openRow, false);
  });

  it('never says it of JSON, whose cut line is not a row, nor of a table that lost its end to an open quote', () => {
    assert.equal(rowsOf('[{"title":"a"}]').openRow, false);
    assert.equal(rowsOf('{"title":"a"}\n{"title":"b"}').openRow, false);
    const cut = rowsOf('id,title\n1,One\n2,"open');
    assert.deepEqual([cut.cutAt, cut.openRow], [3, false]);
  });
});

describe('findRows: the ceiling', () => {
  it('reads up to the ceiling and counts the rest', () => {
    const body = JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ title: `row ${i}` })));
    const found = rowsOf(body, 5);
    assert.equal(found.rows.length, 5);
    assert.equal(found.over, 7);
    assert.equal(rowsOf(body).over, 0);
    assert.ok(MAX_ROWS >= 1000);
  });

  it('counts CSV rows past the ceiling too', () => {
    const found = rowsOf(`title,url\n${Array.from({ length: 9 }, (_, i) => `t${i},u${i}`).join('\n')}`, 4);
    assert.equal(found.rows.length, 4);
    assert.equal(found.over, 5);
  });

  it('reads on from a row, in every format, and says how many the body holds', () => {
    const titles = Array.from({ length: 9 }, (_, i) => `t${i}`);
    const bodies = {
      json: JSON.stringify(titles.map((title) => ({ title }))),
      jsonl: titles.map((title) => JSON.stringify({ title })).join('\n'),
      csv: `title,url\n${titles.map((title) => `${title},u`).join('\n')}`,
    };
    for (const [format, body] of Object.entries(bodies)) {
      const page = findRows(body, 4, 3);
      assert.ok(page.ok, format);
      assert.deepEqual([page.rows.map((r) => r.title), page.over, page.total], [['t3', 't4', 't5', 't6'], 2, 9], format);
      const last = findRows(body, 4, 7);
      assert.ok(last.ok, format);
      assert.deepEqual([last.rows.map((r) => r.title), last.over, last.total], [['t7', 't8'], 0, 9], format);
      // Past its end there is nothing to give, and the total still says what it holds.
      const past = findRows(body, 4, 12);
      assert.ok(past.ok, format);
      assert.deepEqual([past.rows, past.over, past.total], [[], 0, 9], format);
    }
  });
});

describe('decodeBody', () => {
  it('reads UTF-8, with or without its mark, and UTF-16 in either byte order', () => {
    const text = 'title\turl\nРозробник\thttps://rows.example/1';
    assert.equal(decodeBody(Buffer.from(text, 'utf8')), text);
    // The row finder drops a mark the decoder left, as when something else read the file into a string.
    assert.equal(rowsOf(`\uFEFF${text}`).rows[0]!.title, 'Розробник');
    assert.equal(rowsOf(decodeBody(Buffer.from(`\uFEFF${text}`, 'utf8'))).rows[0]!.title, 'Розробник');
    const le = Buffer.from(`\uFEFF${text}`, 'utf16le');
    assert.equal(rowsOf(decodeBody(le)).rows[0]!.title, 'Розробник');
    assert.equal(rowsOf(decodeBody(Buffer.from(le).swap16())).rows[0]!.title, 'Розробник');
  });

  it('reads a file that is not UTF-8 in its language’s own encoding (decode.ts)', () => {
    // "Zürich" as a Windows spreadsheet's plain CSV writes it: one byte for the ü.
    const ansi = Buffer.from('city,url\nZ\u00fcrich,https://rows.example/1', 'latin1');
    assert.equal(rowsOf(decodeBody(ansi)).rows[0]!.city, 'Zürich');
  });
});
