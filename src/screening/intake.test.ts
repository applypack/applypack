import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { expandUploads, findDuplicate, fingerprintText, isAcceptedResume } from './intake';

/** The same in-memory zip writer zip.test.ts uses. */
function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const payload = deflateRawSync(e.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
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
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

test('expandUploads opens zips, skips OS litter, passes files through', () => {
  const zip = buildZip([
    { name: 'batch/', data: Buffer.alloc(0) },
    { name: 'batch/anna.pdf', data: Buffer.from('pdf') },
    { name: 'batch/__MACOSX/._anna.pdf', data: Buffer.from('junk') },
    { name: 'batch/.DS_Store', data: Buffer.from('junk') },
    { name: 'batch/~$draft.docx', data: Buffer.from('lock') },
    { name: 'batch/notes.xlsx', data: Buffer.from('xlsx') },
  ]);
  const { files, badArchives } = expandUploads([
    { name: 'batch.zip', bytes: zip },
    { name: 'bob.docx', bytes: Buffer.from('docx') },
    { name: 'broken.zip', bytes: Buffer.from('not a zip at all, sorry') },
  ]);
  assert.deepEqual(
    files.map((f) => [f.name, f.archive]),
    [
      ['anna.pdf', 'batch.zip'],
      ['notes.xlsx', 'batch.zip'],
      ['bob.docx', null],
    ],
  );
  assert.deepEqual(badArchives, ['broken.zip']);
  assert.ok(isAcceptedResume('anna.PDF'));
  assert.ok(!isAcceptedResume('notes.xlsx'));
});

test('findDuplicate: same text, same email, or a near-identical body', () => {
  const body = 'Backend engineer with eight years of Java and Spring Boot. Built payment systems at a bank, ran migrations, owned the on-call rotation, mentored four engineers, spoke at two conferences about resilience patterns and message brokers. '.repeat(4);
  const a = fingerprintText(body);
  const known = [{ id: 1, number: 1, email: 'a@x.io', hash: a.hash, simhash: a.simhash }];
  assert.equal(findDuplicate({ email: null, ...fingerprintText(body.toUpperCase()) }, known)?.number, 1, 'case does not make a new person');
  assert.equal(findDuplicate({ email: 'A@X.IO', hash: 'other', simhash: null }, known)?.number, 1, 'same email');
  const edited = `Updated 2026\n${body}`;
  assert.equal(findDuplicate({ email: null, ...fingerprintText(edited) }, known)?.number, 1, 'a re-upload with a new line on top');
  assert.equal(findDuplicate({ email: 'b@y.io', ...fingerprintText('Completely different frontend resume about React and design systems. '.repeat(8)) }, known), null);
});
