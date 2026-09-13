import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preselectNote, resumeFileKind, resumeOptionLabel } from './resume-label';

test('resumeFileKind names the four accepted types and falls back to File', () => {
  assert.equal(resumeFileKind('Nazar Boyko Resume.pdf'), 'PDF');
  assert.equal(resumeFileKind('cv.DOCX'), 'DOCX');
  assert.equal(resumeFileKind('resume.md'), 'Markdown');
  assert.equal(resumeFileKind('pasted.txt'), 'Text');
  assert.equal(resumeFileKind('resume'), 'File');
});

test('resumeOptionLabel reads name · kind version · note · default', () => {
  const pdf = { name: 'Senior Resume', version: 1, isDefault: true, sourceFilename: 'Senior Resume.pdf' };
  assert.equal(
    resumeOptionLabel(pdf, preselectNote('linked', 'Senior Software Engineer')),
    'Senior Resume · PDF v1 · used by search "Senior Software Engineer" · default',
  );
  assert.equal(resumeOptionLabel({ ...pdf, isDefault: false, version: 3 }), 'Senior Resume · PDF v3');
});

test('preselectNote says why a resume is picked', () => {
  assert.equal(preselectNote('overlap', 'Backend'), 'best skill overlap');
  assert.equal(preselectNote('linked', null), 'used by your search');
});
