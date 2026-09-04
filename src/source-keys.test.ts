import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceKeys, redactSecrets, resolveSourceKeys, sourceKeyOrigin } from './source-keys';

describe('parseSourceKeys', () => {
  it('keeps known sources and fields, drops the rest', () => {
    const keys = parseSourceKeys({
      ADZUNA: { app_id: ' abc123 ', app_key: 'k'.repeat(32), bogus: 'x' },
      FRANCETRAVAIL: { client_id: '', client_secret: 's'.repeat(600) },
      REED: { key: 'nope' },
    });
    assert.deepEqual(keys, { ADZUNA: { app_id: 'abc123', app_key: 'k'.repeat(32) } });
  });

  it('never throws on a hand-edited row', () => {
    assert.deepEqual(parseSourceKeys(null), {});
    assert.deepEqual(parseSourceKeys('garbage'), {});
    assert.deepEqual(parseSourceKeys({ ADZUNA: 'not-an-object' }), {});
    assert.deepEqual(parseSourceKeys({ ADZUNA: { app_id: 42 } }), {});
  });
});

describe('resolveSourceKeys', () => {
  const env = { ADZUNA_APP_ID: 'env-id', ADZUNA_APP_KEY: 'env-key' } as NodeJS.ProcessEnv;

  it('takes the pasted value per field and falls back to .env per field', () => {
    assert.deepEqual(resolveSourceKeys('ADZUNA', { ADZUNA: { app_key: 'db-key' } }, env), { app_id: 'env-id', app_key: 'db-key' });
    assert.deepEqual(resolveSourceKeys('ADZUNA', {}, env), { app_id: 'env-id', app_key: 'env-key' });
  });

  it('answers null when any field is missing — half a credential is none', () => {
    assert.equal(resolveSourceKeys('ADZUNA', { ADZUNA: { app_id: 'only' } }, {} as NodeJS.ProcessEnv), null);
    assert.equal(resolveSourceKeys('FRANCETRAVAIL', {}, env), null);
  });

  it('says where a field comes from without saying what it is', () => {
    assert.equal(sourceKeyOrigin('ADZUNA', 'app_key', { ADZUNA: { app_key: 'x' } }, env), 'db');
    assert.equal(sourceKeyOrigin('ADZUNA', 'app_id', {}, env), 'env');
    assert.equal(sourceKeyOrigin('FRANCETRAVAIL', 'client_id', {}, env), 'none');
  });
});

describe('redactSecrets', () => {
  it('blanks every secret, raw and URL-encoded, and leaves the rest', () => {
    const msg = 'HTTP 403 for https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=abc123&app_key=s%2Fecret&max_days_old=1';
    assert.equal(
      redactSecrets(msg, ['abc123', 's/ecret']),
      'HTTP 403 for https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=***&app_key=***&max_days_old=1',
    );
    assert.equal(redactSecrets('nothing here', ['', 'zzz']), 'nothing here');
  });
});
