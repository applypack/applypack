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
});
