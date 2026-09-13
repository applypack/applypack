import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparedResumeName, earlierLabel, EARLIER_ONE_OFF, oneOffDraft, previousFor } from './match-name';

test('a real resume reads its live name, whatever the comparison kept', () => {
  assert.equal(comparedResumeName('Old name', { name: 'Renamed resume', hidden: false }), 'Renamed resume');
  assert.equal(comparedResumeName('', { name: 'Renamed resume', hidden: false }), 'Renamed resume');
});

test('a one-off comparison reads the name it was made under, not the latest upload', () => {
  assert.equal(comparedResumeName('Backend CV', { name: 'Frontend CV', hidden: true }), 'Backend CV');
  assert.equal(comparedResumeName('', { name: 'Frontend CV', hidden: true }), EARLIER_ONE_OFF);
});

const at = (min: number) => new Date(Date.UTC(2026, 8, 13, 12, min));
const row = (id: number, min: number, name: string, hidden: boolean, resumeId = hidden ? 2 : 1) => ({
  id,
  resumeId,
  resumeVersion: id,
  createdAt: at(min),
  resume: { name, hidden },
});

test('previousFor pairs a real resume with its own earlier comparison, whatever the name', () => {
  const latest = row(3, 30, 'CV', false);
  const first = row(1, 10, 'CV', false);
  const rows = [latest, row(2, 20, 'CV (old name)', false), first];
  assert.equal(previousFor(latest, rows)?.id, 2);
  assert.equal(previousFor(first, rows), null);
});

test('previousFor pairs a one-off file only with an earlier check of the same file', () => {
  const backendAgain = row(3, 30, 'Backend CV', true);
  const frontend = row(2, 20, 'Frontend CV', true);
  const rows = [backendAgain, frontend, row(1, 10, 'Backend CV', true)];
  assert.equal(previousFor(backendAgain, rows)?.id, 1);
  assert.equal(previousFor(frontend, rows), null);
});

test('earlierLabel names a version for a real resume and the file for a one-off', () => {
  assert.equal(earlierLabel(row(4, 0, 'CV', false)), 'v4');
  assert.equal(earlierLabel(row(4, 0, 'CV', true)), 'the last check of this file');
});

test('oneOffDraft: the file judged again is not a draft, an edit or an earlier draft is', () => {
  const file = { draft: false, resumeText: 'the uploaded text' };
  assert.equal(oneOffDraft(file, 'the uploaded text'), false);
  assert.equal(oneOffDraft(file, 'the uploaded text, edited'), true);
  assert.equal(oneOffDraft({ draft: true, resumeText: 'an edited text' }, 'an edited text'), true);
});
