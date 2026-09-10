import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasOwnBodyLimit } from './body-limits';

test('the upload routes keep their own ceiling; everything else gets the default', () => {
  for (const p of ['/resumes', '/resumes/3/replace', '/target', '/letter', '/jobs/7/target/reupload', '/settings/profiles/2/fill-from-resume', '/welcome/resume', '/screen', '/screen/9/applicants']) {
    assert.equal(hasOwnBodyLimit('POST', p), true, p);
  }
  for (const p of ['/jobs/new', '/jobs/7/description', '/resumes/3/draft', '/screen/9/posting', '/settings/profiles/2/save', '/resumes/3']) {
    assert.equal(hasOwnBodyLimit('POST', p), false, p);
  }
  assert.equal(hasOwnBodyLimit('GET', '/resumes'), false);
});

test('every route that sets its own bodyLimit is on the list', () => {
  // The registrations that pass an upload limit as middleware, read off the source.
  const dir = join(__dirname, 'routes');
  const found: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.tsx?$/.test(f) || /\.test\./.test(f)) continue;
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/\.post\(\s*'([^']+)',\s*(?:[a-zA-Z]+UploadLimit|async \(c, next\) => [a-zA-Z]+UploadLimit)/g)) {
      found.push(m[1]!);
    }
  }
  assert.ok(found.length >= 8, `found only ${found.length} upload routes`);
  for (const route of found) {
    const sample = route.replace(/:\w+/g, '7');
    assert.equal(hasOwnBodyLimit('POST', sample), true, `${route} sets its own bodyLimit but is not on the list`);
  }
});
