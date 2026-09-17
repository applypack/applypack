import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseUrl, parseDbState, resolveDatabaseUrl } from './db-state';

const STATE = { port: 5434, user: 'applypack', password: 'a+b/c=d@e:f?g#h%i' };

test('the URL reaches the built-in database on loopback, whatever the password holds', () => {
  const url = new URL(databaseUrl(STATE));
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '5434');
  assert.equal(url.pathname, '/postgres');
  assert.equal(decodeURIComponent(url.password), STATE.password);
});

test('a db.json that is not what the launcher writes is no database at all', () => {
  assert.deepEqual(parseDbState(JSON.stringify(STATE)), STATE);
  assert.equal(parseDbState('{not json'), null);
  assert.equal(parseDbState(JSON.stringify({ ...STATE, port: 'x' })), null);
  assert.equal(parseDbState(JSON.stringify({ ...STATE, password: 'short' })), null);
});

test('DATABASE_URL wins; without it, the built-in database if one was ever created', () => {
  const state = JSON.stringify(STATE);
  assert.equal(resolveDatabaseUrl('postgresql://own@localhost/db', state), 'postgresql://own@localhost/db');
  assert.equal(resolveDatabaseUrl('', state), databaseUrl(STATE));
  assert.equal(resolveDatabaseUrl('   ', state), databaseUrl(STATE));
  assert.equal(resolveDatabaseUrl(undefined, null), undefined);
  assert.equal(resolveDatabaseUrl(undefined, 'garbage'), undefined);
});
