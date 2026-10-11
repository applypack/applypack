import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readDelimited, sniffDelimiter, type Delimiter } from './delimited';

const cells = (src: string, delimiter: Delimiter): string[][] => readDelimited(src, delimiter).rows;

describe('sniffDelimiter', () => {
  it('reads the delimiter off the first line, outside quotes', () => {
    assert.equal(sniffDelimiter('a,b,c\n1;2;3'), ',');
    assert.equal(sniffDelimiter('a;b;c\n1,5;2;3'), ';');
    assert.equal(sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
    assert.equal(sniffDelimiter('"Title, with commas";"Company"\nx;y'), ';');
  });

  it('answers a comma when the line has none of them', () => {
    assert.equal(sniffDelimiter('just one column'), ',');
  });
});

describe('readDelimited', () => {
  it('splits rows on LF, CRLF and a bare CR', () => {
    assert.deepEqual(cells('a,b\n1,2\r\n3,4\r5,6', ','), [['a', 'b'], ['1', '2'], ['3', '4'], ['5', '6']]);
  });

  it('keeps a delimiter, a line break and a doubled quote inside a quoted cell', () => {
    assert.deepEqual(cells('title,text\n"Developer, Payments","line one\r\nline two, with ""quotes"""\n', ','), [
      ['title', 'text'],
      ['Developer, Payments', 'line one\r\nline two, with "quotes"'],
    ]);
  });

  it('drops blank lines and the empty line a trailing newline leaves', () => {
    assert.deepEqual(cells('a,b\n\n1,2\n\n', ','), [['a', 'b'], ['1', '2']]);
  });

  it('opens a quoted cell after the blanks some tools put behind the delimiter', () => {
    assert.deepEqual(cells('a, "b, c" ,d', ','), [['a', 'b, c ', 'd']]);
  });

  it('keeps empty cells in their place', () => {
    assert.deepEqual(cells('a,b,c\n1,,3\n,,x', ','), [['a', 'b', 'c'], ['1', '', '3'], ['', '', 'x']]);
  });

  it('treats a quote in the middle of a cell as a character', () => {
    assert.deepEqual(cells('size\n5" screen', ','), [['size'], ['5" screen']]);
  });

  // Until #394 the open quote was read as one cell holding the rest of the file, and the caller counted that as a row.
  it('reports a quote that never closes, and gives only the rows before its own', () => {
    assert.deepEqual(readDelimited('a,b\n"open,1\n2', ','), { rows: [['a', 'b']], unclosedLine: 2 });
    const eight = ['id,title', '1,One', '2,Two', '3,"Three', '4,Four', '5,Five', '6,Six', '7,Seven', '8,Eight', ''].join('\n');
    assert.deepEqual(readDelimited(eight, ','), { rows: [['id', 'title'], ['1', 'One'], ['2', 'Two']], unclosedLine: 4 });
    // The row the quote is in goes with it, cells before the quote included.
    assert.deepEqual(readDelimited('a,b,c\n1,2,3\nkept?,no,"open', ',').rows, [['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('names the line as an editor numbers it: CRLF, a bare CR and a line break inside a closed quote each count once', () => {
    assert.equal(readDelimited('a,b\r\n1,2\r\n3,"open', ',').unclosedLine, 3);
    assert.equal(readDelimited('a,b\r1,2\r3,"open', ',').unclosedLine, 3);
    assert.equal(readDelimited('a,b\n1,"two\nlines"\n\n3,"open\nmore', ',').unclosedLine, 5);
    assert.equal(readDelimited('a,b\n1,"two\r\nlines"\r\n3,"open', ',').unclosedLine, 4);
  });

  it('says a sound text has no open quote', () => {
    assert.equal(readDelimited('a,b\n1,"closed"\n2,5" screen', ',').unclosedLine, null);
  });

  it('reads tabs and semicolons the same way', () => {
    assert.deepEqual(cells('a\tb\n"x\ty"\tz', '\t'), [['a', 'b'], ['x\ty', 'z']]);
    assert.deepEqual(cells('a;b\n1,5;2', ';'), [['a', 'b'], ['1,5', '2']]);
  });
});
