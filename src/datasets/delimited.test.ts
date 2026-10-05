import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readDelimited, sniffDelimiter } from './delimited';

describe('sniffDelimiter', () => {
  it('reads the delimiter off the first line, outside quotes', () => {
    assert.equal(sniffDelimiter('a,b,c\n1;2;3'), ',');
    assert.equal(sniffDelimiter('a;b;c\n1,5;2;3'), ';');
    assert.equal(sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
    assert.equal(sniffDelimiter('"Title, with commas";"Company"\nx;y'), ';');
  });

  it('answers a comma when the line has none of them, and skips a BOM', () => {
    assert.equal(sniffDelimiter('just one column'), ',');
    assert.equal(sniffDelimiter('﻿a\tb'), '\t');
  });
});

describe('readDelimited', () => {
  it('splits rows on LF, CRLF and a bare CR', () => {
    assert.deepEqual(readDelimited('a,b\n1,2\r\n3,4\r5,6', ','), [['a', 'b'], ['1', '2'], ['3', '4'], ['5', '6']]);
  });

  it('keeps a delimiter, a line break and a doubled quote inside a quoted cell', () => {
    assert.deepEqual(readDelimited('title,text\n"Developer, Payments","line one\r\nline two, with ""quotes"""\n', ','), [
      ['title', 'text'],
      ['Developer, Payments', 'line one\r\nline two, with "quotes"'],
    ]);
  });

  it('drops a BOM, blank lines and the empty line a trailing newline leaves', () => {
    assert.deepEqual(readDelimited('﻿a,b\n\n1,2\n\n', ','), [['a', 'b'], ['1', '2']]);
  });

  it('keeps empty cells in their place', () => {
    assert.deepEqual(readDelimited('a,b,c\n1,,3\n,,x', ','), [['a', 'b', 'c'], ['1', '', '3'], ['', '', 'x']]);
  });

  it('treats a quote in the middle of a cell as a character', () => {
    assert.deepEqual(readDelimited('size\n5" screen', ','), [['size'], ['5" screen']]);
  });

  it('keeps the text of a quote that never closes', () => {
    assert.deepEqual(readDelimited('a,b\n"open,1\n2', ','), [['a', 'b'], ['open,1\n2']]);
  });

  it('reads tabs and semicolons the same way', () => {
    assert.deepEqual(readDelimited('a\tb\n"x\ty"\tz', '\t'), [['a', 'b'], ['x\ty', 'z']]);
    assert.deepEqual(readDelimited('a;b\n1,5;2', ';'), [['a', 'b'], ['1,5', '2']]);
  });
});
