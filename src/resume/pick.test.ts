import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countSkillHits,
  pickResumeForJob,
  preselectAppliedResume,
  preselectResume,
} from './pick';

test('countSkillHits matches whole tokens only', () => {
  const text = 'Senior PHP/Laravel engineer. We use Node.js, C++, CI/CD and PostgreSQL.';
  assert.equal(countSkillHits(['php', 'laravel', 'node.js', 'c++', 'ci/cd', 'postgresql'], text), 6);
  assert.equal(countSkillHits(['java', 'node', 'postgres'], text), 0);
  assert.equal(countSkillHits(['PHP', 'php'], text), 1);
});

test('pickResumeForJob prefers the most overlapping resume, then the default, then lowest id', () => {
  const resumes = [
    { id: 3, skills: ['go', 'react'], isDefault: false },
    { id: 1, skills: ['php', 'laravel', 'vue'], isDefault: false },
    { id: 2, skills: ['php', 'symfony'], isDefault: true },
  ];
  assert.equal(pickResumeForJob(resumes, 'Laravel + Vue shop, PHP 8')?.id, 1);
  assert.equal(pickResumeForJob(resumes, 'PHP developer')?.id, 2);
  assert.equal(pickResumeForJob(resumes, 'Rust systems programmer')?.id, 2);
  assert.equal(
    pickResumeForJob(resumes.map((r) => ({ ...r, isDefault: false })), 'Rust')?.id,
    1,
  );
  assert.equal(pickResumeForJob([], 'anything'), null);
});

test('preselectResume puts the profile link ahead of the overlap heuristic', () => {
  const resumes = [
    { id: 1, skills: ['php', 'laravel'], isDefault: true },
    { id: 2, skills: ['go'], isDefault: false },
  ];
  const laravelJob = 'Laravel engineer, PHP 8';
  // No link → today's behaviour, unchanged.
  assert.equal(preselectResume(resumes, laravelJob, null)?.id, 1);
  // Linked → wins even when the other resume overlaps the posting and is default.
  assert.equal(preselectResume(resumes, laravelJob, 2)?.id, 2);
  // Link to a resume that is gone (deleted, or hidden scratch) → fall back.
  assert.equal(preselectResume(resumes, laravelJob, 99)?.id, 1);
  assert.equal(preselectResume([], laravelJob, 2), null);
});

test('preselectAppliedResume puts a real comparison ahead of the page preselect', () => {
  const resumes = [
    { id: 1, skills: ['php', 'laravel'], isDefault: true },
    { id: 2, skills: ['go'], isDefault: false },
  ];
  const suggested = resumes[0] ?? null;
  // No comparison yet → whatever stage 5 preselected stands.
  assert.equal(preselectAppliedResume(resumes, null, suggested)?.id, 1);
  // A comparison the user actually ran wins over the suggestion.
  assert.equal(preselectAppliedResume(resumes, 2, suggested)?.id, 2);
  // A match against the hidden /target scratch row (never in the picker) falls back.
  assert.equal(preselectAppliedResume(resumes, 99, suggested)?.id, 1);
  // Nothing to offer at all.
  assert.equal(preselectAppliedResume([], 2, null), null);
});
