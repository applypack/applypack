import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assumedNote, lossNotes, readingOf } from './read-notes';

test('readingOf: an encoding is "assumed" only when neither the bytes nor the page said it', () => {
  assert.deepEqual(readingOf({ encoding: 'utf-8', how: 'bytes', unreadable: 0 }, null), { cutAt: null, unreadable: 0, assumed: null });
  assert.deepEqual(readingOf({ encoding: 'windows-1251', how: 'declared', unreadable: 0 }, null).assumed, null);
  assert.deepEqual(readingOf({ encoding: 'windows-1252', how: 'assumed', unreadable: 2 }, 14), { cutAt: 14, unreadable: 2, assumed: 'windows-1252' });
});

test('lossNotes: a sentence for each part that was not read, none for a file read whole', () => {
  assert.deepEqual(lossNotes({ cutAt: null, unreadable: 0 }), []);
  assert.deepEqual(lossNotes({ cutAt: 1204, unreadable: 0 }), [
    'A quote opened on line 1,204 is never closed, so nothing from that line on could be read. The rows above it are read; close the quote in the file to bring the rest.',
  ]);
  const [one] = lossNotes({ cutAt: null, unreadable: 1 });
  assert.match(one!, /^1 character could not be read and shows as \uFFFD\. The file is damaged, or in an encoding ApplyPack does not know/);
  assert.equal(lossNotes({ cutAt: 4, unreadable: 183 }).length, 2);
  assert.match(lossNotes({ cutAt: 4, unreadable: 183 })[1]!, /^183 characters could not be read and show as/);
});

test('assumedNote: says which encoding was taken, and what to do if a name reads wrong', () => {
  assert.equal(assumedNote({ assumed: null }), null);
  assert.match(assumedNote({ assumed: 'windows-1252' })!, /read as Windows-1252 \(Western European\)\. If a name looks wrong, save the file as UTF-8\.$/);
  assert.match(assumedNote({ assumed: 'windows-1251' })!, /read as Windows-1251 \(Cyrillic\)/);
});
