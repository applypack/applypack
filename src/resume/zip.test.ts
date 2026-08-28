import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readZipEntry, ZipError } from './zip';

interface Entry {
  name: string;
  data: Buffer;
  deflate: boolean;
}

/** Builds a valid zip in memory — the writer half our reader deliberately lacks. */
function buildZip(entries: Entry[], comment = ''): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const payload = e.deflate ? deflateRawSync(e.data) : e.data;
    const method = e.deflate ? 8 : 0;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, payload);
    centrals.push(central);
    offset += local.length + payload.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const commentBuf = Buffer.from(comment, 'utf8');
  const eocd = Buffer.alloc(22 + commentBuf.length);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(commentBuf.length, 20);
  commentBuf.copy(eocd, 22);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

test('readZipEntry returns stored and deflated entries by name', () => {
  const zip = buildZip([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>'), deflate: false },
    { name: 'word/document.xml', data: Buffer.from('<w:document>hello</w:document>'), deflate: true },
  ]);
  assert.equal(readZipEntry(zip, '[Content_Types].xml')?.toString(), '<Types/>');
  assert.equal(readZipEntry(zip, 'word/document.xml')?.toString(), '<w:document>hello</w:document>');
});

test('readZipEntry returns null for a missing entry', () => {
  const zip = buildZip([{ name: 'a.txt', data: Buffer.from('a'), deflate: false }]);
  assert.equal(readZipEntry(zip, 'word/document.xml'), null);
});

test('readZipEntry survives an archive comment', () => {
  const zip = buildZip([{ name: 'a.txt', data: Buffer.from('payload'), deflate: true }], 'made by test');
  assert.equal(readZipEntry(zip, 'a.txt')?.toString(), 'payload');
});

test('readZipEntry rejects non-zip input', () => {
  assert.throws(() => readZipEntry(Buffer.from('%PDF-1.4 not a zip'), 'x'), ZipError);
  assert.throws(() => readZipEntry(Buffer.alloc(0), 'x'), ZipError);
});
