import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { readProps, withProps } from './docx-props';

const twin = () => readFileSync(join(__dirname, 'fixtures', 'flow-fragmented.docx'));

test('readProps sees the template junk a downloaded resume carries', () => {
  // The twin keeps resume 1's shape: a third-party creator and Word as the application.
  const p = readProps(twin());
  assert.equal(p.creator, 'Template Vendor');
  assert.equal(p.lastModifiedBy, 'Alex Example');
  assert.equal(p.application, 'Microsoft Office Word');
  assert.match(p.modified ?? '', /^\d{4}-\d{2}-\d{2}T/);
});

test('withProps rewrites the named properties and leaves every word/* part byte-identical', async () => {
  const before = twin();
  const now = new Date('2026-09-04T12:00:00Z');
  const after = await withProps(before, { title: 'Alex Example — Résumé', creator: 'Alex Example', lastModifiedBy: 'Alex Example' }, now);
  const p = readProps(after);
  assert.equal(p.title, 'Alex Example — Résumé');
  assert.equal(p.creator, 'Alex Example');
  assert.equal(p.lastModifiedBy, 'Alex Example');
  assert.equal(p.modified, '2026-09-04T12:00:00Z');
  const a = await JSZip.loadAsync(before);
  const b = await JSZip.loadAsync(after);
  const names = Object.keys(a.files).filter((n) => !a.files[n]!.dir);
  assert.deepEqual(Object.keys(b.files).filter((n) => !b.files[n]!.dir), names, 'no part added or lost');
  for (const n of names) {
    if (n === 'docProps/core.xml') continue;
    assert.ok((await a.file(n)!.async('nodebuffer')).equals(await b.file(n)!.async('nodebuffer')), `${n} untouched`);
  }
});

test('withProps adds a property the file never had and escapes what it writes', async () => {
  const after = await withProps(twin(), { title: 'R&D <lead>' });
  assert.equal(readProps(after).title, 'R&D <lead>');
});

test('a file with no properties part reads as all null and is returned untouched by withProps', async () => {
  const { buildZip } = require('./zip-write') as typeof import('./zip-write');
  const bare = buildZip([{ name: 'word/document.xml', data: Buffer.from('<w:document/>') }]);
  assert.deepEqual(readProps(bare), { title: null, creator: null, lastModifiedBy: null, modified: null, application: null });
  assert.equal(await withProps(bare, { title: 'x' }), bare, 'no orphan part is invented');
});
