import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONF_LINES,
  binaries,
  initdbArgs,
  lastLines,
  leftoverAction,
  pgCtlStartArgs,
  pgCtlStopArgs,
  platformPackage,
  firstLinePid,
} from './postgres-setup';

test('the five systems a laptop runs have a binary package; anything else says so', () => {
  assert.equal(platformPackage('darwin', 'arm64'), '@embedded-postgres/darwin-arm64');
  assert.equal(platformPackage('darwin', 'x64'), '@embedded-postgres/darwin-x64');
  assert.equal(platformPackage('linux', 'x64'), '@embedded-postgres/linux-x64');
  assert.equal(platformPackage('linux', 'arm64'), '@embedded-postgres/linux-arm64');
  assert.equal(platformPackage('win32', 'x64'), '@embedded-postgres/windows-x64');
  assert.equal(platformPackage('win32', 'arm64'), null);
  assert.equal(platformPackage('freebsd', 'x64'), null);
});

test('Windows binaries carry .exe', () => {
  assert.match(binaries('/pkg', 'win32').pgCtl, /pg_ctl\.exe$/);
  assert.match(binaries('/pkg', 'linux').initdb, /native[\\/]bin[\\/]initdb$/);
});

test('initdb never inherits the encoding or locale of the shell that runs it', () => {
  // With no LANG it made SQL_ASCII, where 'Київ' ILIKE '%КИЇВ%' is false.
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    const args = initdbArgs('/data/postgres', 'applypack', '/data/pw', platform);
    assert.ok(args.includes('--encoding=UTF8'), platform);
    assert.ok(args.some((a) => a.startsWith('--locale=')), platform);
    assert.ok(args.includes('--auth=scram-sha-256'), platform);
    assert.ok(args.includes('--pwfile=/data/pw'), platform);
  }
  assert.ok(initdbArgs('/d', 'u', '/p', 'darwin').includes('--locale=C.UTF-8'));
  assert.ok(initdbArgs('/d', 'u', '/p', 'win32').includes('--locale-provider=icu'));
});

test('the server listens on loopback only, without a shared socket, in UTC', () => {
  assert.match(CONF_LINES, /^listen_addresses = '127\.0\.0\.1'$/m);
  assert.match(CONF_LINES, /^unix_socket_directories = ''$/m);
  assert.match(CONF_LINES, /^timezone = 'UTC'$/m);
  assert.match(CONF_LINES, /^log_timezone = 'UTC'$/m);
});

test('pg_ctl waits for the server both ways and stops it fast', () => {
  const start = pgCtlStartArgs('/data/postgres', '/data/logs/postgres.log', 5434);
  assert.deepEqual(start.slice(0, 2), ['start', '-w']);
  assert.equal(start[start.indexOf('-o') + 1], '-p 5434');
  assert.equal(start[start.indexOf('-l') + 1], '/data/logs/postgres.log');
  const stop = pgCtlStopArgs('/data/postgres');
  assert.deepEqual([stop[0], stop[1], stop[stop.indexOf('-m') + 1]], ['stop', '-w', 'fast']);
});

test('a pid file gives its PID from the first line and nothing else', () => {
  assert.equal(firstLinePid('87795\n/data/postgres\n1726500000\n5434\n'), 87795);
  assert.equal(firstLinePid('4242\r\nC:\\data\\postgres\r\n'), 4242);
  assert.equal(firstLinePid(''), null);
  assert.equal(firstLinePid('-1\n'), null);
  assert.equal(firstLinePid('abc\n'), null);
});

test('a leftover server is stopped only when that PID really serves this folder', () => {
  const pgdata = '/Users/jane/Library/Application Support/ApplyPack/postgres';
  const ours = '/app/node_modules/@embedded-postgres/darwin-arm64/native/bin/postgres -D /Users/jane/Library/Application Support/ApplyPack/postgres -p 5434';
  assert.equal(leftoverAction(null, null, pgdata), 'remove');
  assert.equal(leftoverAction(87795, ours, pgdata), 'stop');
  // After a reboot the number can belong to anything — a host Postgres included.
  assert.equal(leftoverAction(87795, '/opt/homebrew/bin/postgres -D /opt/homebrew/var/postgresql@16', pgdata), 'remove');
  assert.equal(leftoverAction(87795, null, pgdata), 'remove');
  assert.equal(
    leftoverAction(4242, '"C:\\Apps\\native\\bin\\postgres.exe" -D "C:\\Users\\Jane\\AppData\\Roaming\\ApplyPack\\postgres"', 'C:\\Users\\Jane\\AppData\\Roaming\\ApplyPack\\postgres'),
    'stop',
  );
});

test('an error message quotes the end of the log', () => {
  assert.equal(lastLines('a\nb\nc\nd\n', 2), 'c\nd');
  assert.equal(lastLines('only\r\n', 5), 'only');
});
