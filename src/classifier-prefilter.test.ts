import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from '@prisma/client';
import { parsePrefilterResponse, prefilterMayJudge } from './classifier-prefilter';

describe('parsePrefilterResponse', () => {
  it('parses clean JSON', () => {
    const out = parsePrefilterResponse('{"relevant":true,"reason":"php in title"}');
    assert.deepEqual(out, { relevant: true, reason: 'php in title' });
  });

  it('parses JSON wrapped in prose', () => {
    const out = parsePrefilterResponse(
      'Here is my answer:\n{"relevant": false, "reason": "frontend-only"}\n',
    );
    assert.deepEqual(out, { relevant: false, reason: 'frontend-only' });
  });

  it('returns null for malformed JSON', () => {
    assert.equal(parsePrefilterResponse('{relevant: true}'), null);
    assert.equal(parsePrefilterResponse('not json'), null);
  });

  it('returns null when required fields are missing', () => {
    assert.equal(parsePrefilterResponse('{"relevant":true}'), null);
    assert.equal(parsePrefilterResponse('{"reason":"x"}'), null);
  });

  it('returns null when types are wrong', () => {
    assert.equal(parsePrefilterResponse('{"relevant":"yes","reason":"x"}'), null);
    assert.equal(parsePrefilterResponse('{"relevant":true,"reason":42}'), null);
  });
});

describe('prefilterMayJudge (#441)', () => {
  const search = (stackRequired: string[]) => ({ stackRequired }) as unknown as Profile;
  const posting = (title: string, description: string) => ({ title, description });

  it('sends a posting that names the stack past the gate, wherever the text names it', () => {
    const far = `${'About us. '.repeat(100)}Our backend runs on Node.js.`;
    assert.equal(prefilterMayJudge(posting('Senior Engineer', far), [search(['node.js'])]), false);
    assert.equal(prefilterMayJudge(posting('Senior TypeScript Engineer', 'x'), [search(['typescript'])]), false);
  });

  it('lets the gate judge a posting that names none of any search\'s stack', () => {
    assert.equal(prefilterMayJudge(posting('Senior Engineer', 'We write Ruby.'), [search(['php']), search(['typescript'])]), true);
  });

  it('reads whole words: JavaScript does not name a Java stack', () => {
    assert.equal(prefilterMayJudge(posting('Frontend Engineer', 'JavaScript and CSS.'), [search(['java'])]), true);
  });

  it('one search is enough, and a search without a stack never skips the gate', () => {
    assert.equal(prefilterMayJudge(posting('Engineer', 'PHP and Laravel.'), [search([]), search(['laravel'])]), false);
    assert.equal(prefilterMayJudge(posting('Engineer', 'PHP and Laravel.'), [search([])]), true);
  });
});
