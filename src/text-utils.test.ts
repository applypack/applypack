import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJson,
  maskToken,
  parseTagList,
  toStringArray,
} from './text-utils';

describe('parseTagList', () => {
  it('splits by newline', () => {
    assert.deepEqual(parseTagList('php\nlaravel\nsymfony'), [
      'php',
      'laravel',
      'symfony',
    ]);
  });

  it('splits by comma', () => {
    assert.deepEqual(parseTagList('php, laravel, symfony'), [
      'php',
      'laravel',
      'symfony',
    ]);
  });

  it('handles mixed comma + newline', () => {
    assert.deepEqual(parseTagList('php, laravel\nsymfony,backend'), [
      'php',
      'laravel',
      'symfony',
      'backend',
    ]);
  });

  it('trims whitespace and drops empties', () => {
    assert.deepEqual(parseTagList('  php , ,\n   laravel\n  '), [
      'php',
      'laravel',
    ]);
  });

  it('preserves multi-word tags', () => {
    assert.deepEqual(parseTagList('full stack\nfull-stack'), [
      'full stack',
      'full-stack',
    ]);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(parseTagList(''), []);
    assert.deepEqual(parseTagList('   \n   '), []);
  });
});

describe('toStringArray (form-field normaliser)', () => {
  it('returns [] for undefined', () => {
    assert.deepEqual(toStringArray(undefined), []);
  });

  it('returns [] for null', () => {
    assert.deepEqual(toStringArray(null), []);
  });

  it('returns [] for empty string', () => {
    assert.deepEqual(toStringArray(''), []);
  });

  it('wraps a single string into an array', () => {
    assert.deepEqual(toStringArray('senior'), ['senior']);
  });

  it('returns string[] as-is', () => {
    assert.deepEqual(toStringArray(['senior', 'staff', 'lead']), [
      'senior',
      'staff',
      'lead',
    ]);
  });

  it('filters non-string array entries', () => {
    assert.deepEqual(toStringArray(['ok', 1, true, null, 'fine']), [
      'ok',
      'fine',
    ]);
  });
});

describe('maskToken', () => {
  it('redacts very short tokens fully', () => {
    assert.equal(maskToken('abc'), '***');
    assert.equal(maskToken('123456789012'), '***');
  });

  it('shows first 8 + last 4 for long tokens', () => {
    const t = '123456789012345abcdefghij6789';
    assert.equal(maskToken(t), '12345678***6789');
  });

  it('handles a typical Telegram bot token (46 chars)', () => {
    const t = '8557299558:AAGuiFakeTokenForTestingPurposesOnly1234XX';
    const masked = maskToken(t);
    assert.ok(masked.startsWith('8557'));
    assert.ok(masked.endsWith('XX') || masked.endsWith('34XX'));
    assert.ok(masked.length < t.length);
    assert.ok(masked.includes('***'));
  });
});

describe('extractJson', () => {
  it('parses clean JSON', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  });

  it('strips leading commentary', () => {
    assert.deepEqual(
      extractJson('Here is the result:\n{"fit_score":85}'),
      { fit_score: 85 },
    );
  });

  it('strips trailing commentary', () => {
    assert.deepEqual(
      extractJson('{"a":1}\n\nHope this helps!'),
      { a: 1 },
    );
  });

  it('strips both leading and trailing prose', () => {
    assert.deepEqual(
      extractJson('Sure! {"x":2,"y":[1,2,3]} — let me know'),
      { x: 2, y: [1, 2, 3] },
    );
  });

  it('returns null for no JSON object', () => {
    assert.equal(extractJson('no json here'), null);
  });

  it('returns null for malformed JSON', () => {
    assert.equal(extractJson('{"unclosed": "string'), null);
    assert.equal(extractJson('{ not: "valid", json: 1 }'), null);
  });

  it('handles deeply nested objects', () => {
    assert.deepEqual(
      extractJson('text {"a":{"b":{"c":[1,2]}}} more'),
      { a: { b: { c: [1, 2] } } },
    );
  });
});
