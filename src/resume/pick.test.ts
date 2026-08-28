import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSkillHits, pickResumeForJob } from './pick';

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
