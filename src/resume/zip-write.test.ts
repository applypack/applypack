import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip, crc32 } from './zip-write';
import { readZipEntry } from './zip';

test('crc32 matches the standard check values', () => {
  assert.equal(crc32(Buffer.from('')), 0);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('buildZip round-trips through our own reader', () => {
  const doc = Buffer.from('<w:document>hello</w:document>', 'utf8');
  const rels = Buffer.from('<Relationships/>', 'utf8');
  const zip = buildZip([
    { name: 'word/document.xml', data: doc },
    { name: '_rels/.rels', data: rels },
  ]);
  assert.deepEqual(readZipEntry(zip, 'word/document.xml'), doc);
  assert.deepEqual(readZipEntry(zip, '_rels/.rels'), rels);
  assert.equal(readZipEntry(zip, 'missing.xml'), null);
});

test('buildZip is deterministic', () => {
  const entries = [{ name: 'a.txt', data: Buffer.from('same bytes') }];
  assert.deepEqual(buildZip(entries), buildZip(entries));
});
