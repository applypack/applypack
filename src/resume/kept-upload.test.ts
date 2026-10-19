import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keptByWrite, NOTHING_KEPT, originalFile, type ResumeFiles } from './kept-upload';

const md = new TextEncoder().encode('# Marta Keller');
const docx = new Uint8Array([0x50, 0x4b, 3, 4]);
const uploaded: ResumeFiles = {
  original: md,
  sourceFilename: 'marta-keller-resume.md',
  mimeType: 'text/markdown',
  ...NOTHING_KEPT,
};

test('Save as v2 keeps the uploaded .md, and Download original hands it back (#590)', () => {
  const v2: ResumeFiles = { ...uploaded, ...keptByWrite(uploaded), original: docx, sourceFilename: 'marta-keller-resume-v2.docx' };
  assert.deepEqual(originalFile(v2), { name: 'marta-keller-resume.md', mime: 'text/markdown', bytes: md });
  // v3 written over v2: the upload is still the .md, untouched.
  assert.deepEqual(keptByWrite(v2), {});
});

test('with nothing kept, the original is the file in place', () => {
  assert.deepEqual(originalFile(uploaded), { name: 'marta-keller-resume.md', mime: 'text/markdown', bytes: md });
  const reuploaded: ResumeFiles = { ...uploaded, ...NOTHING_KEPT, original: docx, sourceFilename: 'new.docx' };
  assert.equal(originalFile(reuploaded).name, 'new.docx', 'a file the person uploads is the original again');
});
