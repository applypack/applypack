import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToRead, withoutCopies } from './copies';

const row = (id: number, title: string, of: number | null = null, ofTitle = title) => ({
  id,
  title,
  crossListedOfJobId: of,
  crossListedOf: of === null ? null : { title: ofTitle },
});

test('a posting several sources list shows once, as its original', () => {
  const rows = [row(270, 'Senior React Full-stack Developer', 22), row(22, 'Senior React Full-Stack Developer'), row(411, 'senior react full stack developer', 22), row(5, 'Go Engineer')];
  assert.deepEqual(withoutCopies(rows, 8).map((r) => r.id), [22, 5]);
});

test('a copy stands for the posting when the original is not among the rows', () => {
  const rows = [row(270, 'Senior React Developer', 22), row(411, 'Senior React Developer', 22)];
  assert.deepEqual(withoutCopies(rows, 8).map((r) => r.id), [270]);
});

test('a linked row under another title is another role, and stays', () => {
  const rows = [row(22, 'PHP Developer'), row(30, 'Angular Developer', 22, 'PHP Developer')];
  assert.deepEqual(withoutCopies(rows, 8).map((r) => r.id), [22, 30]);
});

test('the list stops at its limit, and reads enough rows to fill it', () => {
  const rows = [row(1, 'A'), row(2, 'A', 1), row(3, 'B'), row(4, 'C')];
  assert.deepEqual(withoutCopies(rows, 2).map((r) => r.id), [1, 3]);
  assert.equal(rowsToRead(8), 32);
});
