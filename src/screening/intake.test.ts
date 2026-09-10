import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { displayName, expandUploads, findDuplicate, fingerprintBytes, fingerprintText, isAcceptedResume } from './intake';

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

test('expandUploads opens zips, skips OS litter and non-resume types, passes files through', () => {
  const zip = buildZip([
    { name: 'batch/', data: Buffer.alloc(0) },
    { name: 'batch/anna.pdf', data: Buffer.from('pdf') },
    { name: 'batch/__MACOSX/._anna.pdf', data: Buffer.from('junk') },
    { name: 'batch/.DS_Store', data: Buffer.from('junk') },
    { name: 'batch/~$draft.docx', data: Buffer.from('lock') },
    { name: 'batch/notes.xlsx', data: Buffer.from('xlsx') },
  ]);
  const { files, badArchives, oversized, notResumes } = expandUploads([
    { name: 'batch.zip', bytes: zip },
    { name: 'Ivan Petrenko/CV.docx', bytes: Buffer.from('docx') },
    { name: 'Ivan Petrenko/photo.jpg', bytes: Buffer.from('jpg') },
    { name: 'broken.zip', bytes: Buffer.from('not a zip at all, sorry') },
  ]);
  assert.deepEqual(
    files.map((f) => [f.name, f.archive]),
    [
      ['batch/anna.pdf', 'batch.zip'],
      ['Ivan Petrenko/CV.docx', null],
    ],
    'a folder path stays on the name',
  );
  assert.deepEqual(badArchives, ['broken.zip']);
  assert.deepEqual(oversized, []);
  assert.deepEqual(notResumes, ['batch/notes.xlsx', 'Ivan Petrenko/photo.jpg']);
  assert.equal(displayName(files[0]!), 'batch/anna.pdf (from batch.zip)');
  assert.equal(displayName({ name: './x/CV.pdf', bytes: Buffer.alloc(0), archive: null }), 'x/CV.pdf');
  assert.ok(isAcceptedResume('anna.PDF'));
  assert.ok(!isAcceptedResume('notes.xlsx'));
});

test('findDuplicate: the same text is a re-upload, the same person is another version', () => {
  const body = 'Backend engineer with eight years of Java and Spring Boot. Built payment systems at a bank, ran migrations, owned the on-call rotation, mentored four engineers, spoke at two conferences about resilience patterns and message brokers. '.repeat(4);
  const a = fingerprintText(body);
  const known = [{ id: 1, number: 1, email: 'a@x.io', phone: '+380 67 123 45 67', hash: a.hash, simhash: a.simhash }];
  assert.equal(findDuplicate({ email: null, phone: null, ...fingerprintText(body.toUpperCase()) }, known)?.kind, 'same-text', 'case does not make a new text');
  assert.equal(findDuplicate({ email: 'A@X.IO', phone: null, hash: 'other', simhash: null }, known)?.kind, 'same-person', 'same email, other document');
  assert.equal(findDuplicate({ email: null, phone: '0671234567', hash: 'other', simhash: null }, known), null, 'a local number is not the international one');
  assert.equal(findDuplicate({ email: null, phone: '380 (67) 123-45-67', hash: 'other', simhash: null }, known)?.kind, 'same-person', 'the same digits are the same phone');
  const edited = `Updated 2026\n${body}`;
  assert.equal(findDuplicate({ email: null, phone: null, ...fingerprintText(edited) }, known)?.kind, 'same-person', 'a re-upload with a new line on top is a version');
  assert.equal(findDuplicate({ email: 'b@y.io', phone: null, ...fingerprintText('Completely different frontend resume about React and design systems. '.repeat(8)) }, known), null);
});

test('fingerprintBytes: the same bytes are one hash, different bytes are not, and it is a 32-char hex', () => {
  const a = fingerprintBytes(Buffer.from('%PDF-1.4 scanned'));
  assert.equal(a, fingerprintBytes(Buffer.from('%PDF-1.4 scanned')));
  assert.notEqual(a, fingerprintBytes(Buffer.from('%PDF-1.4 scanned ')));
  assert.match(a, /^[0-9a-f]{32}$/);
});
